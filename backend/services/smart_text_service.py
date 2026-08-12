"""Smart-text import pipeline built on LangChain-backed LLM stages."""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime

from backend.langchain.tools import web_search
from backend.services.atlas_ai_discovery import discover_places_from_query
from backend.services.geocoder import batch_geocode
from backend.services.llm_client import call_llm, parse_llm_response
from backend.services.route_planner import plan_route
from backend.services.translation import translate_to_english

SMART_TEXT_WEB_PROMPT = """You are a live-web travel-location planner for a mobile app.

You must use live web-backed reasoning. Do not answer from memory.
You will receive raw search results. Extract the most relevant place-focused facts only.
Do not add facts that are not present in the search results.

Rules:
1. Use only the supplied raw search results.
2. Prefer the newest and most recent sources when they disagree.
3. If the evidence is old, conflicting, or insufficient, say
   "No Place Information that can be extracted" instead of guessing.
4. Return a concise summary of verified places, addresses, or venue names.
5. If you are not confident, say so plainly and do not invent details.

User question:
{query}
"""

SMART_TEXT_EXTRACT_PROMPT = """You are a travel-location planner for a mobile app.

Given a user query or live-web summary, return real-world places that best answer it.

Output ONLY valid JSON in this exact shape:
{{
  "title": "short human-friendly title",
  "inferred_region": "city/region if known, otherwise null",
  "region_tagline": "2-4 English words that evoke the inferred region, or null",
  "places": [
    {{
      "name": "place name",
      "context": "city / region / country if helpful",
      "address": "full address if you know it, otherwise null",
      "description": "short reason this place is relevant",
      "sentiment": "positive|neutral|negative",
      "category": "Tourist Attractions|Dining & Drinking|Entertainment|Museums & Exhibitions|Transit Hubs|Religious Sites|Others",
      "fictional_or_alt_name": "optional alternate label or null"
    }}
  ]
}}

Rules:
1. Return the smallest useful set of places that answers the query.
2. If the query is about one specific place, return one place.
3. If the query naturally requires multiple places, return only the best matching places.
4. Prefer real, visitable places.
5. If the answer is about a TV show, movie, celebrity, or event, return the locations that are most relevant to the query.
6. If you know the exact address, include it; otherwise leave it null.
7. Keep descriptions concise.
8. Output in English.
9. Set region_tagline to exactly 2-4 refined English words, not a sentence.

Input:
{query}

JSON:
"""

NO_PLACE_INFO = "No Place Information that can be extracted"


def _current_date_line() -> str:
    return f"Current date: {datetime.now().date().isoformat()}."


async def analyze_smart_text(query: str, use_web_search: bool = False, request_id: str | None = None) -> dict:
    """Analyze a smart-text query into geocoded places.

    Pasted notes and itineraries are parsed directly. Live research remains an
    explicit opt-in for short discovery queries where the source text itself
    does not contain the needed place information.
    """
    text = (query or "").strip()
    text = await translate_to_english(text, request_id=request_id)

    if _looks_address_heavy(text):
        try:
            from backend.services import progress

            progress.stream_note(request_id, "smart_text:discovery", {"detail": "Address-heavy text detected; using discovery routing."})
            return await discover_places_from_query(text, request_id=request_id)
        except Exception:
            pass

    from backend.services import progress
    source_text = text
    if use_web_search:
        progress.stream_note(request_id, "smart_text:web_search", {"detail": "Searching live web sources."})
        source_text = await _run_tavily_web_research(text, request_id=request_id)
        if not source_text or NO_PLACE_INFO in source_text:
            raise ValueError(NO_PLACE_INFO)

    progress.stream_note(
        request_id,
        "smart_text:deepseek",
        {"detail": "Converting raw search results into structured places." if use_web_search else "Converting pasted content into structured places."},
    )
    parsed = await _extract_places_from_text(source_text, request_id=request_id)
    if not parsed.get("places"):
        raise ValueError(NO_PLACE_INFO)

    title = parsed.get("title") or text[:80]
    inferred_region = parsed.get("inferred_region")
    region_tagline = parsed.get("region_tagline")
    if inferred_region:
        progress.stream_note(request_id, "analysis:region", {"region": inferred_region, "tagline": region_tagline})
    places = parsed.get("places", [])
    progress.stream_identified_places(request_id, places)
    geocoded = await _geocode_places(places, inferred_region, request_id=request_id)
    if not geocoded:
        raise ValueError(NO_PLACE_INFO)

    progress.stream_note(request_id, "smart_text:route", {"detail": "Planning route across resolved places."})
    route = plan_route(geocoded)
    return {
        "title": title,
        "locations": geocoded,
        "route": route,
        "removed_noise": parsed.get("removed_noise", []),
        "removed_hierarchy": parsed.get("removed_hierarchy", []),
        "inferred_region": inferred_region,
        "region_tagline": region_tagline,
        "source_type": "smart_text_web",
        "is_multi_region": False,
    }


async def _run_tavily_web_research(query: str, request_id: str | None = None) -> str:
    search_queries = _build_search_queries(query)
    raw_results: list[dict] = []

    async def search_one(search_query: str) -> tuple[str, str]:
        progress_note = {"detail": f"Searching: {search_query}"}
        from backend.services import progress

        progress.stream_note(request_id, "smart_text:web_search", progress_note)
        search_output = await asyncio.to_thread(web_search, search_query, 5)
        return search_query, search_output

    searches = await asyncio.gather(*(search_one(search_query) for search_query in search_queries[:3]))
    for search_query, search_output in searches:
        try:
            parsed = json.loads(search_output)
        except json.JSONDecodeError:
            parsed = {"query": search_query, "results": [], "error": "Invalid Tavily response"}
        results = parsed.get("results") or []
        for item in results:
            if isinstance(item, dict):
                raw_results.append(
                    {
                        "query": search_query,
                        "title": item.get("title", ""),
                        "url": item.get("url", ""),
                        "snippet": item.get("snippet", ""),
                    }
                )

    if not raw_results:
        return NO_PLACE_INFO

    return _format_raw_search_results(query, raw_results)


def _parse_places_response(content: str) -> dict:
    normalized = parse_llm_response(content)
    try:
        parsed = json.loads(normalized.get("content", "{}"))
        if not isinstance(parsed, dict):
            return {"places": []}
        return parsed
    except json.JSONDecodeError:
        return {"places": []}


async def _extract_places_from_text(text: str, request_id: str | None = None) -> dict:
    """Use DeepSeek to convert the web summary into structured places."""
    llm_result = await asyncio.to_thread(
        call_llm,
        messages=[{"role": "system", "content": SMART_TEXT_EXTRACT_PROMPT.format(query=text[:4000])}],
        temperature=0.2,
        max_tokens=4096,
        provider="deepseek",
        model="deepseek-chat",
        request_id=request_id,
    )
    parsed = _parse_places_response(llm_result.get("content", "{}"))
    if not parsed.get("places"):
        return {"places": []}

    raw_places = parsed.get("places", [])
    deduped = _dedupe_places(raw_places)
    if not deduped and raw_places:
        deduped = _normalize_raw_places(raw_places)
    filtered = _filter_places_with_hierarchy(deduped)
    return {
        "title": parsed.get("title"),
        "inferred_region": parsed.get("inferred_region"),
        "region_tagline": parsed.get("region_tagline"),
        "places": filtered["locations"] or deduped,
        "removed_noise": parsed.get("removed_noise", []),
        "removed_hierarchy": filtered["removed_hierarchy"],
    }


async def _geocode_places(places: list[dict], inferred_region: str | None, request_id: str | None = None) -> list[dict]:
    from backend.services import progress

    progress.stream_note(request_id, "smart_text:geocode", {"detail": f"Geocoding {len(places)} places."})
    geocoded = await _geocode_places_async(places, inferred_region)
    progress.stream_note(request_id, "smart_text:geocode_done", {"detail": f"Resolved {len(geocoded)} places."})
    return geocoded


async def _geocode_places_async(places: list[dict], inferred_region: str | None) -> list[dict]:
    geocode_queries = []
    for place in places:
        address = (place.get("address") or "").strip()
        context = (place.get("context") or "").strip()
        name = (place.get("name") or "").strip()
        fallback = ", ".join(part for part in [name, context] if part)
        geocode_queries.append({
            "query": address or fallback,
            "fallback_query": fallback if fallback and fallback != address else None,
        })

    geocoded = await batch_geocode(geocode_queries, city_name=inferred_region)
    resolved_locations: list[dict] = []
    for place, geo in zip(places, geocoded):
        if not geo:
            continue
        display_name = place.get("name", "").strip() or geo.get("name", "")
        alt_name = place.get("fictional_or_alt_name")
        description = (place.get("description") or "").strip() or None
        if alt_name:
            description = f"{alt_name}. {description}" if description else alt_name
        resolved_locations.append({
            "name": display_name,
            "latitude": geo["latitude"],
            "longitude": geo["longitude"],
            "full_address": place.get("address") or geo.get("full_address") or display_name,
            "description": description,
            "category": place.get("category"),
            "sentiment": place.get("sentiment"),
            "is_exact": geo.get("is_exact"),
            "confidence": geo.get("confidence"),
            "source": "smart_text",
        })
    return resolved_locations


def _looks_address_heavy(text: str) -> bool:
    return bool(re.search(r"\d{1,5}\s+[\w\s]+(?:st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|ln|lane|way|pkwy|parkway|hwy|highway)", text, re.I))


def _build_search_queries(query: str) -> list[str]:
    text = (query or "").strip()
    if not text:
        return []
    return [
        text,
        f"{text} official",
        f"{text} news",
    ]


def _format_raw_search_results(original_query: str, results: list[dict]) -> str:
    lines = [
        f"Search query: {original_query}",
        "Raw search results:",
    ]
    for index, item in enumerate(results[:12], start=1):
        lines.append(f"{index}. Title: {item.get('title', '')}")
        lines.append(f"   URL: {item.get('url', '')}")
        snippet = str(item.get("snippet", "")).strip()
        if snippet:
            lines.append(f"   Snippet: {snippet}")
    return "\n".join(lines)


def _dedupe_places(places: list[dict]) -> list[dict]:
    seen: set[str] = set()
    deduped: list[dict] = []
    for place in places:
        key = (place.get("name") or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(place)
    return deduped


def _normalize_raw_places(places: list[dict]) -> list[dict]:
    return [p for p in places if (p.get("name") or "").strip()]


def _filter_places_with_hierarchy(places: list[dict]) -> dict:
    normalized = []
    removed_hierarchy = []
    for place in places:
        name = (place.get("name") or "").strip()
        if not name:
            removed_hierarchy.append({"name": "unknown", "reason": "Removed: empty name", "parent_of": None})
            continue
        normalized.append(place)
    return {"locations": normalized, "removed_hierarchy": removed_hierarchy}
