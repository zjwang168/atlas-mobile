"""Structured landmark seeds for Atlas focus areas.

Wikidata is used as an online index while a city is cold. Results are cached
in-process so repeat Atlas opens do not depend on text-based POI search.
"""

from __future__ import annotations

import asyncio
import math
import time
from typing import Any, Optional

import httpx

WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql"
WIKIDATA_ENTITIES_URL = "https://www.wikidata.org/w/api.php"
CACHE_TTL_S = 24 * 60 * 60
# This route is a cold-start seed, not a global-data export. WDQS declines
# broad geographic scans on its public endpoint, while a city-centre 12 km
# lookup is fast and sufficient to choose one initial place.
MAX_RADIUS_KM = 12
_cache: dict[tuple[float, float, int], tuple[float, list[dict[str, Any]]]] = {}
_locks: dict[tuple[float, float, int], asyncio.Lock] = {}


def _cache_key(longitude: float, latitude: float, radius_km: float) -> tuple[float, float, int]:
    return (round(longitude, 2), round(latitude, 2), round(radius_km))


def _distance_km(longitude: float, latitude: float, candidate_longitude: float, candidate_latitude: float) -> float:
    latitude_delta = math.radians(candidate_latitude - latitude)
    longitude_delta = math.radians(candidate_longitude - longitude)
    a = math.sin(latitude_delta / 2) ** 2 + math.cos(math.radians(latitude)) * math.cos(math.radians(candidate_latitude)) * math.sin(longitude_delta / 2) ** 2
    return 6371 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _category(instance_label: str) -> str:
    value = instance_label.lower()
    if "museum" in value or "gallery" in value:
        return "Museums & Exhibitions"
    if any(term in value for term in ("church", "temple", "mosque", "shrine", "religious")):
        return "Religious Sites"
    if any(term in value for term in ("monument", "memorial", "historic", "heritage", "tower", "bridge", "castle", "palace", "park")):
        return "Tourist Attractions"
    return "Landmark"


def _importance(instance_label: str, distance_km: float) -> float:
    value = instance_label.lower()
    type_bonus = 0
    if any(term in value for term in ("world heritage", "monument", "museum", "historic", "heritage", "landmark")):
        type_bonus = 30
    return type_bonus - min(distance_km, 80) * 0.15


async def _fetch(longitude: float, latitude: float, radius_km: float) -> list[dict[str, Any]]:
    query = """
SELECT ?place ?coord ?distance WHERE {
  SERVICE wikibase:around {
    ?place wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(%(longitude).6f %(latitude).6f)"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "%(radius).1f" .
    bd:serviceParam wikibase:distance ?distance .
  }
  ?place wdt:P31/wdt:P279* ?root .
  VALUES ?root {
    wd:Q570116 wd:Q4989906 wd:Q33506 wd:Q839954 wd:Q916333
    wd:Q751876 wd:Q16970 wd:Q16560 wd:Q22698 wd:Q34763 wd:Q23413
  }
}
ORDER BY ?distance
LIMIT 50
""" % {"longitude": longitude, "latitude": latitude, "radius": radius_km}
    headers = {"Accept": "application/sparql-results+json", "User-Agent": "OurAtlas/1.0 (contact=dev@ouratlas.app)"}
    async with httpx.AsyncClient(http2=True, timeout=httpx.Timeout(6.0, connect=3.0), headers=headers) as client:
        response = await client.get(WIKIDATA_SPARQL_URL, params={"query": query, "format": "json"})
        response.raise_for_status()
    rows = response.json().get("results", {}).get("bindings", [])
    raw_places: list[tuple[str, float, float]] = []
    for row in rows:
        coordinate = row.get("coord", {}).get("value", "")
        entity = row.get("place", {}).get("value", "").rsplit("/", 1)[-1]
        try:
            point = coordinate.removeprefix("Point(").removesuffix(")").split()
            raw_places.append((entity, float(point[0]), float(point[1])))
        except (IndexError, TypeError, ValueError):
            continue
    if not raw_places:
        return []
    # wbgetentities accepts at most 50 ids per request; the geo query is
    # already distance-sorted, so retain its nearest 50 for the seed lookup.
    ids = "|".join(entity for entity, _, _ in raw_places[:50])
    async with httpx.AsyncClient(http2=True, timeout=httpx.Timeout(6.0, connect=3.0), headers={"User-Agent": "OurAtlas/1.0 (contact=dev@ouratlas.app)"}) as client:
        entity_response = await client.get(WIKIDATA_ENTITIES_URL, params={
            "action": "wbgetentities",
            "ids": ids,
            "props": "labels|claims",
            "languages": "en",
            "format": "json",
        })
    entity_response.raise_for_status()
    entities = entity_response.json().get("entities", {})
    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    excluded_keywords = ("university", "school", "hospital", "road", "street", "government", "company", "airport", "railway", "station", "hotel", "subdistrict", "industrial", "laboratory")
    for entity, candidate_longitude, candidate_latitude in raw_places:
        data = entities.get(entity, {})
        name = data.get("labels", {}).get("en", {}).get("value", "").strip()
        if not name or entity in seen:
            continue
        seen.add(entity)
        instance_ids = [claim.get("mainsnak", {}).get("datavalue", {}).get("value", {}).get("id", "") for claim in data.get("claims", {}).get("P31", [])]
        instance_label = " ".join(instance_ids)
        name_lower = name.lower()
        if any(keyword in name_lower for keyword in excluded_keywords):
            continue
        distance = _distance_km(longitude, latitude, candidate_longitude, candidate_latitude)
        score = _importance(instance_label, distance)
        results.append({
            "id": f"wikidata:{entity}",
            "name": name,
            "longitude": candidate_longitude,
            "latitude": candidate_latitude,
            "category": _category(instance_label),
            "source": "wikidata",
            "wikidata_id": entity,
            "distance_km": round(distance, 2),
            "importance_score": round(score, 2),
        })
    return sorted(results, key=lambda item: (-item["importance_score"], item["distance_km"], item["name"]))


async def landmarks_near(longitude: float, latitude: float, radius_km: float = 40) -> list[dict[str, Any]]:
    radius = max(1, min(MAX_RADIUS_KM, radius_km))
    key = _cache_key(longitude, latitude, radius)
    cached = _cache.get(key)
    if cached and time.monotonic() - cached[0] < CACHE_TTL_S:
        return cached[1]
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        cached = _cache.get(key)
        if cached and time.monotonic() - cached[0] < CACHE_TTL_S:
            return cached[1]
        landmarks = await _fetch(longitude, latitude, radius)
        _cache[key] = (time.monotonic(), landmarks)
        return landmarks
