"""The normalized event row every source adapter produces, and the geometry
and identity helpers the orchestrator applies to it.

One shape for three very different sources. The two fields that carry most of
that difference are `starts_at` and `schedule_text`: a dated event fills the
first, a recurring one (a farmers market, a season-long festival) fills the
second and leaves `starts_at` null. Callers branch on which is present rather
than on `source`.
"""

from __future__ import annotations

import math
import re
from typing import Any, Iterable, Optional

# Every category a normalized row may carry. Sources map their own vocabulary
# onto this set; anything unrecognised becomes "community" rather than leaking
# a provider-specific label to the client.
CATEGORIES = (
    "festival",
    "market",
    "music",
    "arts",
    "outdoors",
    "history",
    "community",
)

DEFAULT_CATEGORY = "community"

# Ported verbatim from experiments/dedupe_events.py, which in turn ports
# placeService.ts. Keep all three in step.
COORD_THRESHOLD = 0.001  # ~100m

_STRIP = re.compile(r"[^a-z0-9\s]")
_SPACES = re.compile(r"\s+")

EARTH_RADIUS_KM = 6371.0088


def event_row(
    source: str,
    ident: str,
    title: str,
    *,
    category: str = DEFAULT_CATEGORY,
    starts_at: Optional[str] = None,
    ends_at: Optional[str] = None,
    schedule_text: Optional[str] = None,
    location_name: Optional[str] = None,
    address: Optional[str] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    url: Optional[str] = None,
    image_url: Optional[str] = None,
    image_attribution: Optional[str] = None,
    image_is_stock: bool = False,
    blurb: Optional[str] = None,
    is_free: Optional[bool] = None,
    featured: bool = False,
) -> dict:
    """One normalized event. Coordinates stay optional here on purpose.

    An adapter that cannot supply coordinates still returns the row; dropping
    it is the orchestrator's decision, taken after the park/venue backfill has
    had its chance. Suppressing it here would hide how big that hole is.
    """
    return {
        "id": ident,
        "source": source,
        "title": title,
        "category": category if category in CATEGORIES else DEFAULT_CATEGORY,
        "starts_at": starts_at,
        "ends_at": ends_at,
        "schedule_text": schedule_text,
        "location_name": location_name,
        "address": address,
        "latitude": latitude,
        "longitude": longitude,
        "url": url,
        "image_url": image_url,
        # Whose photo it is. None when there is no image, or when the image
        # is generic category stock rather than a photo of this event.
        "image_attribution": image_attribution,
        # True when the picture is generic category stock rather than a
        # photograph of this event, so a caller can avoid captioning it
        # as if it showed the real thing.
        "image_is_stock": image_is_stock,
        "blurb": blurb,
        "is_free": is_free,
        "featured": featured,
    }


def has_coords(row: dict) -> bool:
    return row.get("latitude") is not None and row.get("longitude") is not None


def clean_str(value: Any) -> Optional[str]:
    """USDA sends absent fields as the literal string 'None', and NPS sends
    them as empty strings. Both mean "missing" and both must become None."""
    if value is None:
        return None
    text = str(value).strip()
    if not text or text == "None":
        return None
    return text


def to_float(value: Any) -> Optional[float]:
    """Coordinates arrive as strings from both USDA and NPS."""
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    # A provider that means "unknown" sometimes sends 0. Null island is in the
    # Gulf of Guinea, so for a DMV feed this is always bad data, never a place.
    if result == 0:
        return None
    return result


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance. USDA hands us a server-computed distance, but it
    is in miles and only relative to its own query point, so every source is
    re-measured here against the caller's actual location."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def normalize_place_name(value: Optional[str]) -> str:
    """placeService.ts: trim, lowercase, drop punctuation, collapse spaces."""
    if not value:
        return ""
    return _SPACES.sub(" ", _STRIP.sub("", value.strip().lower())).strip()


# Words that carry no identity for a venue name. "Market" and "Farmers" appear
# in nearly every USDA row, so leaving them in makes every pair look similar;
# the directional and street suffixes vary between listings of one place.
_VENUE_STOPWORDS = frozenset(
    {
        "the", "a", "an", "at", "by", "of", "and", "on", "in", "for",
        "market", "markets", "farmer", "farmers", "farmersmarket",
        "st", "street", "ave", "avenue", "rd", "road",
        "nw", "ne", "sw", "se", "n", "s", "e", "w",
    }
)

_AMPERSAND = re.compile(r"[&+]")


def venue_tokens(value: Optional[str]) -> frozenset[str]:
    """Identity-bearing words in a venue name.

    Separate from `normalize_place_name` on purpose: that function mirrors
    placeService.ts and must stay in step with it, while this one exists only
    to catch the naming drift USDA has between listings of the same market.
    The ampersand becomes a space first, because stripping it outright welds
    "14&U" into the single token "14u" and hides the match.
    """
    if not value:
        return frozenset()
    spaced = _AMPERSAND.sub(" ", value.lower())
    words = _SPACES.sub(" ", _STRIP.sub("", spaced)).strip().split()
    return frozenset(word for word in words if word not in _VENUE_STOPWORDS)


def _names_match(a: dict, b: dict) -> bool:
    """Containment on the normalized name, or equality of identity tokens.

    The first half is the app's own rule, ported verbatim. The second exists
    because USDA lists one market under several spellings — "14 & U Farmers'
    Market", "14&U Farmers' Market", and "14 and U Market NW Farmers' Market"
    are one place, and no containment test relates them. Reducing each to
    {14, u} does.
    """
    name_a = normalize_place_name(a.get("title"))
    name_b = normalize_place_name(b.get("title"))
    if not name_a or not name_b:
        return False
    if name_a in name_b or name_b in name_a:
        return True

    tokens_a = venue_tokens(a.get("title"))
    tokens_b = venue_tokens(b.get("title"))
    if not tokens_a or not tokens_b:
        return False
    # Subset rather than overlap: "Dupont" and "Dupont Circle" are the same
    # market, but "Dupont" and "Georgetown" share a token count of zero and
    # must never merge on a partial hit.
    return tokens_a <= tokens_b or tokens_b <= tokens_a


# Sources whose unit of record is a *place*, not an event. USDA publishes a
# directory of markets, so two of its rows at one coordinate are one market
# however differently they are spelled — which is not true of a park, where
# "Boat Rides at Great Falls" and "Lock Demos at Great Falls" share a point and
# are genuinely different things to go to.
VENUE_SOURCES = frozenset({"usda"})

# One market listed twice with slightly different geocodes lands further apart
# than COORD_THRESHOLD allows. An exact name match is strong enough evidence to
# widen the radius for that case alone.
SAME_NAME_VENUE_THRESHOLD = 0.01  # ~1km


def _both_venue_rows(a: dict, b: dict) -> bool:
    return a.get("source") in VENUE_SOURCES and b.get("source") in VENUE_SOURCES


def is_same_event(a: dict, b: dict) -> bool:
    """The coordinate-dependent half of isSamePlace(), applied to events.

    Name containment OR coordinate proximity is far too broad on its own —
    "Georgetown" is inside "Georgetown University", and 100m swallows the
    neighbouring shop — so both must hold, exactly as the app requires.

    The occurrence date deliberately plays no part. NPS files each weekday of a
    tour as its own event, so requiring equal dates leaves three identical
    "Ford's Theatre Walking Tour" rows sitting on top of each other. One row
    per thing-you-could-go-to is what a browse list wants; `dedupe` keeps the
    soonest of the cluster.
    """
    if not has_coords(a) or not has_coords(b):
        return False

    d_lat = abs(a["latitude"] - b["latitude"])
    d_lng = abs(a["longitude"] - b["longitude"])
    co_located = d_lat < COORD_THRESHOLD and d_lng < COORD_THRESHOLD

    if _both_venue_rows(a, b):
        if co_located:
            return True
        if d_lat < SAME_NAME_VENUE_THRESHOLD and d_lng < SAME_NAME_VENUE_THRESHOLD:
            # Equality, not the subset test used for co-located rows: over a
            # kilometre the evidence has to be stronger. "Mount Vernon Triangle
            # FreshFarm Market" and "FRESHFARM Mount Vernon Triangle" both
            # reduce to the same four tokens and are 126m apart, which the
            # 100m rule misses by a hair.
            tokens_a = venue_tokens(a.get("title"))
            return bool(tokens_a) and tokens_a == venue_tokens(b.get("title"))
        return False

    return co_located and _names_match(a, b)


# Filled in on the survivor from a discarded cluster member when the survivor
# has nothing for them. Everything else stays as the survivor had it.
_MERGEABLE_FIELDS = ("image_url", "url", "blurb", "address", "schedule_text")


def _survivor_rank(row: dict) -> tuple:
    """Soonest first, undated last, richest as the tie-break."""
    filled = sum(1 for field in _MERGEABLE_FIELDS if row.get(field))
    return (row.get("starts_at") is None, row.get("starts_at") or "", -filled)


def dedupe(rows: Iterable[dict]) -> list[dict]:
    """Greedy single pass: each row joins the first cluster it matches.

    Not transitive-closure clustering — two rows can both match a third
    without matching each other, and merging them anyway is how a chain of
    near-misses swallows genuinely distinct places.

    Runs across sources, not within one: NPS lists a joint event under every
    participating park code, and USDA carries outright triplicates of the same
    market, so both kinds of duplicate have to collapse in the same pass. When
    a cluster spans sources the survivor keeps its own identity and only
    borrows fields it is missing, so a curated entry's blurb can survive on a
    row that came from a feed.
    """
    clusters: list[list[dict]] = []
    for row in rows:
        for cluster in clusters:
            if any(is_same_event(row, member) for member in cluster):
                cluster.append(row)
                break
        else:
            clusters.append([row])

    survivors = []
    for cluster in clusters:
        best = min(cluster, key=_survivor_rank)
        if len(cluster) > 1:
            best = dict(best)
            for other in cluster:
                if other is best:
                    continue
                for field in _MERGEABLE_FIELDS:
                    if not best.get(field) and other.get(field):
                        best[field] = other[field]
                # A signature event stays signature however it was matched.
                best["featured"] = best.get("featured") or other.get("featured", False)
        survivors.append(best)
    return survivors
