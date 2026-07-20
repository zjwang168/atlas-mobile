"""Cache-aware place photo enrichment for parse responses.

The public entry points in this module mutate existing response/location dicts
so callers can enrich data immediately before Pydantic serialization without
rebuilding the route payload shape.
"""

import asyncio
import json
import time
from typing import Awaitable, Callable

from curl_cffi.requests import AsyncSession

from backend.services import cache
from backend.services.place_image_service import place_image_wiki_api

MAX_CONCURRENT_REQUESTS = 4
NEGATIVE_RETRY_S = 3600
PHOTO_CACHE_VERSION = "v2"
# Minimum spacing between outbound Wikipedia requests, enforced across every
# concurrent worker and every call into this module (not just within one
# batch) — a burst of ~200 concurrent lookups previously tripped Wikimedia's
# per-IP rate limit (HTTP 429) partway through a run, and every place after
# that got silently miscached as "no photo" instead of "we got throttled."
MIN_REQUEST_INTERVAL_S = 0.4

_SOURCES = [place_image_wiki_api]

_throttle_lock = asyncio.Lock()
_last_request_at = 0.0
_blocked_until = 0.0  # monotonic time; set when Wikimedia 429s us


async def _throttle() -> None:
    """Serialize outbound requests to at most one per MIN_REQUEST_INTERVAL_S,
    and hold everyone back until any active rate-limit backoff clears."""
    global _last_request_at
    async with _throttle_lock:
        now = time.monotonic()
        earliest_allowed = max(_last_request_at + MIN_REQUEST_INTERVAL_S, _blocked_until)
        wait_s = earliest_allowed - now
        if wait_s > 0:
            await asyncio.sleep(wait_s)
        _last_request_at = time.monotonic()


async def _fetch_photo_for_place(client: AsyncSession, name: str) -> tuple[str | None, dict]:
    """Fetch one place photo and return the cache entry that should be persisted.

    Positive and negative lookups are cached by normalized place name rather
    than parse URL, so the first successful lookup can be reused across every
    source that mentions the same place.
    """
    global _blocked_until

    cache_key = f"photo:{PHOTO_CACHE_VERSION}:{name.strip().lower()}"
    cached = cache.get(cache_key)
    if cached is not None:
        # Negative entries self-track their timestamp because cache.py is an
        # LRU store without per-entry TTL visibility for callers.
        cached_age_s = time.time() - cached.get("cached_at", 0)
        is_stale_negative = cached.get("negative") and (
            cached_age_s > NEGATIVE_RETRY_S
        )
        if not is_stale_negative:
            cached_url = cached.get("url")
            if cached_url:
                print(f"[place_image_service] Using cached photo_url for '{name}': {cached_url}")
            else:
                retry_in_s = max(0, int(NEGATIVE_RETRY_S - cached_age_s))
                print(
                    f"[place_image_service] Cached photo miss for '{name}', "
                    f"leaving photo_url null; retry in {retry_in_s}s."
                )
            return cached.get("url"), {}

    for source in _SOURCES:
        await _throttle()
        try:
            # Source failures are isolated here so a provider outage cannot
            # turn an otherwise valid parse response into a 500.
            photo = await source.fetch(client, name)
        except place_image_wiki_api.RateLimited as exc:
            # Not a genuine miss — do not cache a negative for it, and hold
            # every subsequent request (this batch and future ones) back
            # until the backoff window Wikimedia gave us has passed.
            _blocked_until = time.monotonic() + exc.retry_after_s
            print(
                f"[place_image_service] Rate limited by Wikipedia while looking up '{name}'; "
                f"backing off {exc.retry_after_s:.0f}s, leaving photo_url null without caching a miss."
            )
            return None, {}
        except Exception:
            photo = None
        if photo:
            return photo, {cache_key: {"url": photo}}

    print(f"[place_image_service] No photo_url found for '{name}', bundling null.")
    return None, {cache_key: {"url": None, "negative": True, "cached_at": time.time()}}


async def fetch_photos_for_places(names: list[str]) -> list[str | None]:
    """Fetch photos for names with bounded concurrency and one batched cache write."""
    results: list[str | None] = [None] * len(names)
    to_persist: dict[str, dict] = {}
    sem = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

    async with AsyncSession() as client:
        async def worker(i: int, name: str) -> None:
            async with sem:
                photo, entry = await _fetch_photo_for_place(client, name)
                results[i] = photo
                to_persist.update(entry)

        await asyncio.gather(*(worker(i, n) for i, n in enumerate(names)))

    if to_persist:
        cache.set_many(to_persist)
    return results


async def enrich_locations_with_photos(locations: list[dict]) -> list[dict]:
    """Fill missing `photo_url` values on location dicts in place."""
    targets = [
        (i, loc.get("name", ""))
        for i, loc in enumerate(locations)
        if not loc.get("photo_url")
    ]
    if not targets:
        return locations

    photos = await fetch_photos_for_places([name for _, name in targets])
    for (i, _), photo in zip(targets, photos):
        locations[i]["photo_url"] = photo
    return locations


async def enrich_response_with_photos(response: dict) -> dict:
    """Fill photos on both top-level locations and route ordered locations.

    Some cached responses deserialize those lists as separate objects, so both
    paths are enriched to keep the response contract internally consistent.
    """
    locations = response.get("locations", [])
    route = response.get("route")
    route_locations = route.get("ordered_locations", []) if isinstance(route, dict) else []

    # Enrich every response-level location list from one name-keyed lookup pass.
    # This avoids duplicate provider/cache logs when top-level locations and
    # route.ordered_locations contain separate dicts for the same place.
    targets_by_name: dict[str, list[dict]] = {}
    for loc in [*locations, *route_locations]:
        if loc.get("photo_url"):
            continue
        name = loc.get("name", "")
        key = name.strip().lower()
        if key:
            targets_by_name.setdefault(key, []).append(loc)

    if targets_by_name:
        names = [group[0].get("name", "") for group in targets_by_name.values()]
        photos = await fetch_photos_for_places(names)
        for group, photo in zip(targets_by_name.values(), photos):
            for loc in group:
                loc["photo_url"] = photo

    response["locations"] = locations
    if isinstance(route, dict):
        route["ordered_locations"] = route_locations
    # Print the JSON payload being bundled into the response during migration
    # verification. Keep it focused on location data so logs show the added
    # photo_url values without dumping unrelated route/session metadata.
    print("[place_image_service] Bundled photo JSON:")
    print(json.dumps({
        "title": response.get("title"),
        "source_type": response.get("source_type"),
        "locations": response.get("locations", []),
    }, ensure_ascii=False, default=str))
    return response


def _missing_photo_count(response: dict) -> int:
    """Count response locations still eligible for enrichment."""
    count = sum(1 for loc in response.get("locations", []) if not loc.get("photo_url"))
    route = response.get("route")
    if isinstance(route, dict):
        count += sum(1 for loc in route.get("ordered_locations", []) if not loc.get("photo_url"))
    return count


def _photo_signature(response: dict) -> tuple:
    """Return the current photo fields for cache upgrade detection."""
    values = [
        (loc.get("name"), "photo_url" in loc, loc.get("photo_url"))
        for loc in response.get("locations", [])
    ]
    route = response.get("route")
    if isinstance(route, dict):
        values.extend(
            (loc.get("name"), "photo_url" in loc, loc.get("photo_url"))
            for loc in route.get("ordered_locations", [])
        )
    return tuple(values)


async def get_or_build_response(key: str, build_fn: Callable[[], Awaitable[dict]]) -> dict:
    """Return an enriched cached response or build, enrich, persist, and return one."""
    cached = cache.get(key)
    if cached is not None:
        missing_before = _missing_photo_count(cached)
        if missing_before:
            photo_before = _photo_signature(cached)
            await enrich_response_with_photos(cached)
            if _photo_signature(cached) != photo_before:
                cache.set(key, cached)
        return cached

    result = await build_fn()
    await enrich_response_with_photos(result)
    cache.set(key, result)
    return result
