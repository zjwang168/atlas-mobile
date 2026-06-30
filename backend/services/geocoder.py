"""Mapbox Geocoding API client.

Converts place names to geographic coordinates using the Mapbox Geocoding API.
Uses the same public token as the frontend.
"""

import asyncio
import difflib
import os
import urllib.parse
from math import atan2, cos, radians, sin, sqrt
from typing import Optional

import httpx

MAPBOX_GEOCODING_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places/{query}.json"

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

# Retrieve token from environment (shared with frontend via .env)
MAPBOX_TOKEN = os.environ.get("MAPBOX_ACCESS_TOKEN", "")


def _compute_confidence(name: str, candidate: dict,
                         city_center: tuple[float, float] | None = None,
                         city_name: str | None = None) -> float:
    """
    Compute a confidence score (0.0-1.0) for a geocoding candidate.

    Factors:
    1. Name similarity between query and candidate place_name (0.4 weight)
    2. City name match with inferred region (0.3 weight)
    3. Proximity to city center (0.2 weight)
    4. Result type priority: POI > address > neighborhood > locality (0.1 weight)
    """
    score = 0.0

    # 1. Name similarity (0.4)
    query_name = name.lower().strip()
    place_name = candidate.get("place_name", "").lower()
    name_sim = difflib.SequenceMatcher(None, query_name, place_name).ratio()
    score += 0.4 * min(name_sim, 1.0)

    # 2. City name match (0.3)
    if city_name:
        city_lower = city_name.lower()
        if city_lower in place_name:
            score += 0.3
        context = candidate.get("context", [])
        for ctx in context:
            if city_lower in ctx.get("text", "").lower():
                score += 0.3
                break

    # 3. Proximity to city center (0.2)
    if city_center:
        center_lng, center_lat = city_center
        cand_lng, cand_lat = candidate["geometry"]["coordinates"]
        # Approximate distance via haversine
        dlat = radians(cand_lat - center_lat)
        dlon = radians(cand_lng - center_lng)
        a = sin(dlat / 2) ** 2 + cos(radians(center_lat)) * cos(radians(cand_lat)) * sin(dlon / 2) ** 2
        c = 2 * atan2(sqrt(a), sqrt(1 - a))
        dist_km = 6371 * c
        # Score decreases with distance: 1.0 at 0km, 0.0 at 50km+
        proximity_score = max(0.0, 1.0 - dist_km / 50.0)
        score += 0.2 * proximity_score

    # 4. Result type priority (0.1)
    place_types = candidate.get("place_type", [])
    type_priority = {
        "poi": 1.0,
        "address": 0.9,
        "neighborhood": 0.7,
        "locality": 0.5,
        "place": 0.4,
        "region": 0.2,
        "country": 0.1,
    }
    best_type_score = max(type_priority.get(t, 0.3) for t in place_types) if place_types else 0.3
    score += 0.1 * best_type_score

    return min(score, 1.0)


async def geocode_with_candidates(
    location_name: str,
    token: Optional[str] = None,
    proximity: Optional[tuple[float, float]] = None,
    limit: int = 5,
) -> list[dict]:
    """Geocode with multiple candidates and confidence scoring.

    Returns a list of candidate dicts sorted by descending confidence.
    Each candidate has: name, latitude, longitude, full_address, confidence, place_type
    Empty list if no results found.
    """
    key = token or MAPBOX_TOKEN
    if not key:
        return []

    encoded = urllib.parse.quote(location_name)
    url = MAPBOX_GEOCODING_URL.format(query=encoded)
    params = {
        "access_token": key,
        "limit": limit,
    }
    if proximity:
        params["proximity"] = f"{proximity[0]},{proximity[1]}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

        features = data.get("features", [])
        if not features:
            return []

        candidates = []
        for feat in features:
            center = feat.get("center", [0, 0])
            candidates.append({
                "name": feat.get("text", location_name),
                "latitude": center[1],
                "longitude": center[0],
                "full_address": feat.get("place_name", location_name),
                "place_type": feat.get("place_type", []),
                "geometry": feat,  # Keep original for confidence computation
                "relevance": feat.get("relevance", 0),
            })

        return candidates
    except Exception:
        return []


async def _geocode_nominatim(location_name: str,
                              city_name: str | None = None) -> dict | None:
    """
    Geocode via Nominatim (OpenStreetMap free API).
    Used as a fallback when Mapbox returns low-confidence results.

    Nominatim has excellent POI coverage — it knows ROM, AGO, CN Tower, etc.
    Rate limit: 1 req/sec (we respect this via asyncio.sleep).
    """
    # Respect Nominatim rate limit
    await asyncio.sleep(1.1)

    headers = {
        "User-Agent": "OurAtlasApp/1.0 (travel itinerary app; contact@ouratlas.app)",
    }

    # Search with city context for better results
    query = location_name
    if city_name and city_name.lower() not in location_name.lower():
        query = f"{location_name}, {city_name}"

    params = {
        "q": query,
        "format": "jsonv2",
        "limit": 1,
        "addressdetails": 1,
        "extratags": 1,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                NOMINATIM_URL,
                params=params,
                headers=headers
            )
            response.raise_for_status()
            data = response.json()

        if not data:
            return None

        result = data[0]

        # Determine result type for confidence
        osm_type = result.get("osm_type", "")
        category = result.get("category", "")
        result_type = result.get("type", "")

        # POI-level results have osm_type = node/way and category != place
        is_poi = osm_type in ("node", "way") and category != "place"

        return {
            "latitude": float(result["lat"]),
            "longitude": float(result["lon"]),
            "full_address": result.get("display_name", query),
            "place_type": [result_type],
            "is_exact": is_poi,
            "confidence": 0.7 if is_poi else 0.4,
            "source": "nominatim",
        }
    except Exception as e:
        print(f"[Nominatim] Failed for '{query}': {e}")
        return None


async def geocode(
    location_name: str,
    token: Optional[str] = None,
    proximity: Optional[tuple[float, float]] = None,
    city_name: Optional[str] = None,
    city_center: Optional[tuple[float, float]] = None,
) -> dict | None:
    """Geocode with Mapbox + Nominatim fallback.

    Strategy:
    1. Try Mapbox first (with proximity bias + confidence scoring)
    2. If Mapbox returns an exact POI match → use it
    3. If Mapbox returns a city-level fallback (low confidence) → try Nominatim
    4. If Nominatim succeeds → use Nominatim result
    5. If both fail → return None (no fake coordinates)

    Never returns a default/fallback coordinate.
    """
    # Step 1: Try Mapbox
    candidates = await geocode_with_candidates(
        location_name, token=token, proximity=proximity, limit=5
    )

    if candidates:
        # Score candidates
        for c in candidates:
            c["confidence"] = _compute_confidence(
                location_name, c.get("geometry", {}),
                city_center=city_center,
                city_name=city_name,
            )

        candidates.sort(key=lambda c: c["confidence"], reverse=True)
        best = candidates[0]

        place_types = best.get("place_type", [])
        is_exact = "poi" in place_types or "address" in place_types

        if is_exact and best["confidence"] > 0.3:
            # Mapbox found an exact POI match — use it
            return {
                "name": location_name,
                "latitude": best["latitude"],
                "longitude": best["longitude"],
                "full_address": best["full_address"],
                "confidence": best["confidence"],
                "is_exact": True,
                "source": "mapbox",
            }

        # Mapbox found a non-POI result — try Nominatim
        print(f"[Geocoder] Mapbox low confidence for '{location_name}' — trying Nominatim")

    # Step 2: Try Nominatim
    nominatim_result = await _geocode_nominatim(location_name, city_name=city_name)
    if nominatim_result:
        nominatim_result["name"] = location_name
        print(f"[Geocoder] Nominatim found '{location_name}' → ({nominatim_result['latitude']:.4f}, {nominatim_result['longitude']:.4f}) [{'EXACT' if nominatim_result['is_exact'] else 'approx'}]")
        return nominatim_result

    # Step 3: Both failed — return None
    return None


async def batch_geocode(
    location_names: list[str],
    token: Optional[str] = None,
    proximity: Optional[tuple[float, float]] = None,
    city_name: Optional[str] = None,
    city_center: Optional[tuple[float, float]] = None,
) -> list[dict | None]:

    async def _geocode_one(name: str) -> dict | None:
        try:
            return await geocode(
                name, token=token, proximity=proximity,
                city_name=city_name, city_center=city_center,
            )
        except Exception:
            return None

    tasks = [_geocode_one(name) for name in location_names]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    return [r if isinstance(r, dict) else None for r in results]
