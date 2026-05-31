"""Simple in-memory cache with TTL support.

For MVP, this replaces Redis. Uses a dict internally.
Key: MD5 hash of the URL.
"""

import hashlib
import time
from typing import Any, Optional


_cache: dict[str, dict] = {}
DEFAULT_TTL = 3600  # 1 hour


def _make_key(url: str) -> str:
    return hashlib.md5(url.encode("utf-8")).hexdigest()


def get(url: str) -> Optional[Any]:
    """Return cached value for `url`, or None if expired / missing."""
    key = _make_key(url)
    entry = _cache.get(key)
    if entry is None:
        return None
    if time.time() > entry["expires_at"]:
        del _cache[key]
        return None
    return entry["value"]


def set(url: str, value: Any, ttl: int = DEFAULT_TTL) -> None:
    """Store `value` for `url` with the given TTL (seconds)."""
    key = _make_key(url)
    _cache[key] = {
        "value": value,
        "expires_at": time.time() + ttl,
    }


def clear() -> None:
    """Clear the entire cache (useful for testing)."""
    _cache.clear()
