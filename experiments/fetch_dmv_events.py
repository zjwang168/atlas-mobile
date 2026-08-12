#!/usr/bin/env python3
"""
Tier 1 event fetch for the DMV — GWU Localist, Howard Localist, USDA markets.

Survey notes and per-source terms live in DMV-EVENT-SOURCES.md next to this
file. Standalone on purpose: stdlib only, nothing added to the app's
dependency tree, nothing imported from src/.

    python3 experiments/fetch_dmv_events.py
    USDA_API_KEY=... python3 experiments/fetch_dmv_events.py

Rows with no coordinates are kept with latitude/longitude set to null rather
than dropped — the point of this run is to measure how big that hole is.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

# --- Config -----------------------------------------------------------------

DAYS = 7
OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dmv-events.json")

LOCALIST_SOURCES = [
    ("gwu", "calendar.gwu.edu"),
    ("howard", "events.howard.edu"),
]

# Roughly the National Mall; 50 miles reaches Frederick, Manassas, and Annapolis.
DMV_CENTER_LAT = 38.9072
DMV_CENTER_LNG = -77.0369
DMV_RADIUS_MILES = 50

PAGE_SIZE = 100
MAX_PAGES = 20  # backstop; a 7-day campus window is nowhere near this
TIMEOUT_S = 25

# The Localist hosts accept anything. usdalocalfoodportal.com returns a bare
# CDN 403 to non-browser agents — same 118-byte HTML with a valid key, an
# invalid one, or none at all, which is why the key looked broken at first.
# A normal browser UA is what gets a keyed request through.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0 Safari/537.36"
)


# --- HTTP -------------------------------------------------------------------


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        return json.loads(resp.read().decode("utf-8"))


# --- Normalized row ---------------------------------------------------------


def row(
    source,
    ident,
    title,
    starts_at=None,
    ends_at=None,
    schedule_text=None,
    location_name=None,
    address=None,
    latitude=None,
    longitude=None,
    category=None,
    url=None,
    image_url=None,
):
    """One output record. Every source normalizes into this shape."""
    return {
        "source": source,
        "id": ident,
        "title": title,
        "starts_at": starts_at,
        "ends_at": ends_at,
        # Farmers markets recur ("Saturdays 9-1, May-Oct") and have no single
        # start time; that text lands here instead of being forced into a date.
        "schedule_text": schedule_text,
        "location_name": location_name,
        "address": address,
        "latitude": latitude,
        "longitude": longitude,
        "category": category,
        "url": url,
        "image_url": image_url,
    }


# --- Localist ---------------------------------------------------------------


def localist_category(event):
    """First event_type, falling back to the first filter of any kind."""
    filters = event.get("filters") or {}
    types = filters.get("event_types") or []
    if types:
        return types[0].get("name")
    for values in filters.values():
        if isinstance(values, list) and values:
            return values[0].get("name")
    return None


def localist_address(event, geo):
    """Prefer the event's own address line, else assemble one from geo."""
    if event.get("address"):
        return event["address"]
    parts = [geo.get("street"), geo.get("city"), geo.get("state"), geo.get("zip")]
    joined = ", ".join(p for p in parts if p)
    return joined or None


def fetch_localist(source, host, days, window_end):
    """Every instance of every event in the next `days` days, one row each.

    A recurring event yields one row per occurrence — that is what "events in
    the next 7 days" means to someone reading a list, and it keeps the
    coordinate stats honest per occurrence rather than per series.
    """
    rows = []
    page = 1
    while page <= MAX_PAGES:
        query = urllib.parse.urlencode({"days": days, "pp": PAGE_SIZE, "page": page})
        payload = get_json(f"https://{host}/api/2/events?{query}")
        wrappers = payload.get("events") or []
        if not wrappers:
            break

        for wrapper in wrappers:
            event = wrapper.get("event") or {}
            geo = event.get("geo") or {}
            lat = geo.get("latitude")
            lng = geo.get("longitude")

            for inst_wrapper in event.get("event_instances") or []:
                inst = inst_wrapper.get("event_instance") or {}
                start = inst.get("start")
                if not start:
                    continue
                # `days` bounds the query, but a series returned inside it can
                # still carry occurrences past the window.
                if parse_iso(start) and parse_iso(start) > window_end:
                    continue

                rows.append(
                    row(
                        source=source,
                        ident=f"{source}:{inst.get('id') or event.get('id')}",
                        title=event.get("title"),
                        starts_at=start,
                        ends_at=inst.get("end"),
                        location_name=event.get("location_name") or event.get("location") or None,
                        address=localist_address(event, geo),
                        # Kept as None rather than 0.0 — a missing coordinate
                        # and a coordinate at null island must not look alike.
                        latitude=float(lat) if lat else None,
                        longitude=float(lng) if lng else None,
                        category=localist_category(event),
                        url=event.get("localist_url") or event.get("url"),
                        image_url=event.get("photo_url"),
                    )
                )

        pages = (payload.get("page") or {}).get("total") or 1
        if page >= pages:
            break
        page += 1

    return rows


def parse_iso(value):
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


# --- USDA -------------------------------------------------------------------


def clean(value):
    """USDA sends absent fields as the literal string 'None', not null."""
    if value is None:
        return None
    text = str(value).strip()
    if not text or text == "None":
        return None
    return text


def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_usda(api_key, lat, lng, radius_miles):
    """Farmers markets within `radius_miles` of a point.

    Verified against the live endpoint: `{"data": [...]}`, coordinates in
    `location_x`/`location_y` as strings, and a `distance` in miles from the
    query point that the server computes for us.
    """
    query = urllib.parse.urlencode(
        {"apikey": api_key, "x": lng, "y": lat, "radius": radius_miles}
    )
    payload = get_json(f"https://www.usdalocalfoodportal.com/api/farmersmarket/?{query}")

    records = payload.get("data") if isinstance(payload, dict) else payload
    if not isinstance(records, list):
        print(
            f"  ! unexpected USDA payload shape: {type(payload).__name__} "
            f"keys={list(payload)[:8] if isinstance(payload, dict) else 'n/a'}",
            file=sys.stderr,
        )
        return []

    rows = []
    for market in records:
        entry = row(
            source="usda",
            ident=f"usda:{market.get('listing_id')}",
            title=clean(market.get("listing_name")),
            # No start time by design — a market is a recurring season, not a
            # dated event. This payload carries no hours at all; listing_desc
            # is 'None' on most records, so schedule_text is usually empty and
            # hours would have to come from the listing page.
            schedule_text=clean(market.get("listing_desc")),
            location_name=clean(market.get("listing_name")),
            address=clean(market.get("location_address")),
            latitude=to_float(market.get("location_y")),
            longitude=to_float(market.get("location_x")),
            category="farmers market",
            url=clean(market.get("media_website")),
            # listing_image is a bare filename and is usually the shared
            # placeholder ('default-farmersmarket-4-3.jpg'), so it is dropped
            # rather than dressed up as a real photo.
            image_url=None,
        )
        # Server-side miles from the query point — the only source here that
        # hands us a distance instead of making us compute one.
        entry["distance_miles"] = to_float(market.get("distance"))
        rows.append(entry)
    return rows


# --- Stats ------------------------------------------------------------------


def has_coords(r):
    return r["latitude"] is not None and r["longitude"] is not None


def print_stats(rows, skipped):
    total = len(rows)
    print()
    print("=" * 62)
    print(f"  total rows            {total}")

    if total:
        geo = sum(1 for r in rows if has_coords(r))
        print(f"  with coordinates      {geo}/{total}  ({100 * geo / total:.0f}%)")
        print(f"  without coordinates   {total - geo}/{total}  ({100 * (total - geo) / total:.0f}%)")

    print("-" * 62)
    print(f"  {'source':<10} {'rows':>6} {'coords':>8} {'coverage':>10}")
    by_source = {}
    for r in rows:
        by_source.setdefault(r["source"], []).append(r)
    for source in sorted(by_source):
        group = by_source[source]
        geo = sum(1 for r in group if has_coords(r))
        pct = f"{100 * geo / len(group):.0f}%" if group else "-"
        print(f"  {source:<10} {len(group):>6} {geo:>8} {pct:>10}")

    for source, reason in skipped:
        print(f"  {source:<10} {'--':>6} {'--':>8} {'skipped':>10}   {reason}")
    print("=" * 62)


# --- Main -------------------------------------------------------------------


def wanted(argv):
    """`--only gwu,usda` limits the run; omitted means every source."""
    for i, arg in enumerate(argv):
        if arg == "--only" and i + 1 < len(argv):
            return {s.strip() for s in argv[i + 1].split(",") if s.strip()}
        if arg.startswith("--only="):
            return {s.strip() for s in arg.split("=", 1)[1].split(",") if s.strip()}
    return None


def main():
    only = wanted(sys.argv[1:])
    window_end = datetime.now(timezone.utc).astimezone() + timedelta(days=DAYS)
    rows = []
    skipped = []

    for source, host in LOCALIST_SOURCES:
        if only and source not in only:
            continue
        print(f"fetching {source} ({host}) ...", flush=True)
        try:
            fetched = fetch_localist(source, host, DAYS, window_end)
            rows.extend(fetched)
            print(f"  {len(fetched)} rows")
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as exc:
            skipped.append((source, f"fetch failed: {exc}"))
            print(f"  ! failed: {exc}", file=sys.stderr)

    api_key = os.environ.get("USDA_API_KEY")
    if only and "usda" not in only:
        pass
    elif not api_key:
        skipped.append(("usda", "no USDA_API_KEY set — apply at usdalocalfoodportal.com"))
        print("skipping usda (no USDA_API_KEY)")
    else:
        print("fetching usda ...", flush=True)
        try:
            fetched = fetch_usda(api_key, DMV_CENTER_LAT, DMV_CENTER_LNG, DMV_RADIUS_MILES)
            rows.extend(fetched)
            print(f"  {len(fetched)} rows")
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError) as exc:
            skipped.append(("usda", f"fetch failed: {exc}"))
            print(f"  ! failed: {exc}", file=sys.stderr)

    rows.sort(key=lambda r: (r["starts_at"] is None, r["starts_at"] or "", r["title"] or ""))

    with open(OUT_PATH, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "window_days": DAYS,
                "count": len(rows),
                "events": rows,
            },
            handle,
            indent=2,
            ensure_ascii=False,
        )

    print_stats(rows, skipped)
    print(f"\nwrote {OUT_PATH}")


if __name__ == "__main__":
    main()
