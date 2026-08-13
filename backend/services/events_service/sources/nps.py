"""National Park Service events for the DMV.

Federal open data, free self-service key, no commercial restriction — the one
source in the survey that covers the civic tier properly: the National Mall,
Rock Creek, Great Falls, Harpers Ferry, Antietam, and the 250th-anniversary
programming that goes with them.

Two provider quirks shape this module, both measured rather than assumed:

**Pagination is broken.** `/events` ignores the `start` parameter and returns
the same first page every time, so a `stateCode=DC,MD,VA` query reports 423
results and yields 50. Querying one park at a time is the way round it — no
single DMV park has more than a page of events, which was verified across the
whole list below.

**A series is not a listing.** `dates[]` expands a recurrence into every
concrete occurrence, so a daily programme contributes dozens of identical rows
to a 60-day window. Only the next occurrence in the window is emitted, which
is what a browsable list wants: one row per thing-you-could-go-to.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import date, datetime, time
from typing import Optional
from zoneinfo import ZoneInfo

import httpx

from backend.services.events_service.models import clean_str, event_row, to_float

logger = logging.getLogger("atlas.events.nps")

SOURCE_ID = "nps"
EVENTS_URL = "https://developer.nps.gov/api/v1/events"
PARKS_URL = "https://developer.nps.gov/api/v1/parks"

# Images come back as site-relative paths.
NPS_ORIGIN = "https://www.nps.gov"

# Federal works: NPS imagery is public domain, but the credit is worth
# carrying so the UI can say whose photo it is.
EVENT_IMAGE_ATTRIBUTION = "NPS"
PARK_IMAGE_ATTRIBUTION = "NPS"

EASTERN = ZoneInfo("America/New_York")

REQUEST_TIMEOUT_S = 15.0
PAGE_LIMIT = 50
MAX_CONCURRENT_REQUESTS = 6

# Park units within roughly 100km of DC. `stateCode` is not usable as a filter
# instead of this: Virginia alone reaches Blue Ridge Parkway and Cumberland
# Gap, which are five hours away, and the broken pagination means a wider
# query returns *fewer* usable rows, not more.
DMV_PARK_CODES = (
    "nama",  # National Mall and Memorial Parks
    "rocr",  # Rock Creek Park
    "choh",  # Chesapeake & Ohio Canal
    "gwmp",  # George Washington Memorial Parkway
    "grfa",  # Great Falls Park
    "arho",  # Arlington House
    "whho",  # White House
    "foth",  # Ford's Theatre
    "anac",  # Anacostia Park
    "keaq",  # Kenilworth Park & Aquatic Gardens
    "fowa",  # Fort Washington Park
    "oxhi",  # Oxon Cove Park & Oxon Hill Farm
    "pisc",  # Piscataway Park
    "gree",  # Greenbelt Park
    "cwdw",  # Civil War Defenses of Washington
    "mono",  # Monocacy National Battlefield
    "anti",  # Antietam National Battlefield
    "hafe",  # Harpers Ferry
    "cato",  # Catoctin Mountain Park
    "mana",  # Manassas National Battlefield
    "prwi",  # Prince William Forest Park
    "wotr",  # Wolf Trap National Park for the Performing Arts
    "clba",  # Clara Barton National Historic Site
    "glec",  # Glen Echo Park
    "fomc",  # Fort McHenry
    "hamp",  # Hampton National Historic Site
    "gewa",  # George Washington Birthplace
    "frsp",  # Fredericksburg & Spotsylvania
)

# NPS `types[]` and title keywords onto this app's category set. Checked in
# order, first hit wins, so the more specific patterns come first.
_CATEGORY_PATTERNS = (
    ("festival", ("festival", "celebration", "fireworks", "parade", "fair")),
    ("music", ("concert", "music", "band", "orchestra", "jazz", "dance", "performance")),
    ("arts", ("exhibit", "art", "film", "theater", "theatre", "craft", "gallery")),
    ("outdoors", ("hike", "walk", "bird", "paddle", "astronomy", "star", "sky",
                  "nature", "garden", "trail", "canoe", "bike")),
    ("history", ("tour", "talk", "history", "historic", "commemorat", "battle",
                 "anniversary", "ranger program", "demonstration", "living history")),
    ("community", ("volunteer", "cleanup", "clean-up", "junior ranger",
                   "children", "family", "workshop")),
)

# Park coordinates never move and a park's hero photo changes rarely, so one
# fetch per process covers both backfills. `/parks` carries them together.
_park_coords: dict[str, tuple[float, float]] = {}
_park_images: dict[str, str] = {}
_park_lock = asyncio.Lock()


def is_configured() -> bool:
    return bool(os.environ.get("NPS_API_KEY"))


async def fetch(window_start: date, window_end: date) -> list[dict]:
    """Every DMV park event with an occurrence inside the window.

    Distance filtering is the orchestrator's job — this returns the whole DMV
    set, because the park list is fixed and small enough to fetch in full.
    """
    api_key = os.environ.get("NPS_API_KEY")
    if not api_key:
        raise RuntimeError("NPS_API_KEY is not set")

    semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
        async def one_park(code: str) -> list[dict]:
            async with semaphore:
                return await _fetch_park(client, api_key, code)

        results = await asyncio.gather(
            *(one_park(code) for code in DMV_PARK_CODES), return_exceptions=True
        )
        raw: list[dict] = []
        failures = 0
        for code, result in zip(DMV_PARK_CODES, results):
            if isinstance(result, BaseException):
                failures += 1
                logger.warning("[nps] park %s failed: %s", code, result)
                continue
            raw.extend(result)

        # A couple of flaky parks is normal and the rest of the feed is still
        # worth serving; a total wipeout means the key or the host is the
        # problem and the caller should hear about it as a source failure.
        if failures == len(DMV_PARK_CODES):
            raise RuntimeError(f"all {failures} NPS park requests failed")

        rows = [
            row
            for row in (_to_event(item, window_start, window_end) for item in raw)
            if row is not None
        ]
        await _backfill_from_parks(client, api_key, rows)

    return rows


async def _fetch_park(client: httpx.AsyncClient, api_key: str, code: str) -> list[dict]:
    response = await client.get(
        EVENTS_URL, params={"parkCode": code, "limit": PAGE_LIMIT, "api_key": api_key}
    )
    response.raise_for_status()
    payload = response.json()
    data = payload.get("data") or []
    # The 50-row cap is the pagination bug biting: `start` cannot page past it,
    # so anything beyond the first page of a single park is unreachable and
    # silently missing. Nothing in the DMV list hits this today.
    if len(data) >= PAGE_LIMIT:
        logger.warning(
            "[nps] park %s returned a full page (%d) — events beyond it are "
            "unreachable while /events ignores `start`",
            code,
            len(data),
        )
    return data


def _to_event(item: dict, window_start: date, window_end: date) -> Optional[dict]:
    event_id = clean_str(item.get("id"))
    title = clean_str(item.get("title"))
    if not event_id or not title:
        return None

    occurrence = _next_occurrence(item.get("dates"), window_start, window_end)
    if occurrence is None:
        return None

    starts_at, ends_at = _occurrence_bounds(occurrence, item.get("times"))

    row = event_row(
        source=SOURCE_ID,
        ident=f"{SOURCE_ID}:{event_id}",
        title=title,
        category=_category_for(item),
        starts_at=starts_at,
        ends_at=ends_at,
        # A dated occurrence already answers "when", so schedule_text carries
        # only the provider's extra qualifier ("weather permitting") when set.
        schedule_text=clean_str(item.get("timeinfo")),
        location_name=clean_str(item.get("location")) or clean_str(item.get("parkfullname")),
        address=clean_str(item.get("parkfullname")),
        latitude=to_float(item.get("latitude")),
        longitude=to_float(item.get("longitude")),
        url=clean_str(item.get("infourl")),
        image_url=_image_url(item.get("images")),
        image_attribution=EVENT_IMAGE_ATTRIBUTION if item.get("images") else None,
        blurb=_blurb(item.get("description")),
        is_free=str(item.get("isfree")).lower() == "true",
        # The provider's own editorial signal: parks mark the one-off things
        # they actually want visitors to know about as "Special Event".
        featured=clean_str(item.get("category")) == "Special Event",
    )
    # Carried only so the coordinate backfill below can find the row's park.
    # The orchestrator strips it before the row reaches a client.
    row["_sitecode"] = clean_str(item.get("sitecode"))
    return row


def _next_occurrence(
    dates: Optional[list], window_start: date, window_end: date
) -> Optional[date]:
    """The soonest concrete date inside the window.

    Emitting every occurrence would let one daily programme fill the list; a
    reader wants the series once, with the next time they could turn up.
    """
    if not isinstance(dates, list):
        return None
    best: Optional[date] = None
    for raw in dates:
        try:
            parsed = date.fromisoformat(str(raw)[:10])
        except (TypeError, ValueError):
            continue
        if parsed < window_start or parsed > window_end:
            continue
        if best is None or parsed < best:
            best = parsed
    return best


def _occurrence_bounds(
    day: date, times: Optional[list]
) -> tuple[Optional[str], Optional[str]]:
    """Attach the series' clock time to the chosen date, in Eastern time.

    A date with no time is still worth showing — "Saturday" beats nothing — so
    a missing or unparsable time yields midnight local rather than dropping it.
    """
    start_time, end_time = None, None
    if isinstance(times, list) and times:
        first = times[0] if isinstance(times[0], dict) else {}
        start_time = _parse_clock(first.get("timestart"))
        end_time = _parse_clock(first.get("timeend"))

    starts = datetime.combine(day, start_time or time(0, 0), tzinfo=EASTERN)
    ends = (
        datetime.combine(day, end_time, tzinfo=EASTERN) if end_time else None
    )
    # A programme running past midnight would otherwise end before it starts.
    if ends is not None and ends < starts:
        ends = None
    return starts.isoformat(), ends.isoformat() if ends else None


def _parse_clock(value: object) -> Optional[time]:
    text = clean_str(value)
    if not text:
        return None
    for fmt in ("%I:%M %p", "%H:%M", "%I:%M%p"):
        try:
            return datetime.strptime(text.upper().replace(".", ""), fmt).time()
        except ValueError:
            continue
    return None


def _category_for(item: dict) -> str:
    haystack = " ".join(
        str(part).lower()
        for part in (
            item.get("title") or "",
            " ".join(item.get("types") or []),
            " ".join(item.get("tags") or []),
        )
    )
    for category, needles in _CATEGORY_PATTERNS:
        if any(needle in haystack for needle in needles):
            return category
    return "community"


def _image_url(images: object) -> Optional[str]:
    if not isinstance(images, list) or not images:
        return None
    first = images[0] if isinstance(images[0], dict) else {}
    path = clean_str(first.get("url"))
    if not path:
        return None
    return path if path.startswith("http") else f"{NPS_ORIGIN}{path}"


def _blurb(description: object) -> Optional[str]:
    text = clean_str(description)
    if not text:
        return None
    # Descriptions arrive with HTML entities and occasional markup; the client
    # renders one plain line, so keep it short and tag-free.
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&#39;", "'")
    text = " ".join(text.split())
    while "<" in text and ">" in text:
        start = text.index("<")
        end = text.index(">", start)
        text = text[:start] + text[end + 1:]
        text = " ".join(text.split())
    return text[:280] or None


async def _backfill_from_parks(
    client: httpx.AsyncClient, api_key: str, rows: list[dict]
) -> None:
    """Fill missing event coordinates and photos from the event's own park.

    A third of NPS events carry no coordinates, and 40% carry no photo. Both
    cluster into a handful of parks — the closed-venue-set mitigation the
    survey recommended, except `/parks` hands us the answer free instead of
    needing a geocoder or a stock photo. A park centroid is not the meeting
    point, and the park's hero shot is not a photo of the event, but for a
    "what's near me" list both put the row in the right place.

    One request covers both: `/parks` returns coordinates and `images[]` in the
    same record, so they are fetched and cached together.
    """
    need_coords = [r for r in rows if r.get("latitude") is None and r.get("_sitecode")]
    need_image = [r for r in rows if not r.get("image_url") and r.get("_sitecode")]
    if not need_coords and not need_image:
        return

    wanted = {r["_sitecode"] for r in need_coords + need_image}
    if wanted - set(_park_coords) - set(_park_images):
        async with _park_lock:
            missing_codes = wanted - set(_park_coords) - set(_park_images)
            if missing_codes:
                try:
                    # The comma has to reach the host raw. httpx percent-encodes
                    # it, and `/parks` does not decode `%2C` — it reads the whole
                    # string as one park code and answers with a single record,
                    # which looks like a working request returning a short list.
                    # Hence a hand-built query string rather than `params=`.
                    codes = ",".join(sorted(missing_codes))
                    response = await client.get(
                        f"{PARKS_URL}?parkCode={codes}"
                        f"&limit={len(missing_codes)}&api_key={api_key}"
                    )
                    response.raise_for_status()
                    for park in response.json().get("data") or []:
                        code = clean_str(park.get("parkCode"))
                        if not code:
                            continue
                        lat = to_float(park.get("latitude"))
                        lng = to_float(park.get("longitude"))
                        if lat is not None and lng is not None:
                            _park_coords[code] = (lat, lng)
                        image = _image_url(park.get("images"))
                        if image:
                            _park_images[code] = image
                except (httpx.HTTPError, ValueError) as exc:
                    # Best effort: coordinate-less rows are dropped downstream
                    # and photoless ones fall through to stock imagery, which
                    # is what would have happened without this pass anyway.
                    logger.warning("[nps] park backfill failed: %s", exc)
                    return

    for row in need_coords:
        coords = _park_coords.get(row["_sitecode"])
        if coords:
            row["latitude"], row["longitude"] = coords

    for row in need_image:
        image = _park_images.get(row["_sitecode"])
        if image:
            row["image_url"] = image
            row["image_attribution"] = PARK_IMAGE_ATTRIBUTION
