"""Mapbox Geocoding API client.

Converts place names to geographic coordinates using the Mapbox Geocoding API.
Uses the same public token as the frontend.
"""

import asyncio
import difflib
import os
import time
import urllib.parse
from math import atan2, cos, radians, sin, sqrt
from typing import Optional

import httpx

from backend.services import cache as geo_cache

MAPBOX_GEOCODING_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places/{query}.json"

# Retrieve token from environment (shared with frontend via .env)
MAPBOX_TOKEN = os.environ.get("MAPBOX_ACCESS_TOKEN", "")

GEOAPIFY_URL = "https://api.geoapify.com/v1/geocode/search"
LOCATIONIQ_URL = "https://us1.locationiq.com/v1/search.php"

GEOAPIFY_KEY = os.environ.get("GEOAPIFY_API_KEY", "")
LOCATIONIQ_KEY = os.environ.get("LOCATIONIQ_API_KEY", "")

# Nominatim (OSM-based, best POI coverage but rate-limited)
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# Photon (OSM-based, complementary coverage)
PHOTON_URL = "https://photon.komoot.io/api"


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


async def _geocode_geoapify(location_name: str,
                             city_name: str | None = None) -> dict | None:
    """Geocode via Geoapify (free: 3,000 req/day)."""
    if not GEOAPIFY_KEY:
        return None
    
    query = location_name
    params = {
        "text": query,
        "apiKey": GEOAPIFY_KEY,
        "limit": 1,
        "lang": "en",
        "filter": "countrycode:us,ca,fr,gb,de,it,es,jp,kr,cn,au,nz",  # Common travel countries
    }
    
    try:
        await asyncio.sleep(0.1)  # Be polite
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(GEOAPIFY_URL, params=params)
            response.raise_for_status()
            data = response.json()
        
        features = data.get("features", [])
        if not features:
            return None
        
        feat = features[0]
        props = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [0, 0])
        
        result_type = props.get("result_type", "")
        is_poi = result_type in ("amenity", "building", "shop", "leisure", "tourism",
                                  "historic", "museum", "attraction")
        
        return {
            "name": location_name,
            "latitude": coords[1],
            "longitude": coords[0],
            "full_address": props.get("formatted", location_name),
            "is_exact": is_poi,
            "confidence": 0.8 if is_poi else 0.5,
            "source": "geoapify",
        }
    except Exception as e:
        print(f"[Geoapify] Failed for '{query}': {e}")
        return None


async def _geocode_locationiq(location_name: str,
                               city_name: str | None = None) -> dict | None:
    """Geocode via LocationIQ (free: 5,000 req/day)."""
    if not LOCATIONIQ_KEY:
        return None
    
    query = location_name
    params = {
        "key": LOCATIONIQ_KEY,
        "q": query,
        "format": "json",
        "limit": 1,
    }
    
    try:
        await asyncio.sleep(0.2)  # Be polite
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(LOCATIONIQ_URL, params=params)
            response.raise_for_status()
            data = response.json()
        
        if not data:
            return None
        
        result = data[0]
        osm_type = result.get("osm_type", "")
        category = result.get("category", "")
        
        is_poi = osm_type in ("node", "way") and category not in ("place", "boundary")
        
        return {
            "name": location_name,
            "latitude": float(result["lat"]),
            "longitude": float(result["lon"]),
            "full_address": result.get("display_name", location_name),
            "is_exact": is_poi,
            "confidence": 0.8 if is_poi else 0.5,
            "source": "locationiq",
        }
    except Exception as e:
        print(f"[LocationIQ] Failed for '{query}': {e}")
        return None


async def _geocode_nominatim(location_name: str,
                              city_name: str | None = None) -> dict | None:
    """Geocode via Nominatim (OSM, best POI coverage, but rate-limited to ~1 req/s)."""
    query = location_name
    params = {
        "q": query,
        "format": "json",
        "limit": 1,
        "addressdetails": 1,
    }
    headers = {
        "User-Agent": "AtlasTravelApp/1.0 (travel-planning-app)",
    }

    try:
        await asyncio.sleep(1.0)  # Respect rate limit: 1 req/s
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(NOMINATIM_URL, params=params, headers=headers)
            response.raise_for_status()
            data = response.json()

        if not data:
            return None

        result = data[0]
        osm_type = result.get("osm_type", "")
        category = result.get("category", "")
        result_type = result.get("type", "")

        is_poi = osm_type in ("node", "way") and category not in ("place", "boundary")

        return {
            "name": location_name,
            "latitude": float(result["lat"]),
            "longitude": float(result["lon"]),
            "full_address": result.get("display_name", location_name),
            "is_exact": is_poi,
            "confidence": 0.7 if is_poi else 0.4,
            "source": "nominatim",
        }
    except Exception as e:
        print(f"[Nominatim] Failed for '{query}': {e}")
        return None


async def _geocode_photon(location_name: str,
                           city_name: str | None = None) -> dict | None:
    """Geocode via Photon (OSM-based, complementary POI coverage, free)."""
    query = location_name
    params = {
        "q": query,
        "limit": 1,
        "lang": "en",
    }

    try:
        await asyncio.sleep(0.5)  # Be polite
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(PHOTON_URL, params=params)
            response.raise_for_status()
            data = response.json()

        features = data.get("features", [])
        if not features:
            return None

        feat = features[0]
        props = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [0, 0])

        osm_type = props.get("osm_type", "")
        osm_key = props.get("osm_key", "")
        is_poi = osm_type in ("N", "W") and osm_key not in ("place", "boundary")

        return {
            "name": location_name,
            "latitude": coords[1],
            "longitude": coords[0],
            "full_address": props.get("name", location_name),
            "is_exact": is_poi,
            "confidence": 0.6 if is_poi else 0.3,
            "source": "photon",
        }
    except Exception as e:
        print(f"[Photon] Failed for '{query}': {e}")
        return None


async def geocode(
    location_name: str,
    token: Optional[str] = None,
    proximity: Optional[tuple[float, float]] = None,
    city_name: Optional[str] = None,
    city_center: Optional[tuple[float, float]] = None,
) -> dict | None:
    """
    Multi-layer geocoding with configurable fallback chain (5 layers).
    
    Priority:
    1. Geoapify (free 3k req/day, fastest, best POI coverage)
    2. LocationIQ (free 5k req/day, fast)
    3. Mapbox (free 50k req/month, fast, fallback)
    4. Nominatim (OSM, best POI coverage, but rate-limited ~1 req/s —
       only called when Mapbox also fails, reducing calls from ~30 to ~3-5)
    5. Photon (OSM-based, complementary coverage, last resort)
    
    Returns None only if ALL geocoders fail.
    Never returns fake/default coordinates.
    """
    cache_key = f"geo:{location_name}:{city_name or ''}"
    cached = geo_cache.get(cache_key)
    if cached:
        return cached

    # Layer 1: Geoapify (fastest, best POI coverage)
    geoapify_result = await _geocode_geoapify(location_name, city_name=city_name)
    if geoapify_result and geoapify_result.get("is_exact"):
        print(f"[Geocoder] Geoapify OK: '{location_name}' → ({geoapify_result['latitude']:.4f}, {geoapify_result['longitude']:.4f}) [EXACT]")
        geo_cache.set(cache_key, geoapify_result, ttl=86400)
        return geoapify_result

    # Layer 2: LocationIQ (fast, free 5k req/day)
    liq_result = await _geocode_locationiq(location_name, city_name=city_name)
    if liq_result and liq_result.get("is_exact"):
        print(f"[Geocoder] LocationIQ OK: '{location_name}' → ({liq_result['latitude']:.4f}, {liq_result['longitude']:.4f}) [EXACT]")
        geo_cache.set(cache_key, liq_result, ttl=86400)
        return liq_result

    # Layer 3: Mapbox (fast, free 50k req/month, fallback)
    mapbox_result = None
    candidates = await geocode_with_candidates(
        location_name, token=token, proximity=proximity, limit=5
    )
    if candidates:
        for c in candidates:
            c["confidence"] = _compute_confidence(
                location_name, c.get("geometry", {}),
                city_center=city_center, city_name=city_name,
            )
        candidates.sort(key=lambda c: c["confidence"], reverse=True)
        best = candidates[0]
        place_types = best.get("place_type", [])
        is_exact = "poi" in place_types or "address" in place_types
        confidence = best["confidence"] if is_exact else max(0.2, best["confidence"] * 0.6)
        mapbox_result = {
            "name": location_name,
            "latitude": best["latitude"],
            "longitude": best["longitude"],
            "full_address": best["full_address"],
            "confidence": confidence,
            "is_exact": is_exact,
            "source": "mapbox",
        }
        
        if is_exact:
            print(f"[Geocoder] Mapbox OK: '{location_name}' → ({mapbox_result['latitude']:.4f}, {mapbox_result['longitude']:.4f}) [EXACT]")
            geo_cache.set(cache_key, mapbox_result, ttl=86400)
            return mapbox_result
    
    # Layer 4: Nominatim (slow, but finds POIs that Mapbox misses)
    # Only called when Mapbox also failed, keeping calls low (~3-5 per request)
    nominatim_result = await _geocode_nominatim(location_name, city_name=city_name)
    if nominatim_result and nominatim_result.get("is_exact"):
        print(f"[Geocoder] Nominatim OK: '{location_name}' → ({nominatim_result['latitude']:.4f}, {nominatim_result['longitude']:.4f}) [EXACT]")
        geo_cache.set(cache_key, nominatim_result, ttl=86400)
        return nominatim_result

    # Layer 5: Photon (last resort — OSM-based, complementary coverage)
    photon_result = await _geocode_photon(location_name, city_name=city_name)
    if photon_result and photon_result.get("is_exact"):
        print(f"[Geocoder] Photon OK: '{location_name}' → ({photon_result['latitude']:.4f}, {photon_result['longitude']:.4f}) [EXACT]")
        geo_cache.set(cache_key, photon_result, ttl=86400)
        return photon_result

    # All geocoders failed to find a POI — return best Mapbox fallback
    if mapbox_result:
        print(f"[Geocoder] All failed — Mapbox fallback: '{location_name}' → ({mapbox_result['latitude']:.4f}, {mapbox_result['longitude']:.4f})")
        geo_cache.set(cache_key, mapbox_result, ttl=3600)
        return mapbox_result
    
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
