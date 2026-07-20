# Place Image Service

## Overview

Server-side place image enrichment fills `photo_url` on parsed location dictionaries before they are returned to the mobile app.

## Behaviour

Enrichment is best-effort and should never fail a parse response; provider exceptions, timeouts, and empty results produce `None`.

The service uses an ordered source list and returns the first image found for a place name.

Photo lookups use a shared `photo:` cache namespace, and negative results are retried after the retry window rather than treated as permanent misses.

Cached parse responses are enriched on both cache hits and misses, then persisted again when new photos are found.

Outbound provider requests are throttled to a minimum spacing regardless of how many places are being enriched concurrently, so a large batch cannot trip a provider's rate limit. If a provider signals rate limiting, the affected place is left without a photo and is **not** cached as a negative result (a rate limit is not evidence the place lacks a photo), and every subsequent request — this batch and later ones — waits out the provider's given backoff window before trying again.

## API

```python
async def enrich_locations_with_photos(locations: list[dict]) -> list[dict]:
    """Fill photo_url on location dicts missing a truthy photo_url; mutates and returns the same list."""

async def enrich_response_with_photos(response: dict) -> dict:
    """Fill photo_url on response locations and route.ordered_locations; mutates and returns the same dict."""

async def get_or_build_response(key: str, build_fn: Callable[[], Awaitable[dict]]) -> dict:
    """Return an enriched cached response or build, enrich, cache, and return a new response."""

async def fetch(client: AsyncSession, name: str) -> str | None:
    """Provider contract for new sources; use the shared curl_cffi client and return one image URL or None. Raise RateLimited (do not return None) on a 429 so the wrapper doesn't miscache it as a genuine miss."""
```
