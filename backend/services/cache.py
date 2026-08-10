"""LRU cache for parsed link and geocoding results.

Parsed URL results are persisted to disk so they survive backend restarts.
Geocoding results use a separate LRU namespace so location lookups do not
evict the most recent parsed webpages.

Provides both:
  - New API: get_cached_result() / set_cached_result()
  - Backward-compatible API: get() / set() (used by main.py)
"""

import json
import os
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Optional

_PARSE_CACHE: OrderedDict[str, dict] = OrderedDict()
_MISC_CACHE: OrderedDict[str, dict] = OrderedDict()
_MAX_PARSE_CACHE_SIZE = 100
_MAX_MISC_CACHE_SIZE = 500
_CACHE_DIR = Path(
    os.environ.get(
        "ATLAS_CACHE_DIR",
        Path(__file__).resolve().parents[1] / ".cache",
    )
)
_CACHE_FILE = _CACHE_DIR / "cache.json"

# Stats
_hits = 0
_misses = 0
_loaded_from_disk = False


def _normalize_url(url: str) -> str:
    """Normalize URL for consistent cache keys.

    - Lowercase
    - Strip trailing slash
    - Unify protocol to https
    """
    normalized = url.strip().lower()
    if normalized.endswith("/"):
        normalized = normalized.rstrip("/")
    if normalized.startswith("http://"):
        normalized = "https://" + normalized[7:]
    return normalized


def _trim_lru(cache: OrderedDict[str, dict], max_size: int) -> None:
    while len(cache) > max_size:
        cache.popitem(last=False)


def _is_misc_key(key: str) -> bool:
    return key.startswith(("geo:", "photo:", "search:"))


def _select_cache(key: str) -> tuple[OrderedDict[str, dict], int]:
    if _is_misc_key(key):
        return _MISC_CACHE, _MAX_MISC_CACHE_SIZE
    return _PARSE_CACHE, _MAX_PARSE_CACHE_SIZE


def _load_from_disk() -> None:
    global _loaded_from_disk
    if _loaded_from_disk:
        return
    _loaded_from_disk = True

    if not _CACHE_FILE.exists():
        return

    try:
        with _CACHE_FILE.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[cache] Failed to load disk cache: {exc}")
        return

    parse_entries = payload.get("parse", [])
    misc_entries = payload.get("misc", [])

    for item in parse_entries:
        if isinstance(item, list) and len(item) == 2:
            key, entry = item
            if isinstance(key, str) and isinstance(entry, dict):
                _PARSE_CACHE[key] = entry
    for item in misc_entries:
        if isinstance(item, list) and len(item) == 2:
            key, entry = item
            if isinstance(key, str) and isinstance(entry, dict):
                _MISC_CACHE[key] = entry

    _trim_lru(_PARSE_CACHE, _MAX_PARSE_CACHE_SIZE)
    _trim_lru(_MISC_CACHE, _MAX_MISC_CACHE_SIZE)


def _persist_to_disk() -> None:
    payload = {
        "version": 1,
        "saved_at": time.time(),
        "parse": list(_PARSE_CACHE.items()),
        "misc": list(_MISC_CACHE.items()),
    }

    try:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp_file = _CACHE_FILE.with_suffix(".tmp")
        with tmp_file.open("w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False)
        tmp_file.replace(_CACHE_FILE)
    except (OSError, TypeError) as exc:
        print(f"[cache] Failed to persist disk cache: {exc}")


def get_cached_result(url: str) -> Optional[dict]:
    """Return cached result for *url*, or None if missing.

    On cache hit, moves the entry to the end (most recently used).
    """
    global _hits, _misses
    _load_from_disk()
    key = _normalize_url(url)
    cache, _ = _select_cache(key)
    entry = cache.get(key)
    if entry is None:
        _misses += 1
        return None
    # Move to end (mark as recently used)
    cache.move_to_end(key)
    _hits += 1
    return entry["result"]


def set_cached_result(url: str, result: dict) -> None:
    """Store *result* for *url*.

    If cache is at capacity, evicts the least recently used entry first.
    """
    _load_from_disk()
    key = _normalize_url(url)
    cache, max_size = _select_cache(key)
    if key in cache:
        # Update existing entry, move to end (most recently used)
        cache[key] = {"result": result, "cached_at": time.time()}
        cache.move_to_end(key)
    else:
        # Evict oldest if at capacity
        if len(cache) >= max_size:
            cache.popitem(last=False)
        cache[key] = {"result": result, "cached_at": time.time()}

    _persist_to_disk()


def set_many(entries: dict[str, Any]) -> None:
    """Store multiple raw cache entries with a single disk persist.

    This mirrors set_cached_result() semantics but avoids rewriting cache.json
    once per place when photo enrichment resolves a batch of locations.
    """
    _load_from_disk()
    for key, value in entries.items():
        cache, max_size = _select_cache(key)
        if key in cache:
            cache[key] = {"result": value, "cached_at": time.time()}
            cache.move_to_end(key)
        else:
            if len(cache) >= max_size:
                cache.popitem(last=False)
            cache[key] = {"result": value, "cached_at": time.time()}
    _persist_to_disk()


# ---------------------------------------------------------------------------
# Backward-compatible API — used by main.py (unchanged callers)
# ---------------------------------------------------------------------------

def get(url: str) -> Optional[Any]:
    """Backward-compatible: return cached value for *url*, or None."""
    return get_cached_result(url)


def set(url: str, value: Any, ttl: int = 3600) -> None:
    """Backward-compatible: store *value* for *url* (TTL parameter ignored)."""
    set_cached_result(url, value)


def invalidate(url: str) -> bool:
    """Remove a cached result for *url* from the parse cache.
    Returns True if an entry was removed, False if not found.
    """
    global _hits, _misses
    _load_from_disk()
    key = _normalize_url(url)
    if key in _PARSE_CACHE:
        del _PARSE_CACHE[key]
        _persist_to_disk()
        print(f"[cache] Invalidated cache for: {url[:80]}")
        return True
    print(f"[cache] No cache entry found for: {url[:80]}")
    return False


def clear() -> None:
    """Clear the entire cache (useful for testing)."""
    _PARSE_CACHE.clear()
    _MISC_CACHE.clear()
    try:
        _CACHE_FILE.unlink(missing_ok=True)
    except OSError as exc:
        print(f"[cache] Failed to remove disk cache: {exc}")
    global _hits, _misses
    _hits = 0
    _misses = 0


def get_cache_stats() -> dict:
    """Return cache statistics for monitoring / debugging."""
    _load_from_disk()
    total = _hits + _misses
    hit_rate = round(_hits / total * 100, 1) if total > 0 else 0.0
    return {
        "size": len(_PARSE_CACHE) + len(_MISC_CACHE),
        "parse_size": len(_PARSE_CACHE),
        "parse_max_size": _MAX_PARSE_CACHE_SIZE,
        "misc_size": len(_MISC_CACHE),
        "misc_max_size": _MAX_MISC_CACHE_SIZE,
        "hits": _hits,
        "misses": _misses,
        "hit_rate_pct": hit_rate,
        "persistent": True,
        "cache_file": str(_CACHE_FILE),
    }
