# Place Search Service

## Overview

Mapbox Search Box client backing interactive place search, so places can be added by name instead of only through an import.

## Behaviour

Search is two calls, not one. `suggest()` returns candidates carrying no coordinates; `retrieve()` turns one candidate into a full place. This mirrors how Mapbox bills — one search *session* rather than one request per keystroke — so a typeahead can call `suggest()` freely and pay once when the user picks a result.

The session token is supplied by the caller and passed through untouched. This module never generates, defaults, or rotates one: only the client knows when a typing session begins and ends, and a server-invented token would bill every keystroke as its own session. Both functions require it.

`retrieve()` returns a list. A `poi` suggestion resolves to one place, but a `brand` suggestion resolves to every branch Mapbox knows about, so callers must handle more than one. Features without coordinates are dropped rather than returned half-formed.

Results are adapted to the shared `LocationItem` shape used by the parse pipelines, with `source` set to `mapbox` and `external_id` carrying the `mapbox_id` for later matching. `city`/`region`/`country` come from the feature's context. Mapbox supplies neither descriptions nor photos, so `description` and `photo_url` are left unset for the existing photo backfill to fill in, and `confidence` is left unset rather than invented — retrieve carries no match score.

Suggestions and retrieved places are cached under the `search:` namespace, suggestions briefly (they change as the user types) and retrieved places longer (stable POI data). Cache keys ignore the session token, so a repeated query is served from cache across sessions.

### Status

- **Rate limited** — a 429 raises `RateLimited` carrying the provider's `Retry-After`, never an empty result, so a throttled call cannot be mistaken for "nothing found".
- **Unavailable** — no configured token, a network failure, or any other non-2xx raises `SearchUnavailable`.

## API

```python
ATTRIBUTION: str  # required credit line to display wherever results are shown

async def suggest(
    query: str,
    session_token: str,          # client-generated; never created here
    proximity: str | None = None,  # "lng,lat" to bias toward the user
    limit: int = 10,             # clamped to Mapbox's maximum of 10
    language: str = "en",
    country: str | None = None,  # ISO 3166-1 alpha-2
) -> list[dict]                  # candidates without coordinates

async def retrieve(mapbox_id: str, session_token: str) -> list[dict]
    """One suggestion into full LocationItem-shaped places; a brand yields several."""

class RateLimited(Exception): retry_after: int | None
class SearchUnavailable(Exception): ...
```

## Related docs

- [FETCHPARSE.md](../../../src/features/parse-route/FETCHPARSE.md) — the endpoints that expose this service
- [PLACE-IMAGE-SERVICE.md](../place_image_service/PLACE-IMAGE-SERVICE.md) — fills the `photo_url` this service leaves unset
