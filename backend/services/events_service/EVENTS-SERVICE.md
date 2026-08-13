# Events Service

## Overview

Local events near a coordinate, normalized across three sources into one distance-sorted list, backing `GET /events`.

## Behaviour

Three source adapters run concurrently and are merged into a single shape. They differ in what they can promise, which is why the row shape carries both a date and a schedule string:

- **`usda`** — farmers markets, queried by radius. Full coordinate coverage and the only source that filters server-side. Carries no opening hours by any route, so its rows are recurring, never dated.
- **`nps`** — National Park Service events across a fixed list of DMV park units. Dated, often photographed, and the source of the civic tier the survey could not otherwise reach.
- **`curated`** — a committed file of DMV signature festivals, parades, and specialty markets. Deliberately undated: an annual festival shifts each year, so an entry carries an approximate annual window and human schedule text rather than a date nobody verified.

Three rules hold across all of them.

**A returned event always has coordinates.** Sources get their own chance to backfill — NPS resolves a missing event coordinate from its park — and anything still unplaced is dropped and counted rather than shown at an invented location. This is the contract a distance-sorted list depends on.

**A dated event fills `starts_at`; a recurring one fills `schedule_text` and leaves `starts_at` null.** Callers branch on which is present, never on `source`.

**Deduplication runs once across all sources, after the radius filter.** NPS files a joint programme under every participating park code and a weekday tour series as separate events; USDA lists one market under several spellings and occasionally at two different geocodes. Identity is the app's own `isSamePlace()` rule — name containment plus coordinate proximity — with two additions this feed needs: identity-bearing tokens are compared when containment fails, and rows from a source whose unit of record is a *place* rather than an event collapse on location alone. The occurrence date is not part of identity, so a cluster keeps its soonest member and borrows any fields that member was missing.

**`featured` rows are protected from `limit`, curated ones first.** Without that, a page of nearby rows pushes out the signature event the page exists to surface. The ordering matters because the two layers do not mean the same thing by the flag: the curated one is deliberate, while NPS marks about a third of its feed `Special Event`, routine ranger talks included. The protection never widens the page beyond `limit`.

**Every returned event carries an image, resolved through a four-rung chain.** In order: the event's own photograph; failing that, its park's hero photo from `/parks`; failing that, a category-themed stock picture; and if even the category is unknown, nothing, leaving the client to draw a coloured block. The chain runs *after* dedupe, so a row that borrowed a real photo from a merged sibling keeps it instead of being handed stock. `image_attribution` names the photo's owner and is set only for a real photograph — a stock picture is of the category, not of the event, and captioning it would misdescribe it. `image_is_stock` is the flag a client should branch on.

### Status

Per source, reported in the response rather than thrown:

- **`ok`** — fetched. A count of zero is still `ok`; empty is an answer.
- **`unavailable`** — the fetch raised. The other sources are still served.
- **`not_configured`** — no API key for it.

`EventsUnavailable` is raised only when no source reached `ok`, which the endpoint maps to 503.

Caching is per source, not per request: the NPS fetch is DMV-wide and keyed on the date window alone, so every caller in the region shares one copy, while USDA is keyed on a coarsened query point and radius. `services/cache.py` is deliberately not used — it ignores the TTL argument and persists to disk, which suits parse results and not a feed that goes stale.

## API

```python
ATTRIBUTION: str          # credit line to display wherever results are shown
CATEGORIES: tuple[str]    # festival, market, music, arts, outdoors, history, community

async def get_events(
    lat: float,
    lng: float,
    *,
    radius_km: float = 60.0,        # clamped to MAX_RADIUS_KM
    window_days: int = 30,          # how far ahead to look for dated events
    categories: list[str] | None = None,   # unrecognised names are ignored
    sort: str = "distance",         # "distance" | "soonest"
    limit: int = 60,                # featured rows are protected from this, never exceeding it
    today: date | None = None,      # injectable window origin; tests only
) -> dict
    """{"events": [...], "sources": [...], "attribution", "radius_km", "window_days"}"""

def clear_cache() -> None          # drops every cached source fetch

class EventsUnavailable(Exception): ...   # no source reached `ok`
```

An event row:

```python
{
  "id": str,                # "usda:311197" — source-prefixed
  "source": str,            # "usda" | "nps" | "curated"
  "title": str,
  "category": str,          # one of CATEGORIES
  "starts_at": str | None,  # ISO; null on a recurring event
  "ends_at": str | None,
  "schedule_text": str | None,   # set when starts_at is null
  "location_name": str | None,
  "address": str | None,
  "latitude": float,        # never null
  "longitude": float,       # never null
  "distance_km": float,     # measured from the caller's point, not the source's
  "url": str | None,
  "image_url": str | None,
  "image_attribution": str | None,   # e.g. "NPS"; null when the image is stock
  "image_is_stock": bool,            # generic category photo, not of this event
  "blurb": str | None,
  "is_free": bool | None,
  "featured": bool,         # signature event; protected from `limit`
}
```

### Stock imagery and its licence

`sources/stock_imagery.py` holds a handful of hotlinked Unsplash CDN URLs per category, used under the Unsplash Licence: free for commercial use, no permission and no attribution required. It is deliberately *not* the Unsplash API, which needs a key, obliges you to call their download endpoint, and requires attribution — a lot of contract for a decorative asset. Every URL was fetched and confirmed to return `image/jpeg` before being committed.

Which photo an event gets is keyed on its id, not rotated by a counter, so the same market keeps the same picture across requests and processes rather than appearing to change identity on every refresh.

### Editing the curated layer

`data/dmv_signature_events.json` is the signature layer. After adding an entry or changing an `address`, resolve its coordinates once and commit them:

```
python3 -m backend.services.events_service.geocode_curated --write
```

It geocodes against OpenStreetMap rather than Mapbox because the result is stored in a file we redistribute, which the Mapbox Geocoding terms do not permit. Entries that fail to resolve are left without coordinates and are skipped at load time with a warning.

Nominatim's usage policy requires the request to identify who is running it. The script sends the project's repository URL by default; set `NOMINATIM_CONTACT` to an email to be reachable as a person instead. Nothing at runtime reads it — this is a one-off script, not a server dependency.

### Provider quirks worth knowing before debugging

- **USDA returns a bare 403 to non-browser user agents** — identical with a valid key, an invalid one, or none, so a working key looks rejected. A normal browser UA is sent for this reason. Absent fields arrive as the string `'None'`, and coordinates arrive as strings.
- **The NPS `/events` endpoint ignores `start`**, so it cannot be paged: a `stateCode=DC,MD,VA` query reports 423 results and returns the same 50 every time. One request per park code is the way round it, which is why the park list is enumerated rather than derived from a state filter. A park returning a full page is logged, because anything past it is unreachable.
- **NPS `/parks` does not decode `%2C`.** A comma-separated `parkCode` list has to reach the host raw, but httpx percent-encodes it by default, and the host then reads the whole string as one park code and answers with a single record. That is why the park backfill builds its query string by hand instead of passing `params=` — the encoded form looks like a working request returning a short list, not like an error.

## Related docs

- [DMV-EVENT-SOURCES.md](../../../experiments/DMV-EVENT-SOURCES.md) — the source survey these three adapters were chosen from, and what was rejected
- [DISCOVER.md](../../../src/features/discover/DISCOVER.md) — the screen this feeds
- [SERVICES.md](../../../src/services/SERVICES.md) — `eventsService.ts`, the client
