"""Orchestrates the event sources behind a single distance-sorted list.

Three sources with three different failure modes and three different data
shapes go in; one normalized, deduped, distance-sorted list comes out. The
rules that matter to a caller:

**A row without coordinates is never returned.** This is the survey's central
finding turned into a hard contract — a distance-first list cannot show a row
it cannot place, and a silent 0/0 fallback would put events in the Gulf of
Guinea. Sources get their own chance to backfill (NPS resolves a missing event
coordinate from its park) and whatever is still missing is dropped and counted.

**One source failing never fails the request.** Each source reports its own
status, so a client can say "markets are unavailable" instead of showing an
empty list or an error page.

**Caching happens per source, not per request.** The NPS fetch is DMV-wide and
depends only on the date window, so every caller in the region shares one copy;
USDA is radius-scoped and keyed on a coarsened query point. The result is that
two nearby users cost one upstream fetch, not two.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import date, timedelta
from typing import Any, Callable, Optional

from backend.services.events_service.models import (
    CATEGORIES,
    dedupe,
    haversine_km,
    has_coords,
)
from backend.services.events_service.sources import curated, nps, stock_imagery, usda

logger = logging.getLogger("atlas.events")

# OpenStreetMap backs the curated layer's coordinates (ODbL, attribution
# required); the other two are US federal open data.
ATTRIBUTION = "Farmers market data © USDA · Park events © National Park Service · © OpenStreetMap contributors"

# Wide enough to reach the things worth travelling for. The Maryland
# Renaissance Festival sits 40.6km from the Mall, so a 40km default cut the
# single most recognisable event in the curated set; 60km also brings in
# Leesburg and Artscape without reaching Baltimore's outer suburbs.
DEFAULT_RADIUS_KM = 60.0
MAX_RADIUS_KM = 160.0
DEFAULT_WINDOW_DAYS = 30
MAX_WINDOW_DAYS = 180
DEFAULT_LIMIT = 60
MAX_LIMIT = 200

# Featured rows are protected from the limit so a signature festival cannot be
# pushed out by fifty nearer farmers markets. Capped so they cannot crowd out
# the nearby list either.
MAX_PROTECTED_FEATURED = 12

# The DMV park set moves slowly and USDA's market directory barely moves at
# all, so these are long enough to matter and short enough that a newly added
# event appears the same day.
NPS_TTL_S = 3600
USDA_TTL_S = 6 * 3600

# Query points are coarsened before they become a cache key: two users a few
# hundred metres apart should share one upstream fetch. Distances are still
# computed from the caller's exact position.
CACHE_COORD_PRECISION = 2

SORT_MODES = ("distance", "soonest")

_cache: dict[tuple, tuple[float, Any]] = {}
_cache_locks: dict[tuple, asyncio.Lock] = {}
_locks_guard = asyncio.Lock()


class EventsUnavailable(Exception):
    """Every source failed. The request cannot be answered at all."""


async def _cached(key: tuple, ttl: int, produce: Callable[[], Any]) -> Any:
    """Single-flight TTL cache.

    `services/cache.py` is deliberately not used here: its `set()` accepts a
    `ttl` argument and ignores it, persisting to disk instead, which is right
    for parse results and wrong for a feed that goes stale.
    """
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]

    async with _locks_guard:
        lock = _cache_locks.setdefault(key, asyncio.Lock())

    async with lock:
        # A second caller that queued on the lock finds the first one's result.
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] < ttl:
            return hit[1]
        value = await produce()
        _cache[key] = (time.monotonic(), value)
        return value


def clear_cache() -> None:
    """Drop every cached source fetch. Used by tests and /cache/invalidate."""
    _cache.clear()


async def _fetch_nps(window_start: date, window_end: date) -> list[dict]:
    return await _cached(
        ("nps", window_start.isoformat(), window_end.isoformat()),
        NPS_TTL_S,
        lambda: nps.fetch(window_start, window_end),
    )


async def _fetch_usda(lat: float, lng: float, radius_km: float) -> list[dict]:
    key = (
        "usda",
        round(lat, CACHE_COORD_PRECISION),
        round(lng, CACHE_COORD_PRECISION),
        round(radius_km),
    )
    return await _cached(key, USDA_TTL_S, lambda: usda.fetch(lat, lng, radius_km))


async def _fetch_curated(window_start: date, window_end: date) -> list[dict]:
    # A file read behind an async signature so every source composes the same
    # way in the gather below.
    return curated.fetch(window_start, window_end)


async def get_events(
    lat: float,
    lng: float,
    *,
    radius_km: float = DEFAULT_RADIUS_KM,
    window_days: int = DEFAULT_WINDOW_DAYS,
    categories: Optional[list[str]] = None,
    sort: str = "distance",
    limit: int = DEFAULT_LIMIT,
    today: Optional[date] = None,
) -> dict:
    """Local events near a point.

    `today` is injectable so tests can pin the date window; production callers
    leave it unset.
    """
    radius_km = min(max(float(radius_km), 1.0), MAX_RADIUS_KM)
    window_days = min(max(int(window_days), 1), MAX_WINDOW_DAYS)
    limit = min(max(int(limit), 1), MAX_LIMIT)
    sort = sort if sort in SORT_MODES else "distance"
    wanted = _valid_categories(categories)

    window_start = today or date.today()
    window_end = window_start + timedelta(days=window_days)

    # Factories rather than coroutines: an unconfigured source must not have a
    # coroutine created for it at all.
    plans = (
        ("curated", curated.is_configured,
         lambda: _fetch_curated(window_start, window_end)),
        ("nps", nps.is_configured, lambda: _fetch_nps(window_start, window_end)),
        ("usda", usda.is_configured, lambda: _fetch_usda(lat, lng, radius_km)),
    )

    statuses: list[dict] = []
    pending: list[tuple[str, Any]] = []
    for source_id, configured, start in plans:
        if configured():
            pending.append((source_id, start()))
        else:
            statuses.append(
                {"id": source_id, "status": "not_configured", "count": 0,
                 "detail": f"{source_id.upper()}_API_KEY is not set"}
            )

    results = await asyncio.gather(
        *(coroutine for _, coroutine in pending), return_exceptions=True
    )

    rows: list[dict] = []
    dropped_no_coords = 0
    for (source_id, _), result in zip(pending, results):
        if isinstance(result, BaseException):
            logger.warning("[events] source %s failed: %s", source_id, result)
            statuses.append(
                {"id": source_id, "status": "unavailable", "count": 0,
                 "detail": str(result)[:200]}
            )
            continue

        placed = [row for row in result if has_coords(row)]
        dropped_no_coords += len(result) - len(placed)
        rows.extend(placed)
        statuses.append({"id": source_id, "status": "ok", "count": len(placed),
                         "detail": None})

    if all(entry["status"] != "ok" for entry in statuses):
        raise EventsUnavailable("no event source could be reached")

    if dropped_no_coords:
        logger.info("[events] dropped %d rows with no usable coordinates",
                    dropped_no_coords)

    within = []
    for row in rows:
        distance = haversine_km(lat, lng, row["latitude"], row["longitude"])
        if distance > radius_km:
            continue
        row = {k: v for k, v in row.items() if not k.startswith("_")}
        row["distance_km"] = round(distance, 2)
        within.append(row)

    # Dedupe after the radius filter so the cheap geometry test runs first, and
    # across all sources at once so a curated festival and its NPS listing
    # collapse into one row rather than appearing twice.
    deduped = dedupe(within)

    if wanted:
        deduped = [row for row in deduped if row["category"] in wanted]

    _apply_stock_imagery(deduped)

    ordered = _sort(deduped, sort)
    return {
        "events": _apply_limit(ordered, limit, sort),
        "sources": sorted(statuses, key=lambda entry: entry["id"]),
        "attribution": ATTRIBUTION,
        "radius_km": radius_km,
        "window_days": window_days,
    }


def _apply_stock_imagery(rows: list[dict]) -> None:
    """Last rung of the image chain, applied after dedupe.

    Order matters: a row's own photograph wins, then its park's, and only a row
    still without either gets generic category stock. Running this after dedupe
    means a merged row that borrowed a real photo from a cluster sibling keeps
    it rather than being handed a stock one first.

    `image_attribution` is deliberately left null here. The picture is of the
    category, not of the event, and labelling it with a photographer would
    imply it shows this event.
    """
    for row in rows:
        if row.get("image_url"):
            continue
        stock = stock_imagery.image_for(row["category"], row["id"])
        if stock:
            row["image_url"] = stock
            row["image_is_stock"] = True


def _valid_categories(categories: Optional[list[str]]) -> set[str]:
    if not categories:
        return set()
    return {c.strip().lower() for c in categories if c.strip().lower() in CATEGORIES}


def _sort(rows: list[dict], sort: str) -> list[dict]:
    if sort == "soonest":
        # Recurring rows carry no date. They sort after everything dated rather
        # than being dropped or pinned to the top — "on every Saturday" is
        # genuinely less urgent than "this Friday" but still worth showing.
        return sorted(
            rows,
            key=lambda r: (r["starts_at"] is None, r["starts_at"] or "",
                           r["distance_km"]),
        )
    return sorted(rows, key=lambda r: (r["distance_km"], r["title"] or ""))


def _apply_limit(rows: list[dict], limit: int, sort: str) -> list[dict]:
    """Truncate, but never at the cost of every featured row.

    A plain head-of-list cut would drop the Renaissance Festival in favour of
    the fifty nearest farmers markets, which is exactly backwards for a page
    whose job is to surface things people do not already know about.
    """
    if len(rows) <= limit:
        return rows

    # Never more than the caller asked for: the protection reorders what fits,
    # it does not widen the page.
    protected_count = min(MAX_PROTECTED_FEATURED, limit)
    # Curated first, then by distance. Both layers set `featured`, but they do
    # not mean the same thing — the curated flag is deliberate, while NPS marks
    # about a third of its feed "Special Event", routine ranger talks included.
    # Taking the nearest twelve regardless of source let those crowd out the
    # Renaissance Festival, which is the exact row this protection exists for.
    featured = sorted(
        (row for row in rows if row.get("featured")),
        key=lambda row: (row["source"] != "curated", row["distance_km"]),
    )[:protected_count]
    if not featured:
        return rows[:limit]

    protected = {id(row) for row in featured}
    remainder = [row for row in rows if id(row) not in protected]
    kept = featured + remainder[: max(0, limit - len(featured))]
    return _sort(kept, sort)
