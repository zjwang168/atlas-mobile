"""Mapbox Geocoding API client.

Converts place names to geographic coordinates using the Mapbox Geocoding API.
Uses the same public token as the frontend.
"""

import asyncio
import os
import urllib.parse
from typing import Optional

import httpx

MAPBOX_GEOCODING_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places/{query}.json"

# Retrieve token from environment (shared with frontend via .env)
MAPBOX_TOKEN = os.environ.get("MAPBOX_ACCESS_TOKEN", "")


async def geocode(
    location_name: str,
    token: Optional[str] = None,
) -> dict:
    """Convert a location name to coordinates via Mapbox Geocoding API.

    Args:
        location_name: The name of the place (e.g. "Golden Gate Bridge, San Francisco").
        token: Mapbox access token. Falls back to MAPBOX_ACCESS_TOKEN env var.

    Returns:
        dict with keys: name, latitude, longitude, full_address

    Raises:
        ValueError: if token is missing or no results found.
        httpx.HTTPError: if the API call fails.
    """
    key = token or MAPBOX_TOKEN
    if not key:
        raise ValueError(
            "Mapbox access token is missing. "
            "Set MAPBOX_ACCESS_TOKEN environment variable."
        )

    encoded = urllib.parse.quote(location_name)
    url = MAPBOX_GEOCODING_URL.format(query=encoded)
    params = {
        "access_token": key,
        "limit": 1,
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        data = response.json()

    features = data.get("features", [])
    if not features:
        raise ValueError(f"No geocoding results for: {location_name}")

    feature = features[0]
    center = feature.get("center", [0, 0])

    return {
        "name": location_name,
        "longitude": center[0],
        "latitude": center[1],
        "full_address": feature.get("place_name", location_name),
    }


async def batch_geocode(
    location_names: list[str],
    token: Optional[str] = None,
) -> list[dict]:
    """Geocode a list of location names concurrently.

    Args:
        location_names: List of place name strings.
        token: Optional Mapbox token override.

    Returns:
        List of geocoded result dicts. Failed items are skipped with a warning.
    """
    tasks = [geocode(name, token=token) for name in location_names]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    geocoded = []
    for name, result in zip(location_names, results):
        if isinstance(result, Exception):
            print(f"[geocoder] Warning: failed to geocode '{name}': {result}")
        else:
            geocoded.append(result)
    return geocoded
