"""USDA Local Food Portal — farmers markets, queried by radius.

The only surveyed source that carries real coordinates on every row and
filters by radius server-side, which is exactly the distance-first model this
endpoint wants.

It has no opening hours, by any route — the list API, the undocumented
`listinginfo` endpoint, the rendered listing page, and the data.gov exports
were all checked and all end without a schedule field. See
`experiments/DMV-EVENT-SOURCES.md`; that question is settled, not open. A
market therefore arrives as a place with a season, not as a dated event.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

from backend.services.events_service.models import clean_str, event_row, to_float

logger = logging.getLogger("atlas.events.usda")

SOURCE_ID = "usda"
API_URL = "https://www.usdalocalfoodportal.com/api/farmersmarket/"

# The host answers non-browser agents with a bare 118-byte HTML 403 — the same
# response for a valid key, an invalid one, and none at all, so a working key
# looks broken. A normal browser UA is what gets a keyed request through.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0 Safari/537.36"
)

REQUEST_TIMEOUT_S = 12.0

# The API takes miles. Callers work in kilometres everywhere else.
KM_PER_MILE = 1.609344


def is_configured() -> bool:
    return bool(os.environ.get("USDA_API_KEY"))


async def fetch(lat: float, lng: float, radius_km: float) -> list[dict]:
    """Markets within `radius_km`. Raises on transport or shape failure so the
    orchestrator can report this source as degraded rather than silently thin."""
    api_key = os.environ.get("USDA_API_KEY")
    if not api_key:
        raise RuntimeError("USDA_API_KEY is not set")

    params = {
        "apikey": api_key,
        "x": f"{lng:.6f}",
        "y": f"{lat:.6f}",
        "radius": f"{max(1, round(radius_km / KM_PER_MILE))}",
    }
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_S) as client:
        response = await client.get(
            API_URL, params=params, headers={"User-Agent": USER_AGENT}
        )
        response.raise_for_status()
        payload = response.json()

    records = payload.get("data") if isinstance(payload, dict) else payload
    if not isinstance(records, list):
        raise ValueError(f"unexpected USDA payload shape: {type(payload).__name__}")

    return [row for row in (_to_event(m) for m in records) if row is not None]


def _to_event(market: dict) -> Optional[dict]:
    listing_id = clean_str(market.get("listing_id"))
    title = clean_str(market.get("listing_name"))
    if not listing_id or not title:
        return None

    return event_row(
        source=SOURCE_ID,
        ident=f"{SOURCE_ID}:{listing_id}",
        title=title,
        category="market",
        # No start time by design: a market is a recurring season, not a dated
        # event. `listing_desc` is the only free-text field and is empty on
        # most records, so schedule_text is usually null too.
        schedule_text=clean_str(market.get("listing_desc")),
        location_name=title,
        address=clean_str(market.get("location_address")),
        latitude=to_float(market.get("location_y")),
        longitude=to_float(market.get("location_x")),
        url=clean_str(market.get("media_website")),
        # `listing_image` is a bare filename and is usually the shared
        # placeholder, so it is dropped rather than dressed up as a real photo.
        image_url=None,
        is_free=True,
    )
