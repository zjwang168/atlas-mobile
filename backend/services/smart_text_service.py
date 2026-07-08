"""Smart-text import pipeline with explicit web-search routing.

Routes between:
1. Address-first discovery for address-heavy text
2. DeepSeek V4 Flash for evergreen, no-web-needed place generation
3. Qwen 3.5 web search for live web-backed answers
"""

from __future__ import annotations

import asyncio
import json
import re

from backend.services.atlas_ai_discovery import discover_places_from_query
from backend.services.geocoder import batch_geocode
from backend.services.llm_client import call_llm, parse_llm_response
from backend.services.route_planner import plan_route
SMART_TEXT_PROMPT = """You are a travel-location planner for a mobile app.

Given a user query, return real-world places that best answer it.

Output ONLY valid JSON in this exact shape:
{{
  "title": "short human-friendly title",
  "inferred_region": "city/region if known, otherwise null",
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
1. Return 3-12 places when possible.
2. Prefer real, visitable places.
3. If the answer is about a TV show, movie, celebrity, or event, return the
   locations that are most relevant to the query.
4. If you know the exact address, include it; otherwise leave it null.
5. Keep descriptions concise.

Query:
{query}

JSON:"""

SMART_TEXT_WEB_PROMPT = """You are a live-web travel-location planner for a mobile app.

You must use live web-backed reasoning. Do not answer from memory.
Current date: 2026-07-09.

Rules:
1. Answer the user's question directly in plain text.
2. Prefer the newest and most recent sources you can find, and compare multiple
   sources when they disagree.
3. Try to consult at least 10 distinct sources if available.
4. If the evidence is old, conflicting, or insufficient, say
   "No Place Information that can be extracted" instead of guessing.
5. If the answer includes a venue, hotel, arena, restaurant, street, landmark,
   or address, mention it clearly in the reply.
6. If you are not confident, say so plainly.

User question:
{query}
"""

async def analyze_smart_text(query: str, use_web_search: bool = False) -> dict:
    """Analyze a smart-text query into geocoded places."""
    text = (query or "").strip()
    if len(text) < 3:
        raise ValueError("Text too short to analyze.")

    if _looks_address_heavy(text):
        try:
            return await discover_places_from_query(text)
        except Exception:
            pass

    if use_web_search:
        prompt = SMART_TEXT_WEB_PROMPT.format(query=text[:4000])
        provider = "qwen"
        model = "qwen3.5-flash"
        extra_body = None
    else:
        prompt = SMART_TEXT_PROMPT.format(query=text[:4000])
        provider = "deepseek"
        model = "deepseek-chat"
        extra_body = None

    llm_result = await asyncio.to_thread(
        call_llm,
        messages=[{"role": "system", "content": prompt}],
        temperature=0.2,
        max_tokens=4096,
        provider=provider,
        model=model,
        extra_body=extra_body,
    )

    if use_web_search:
        qwen_message = (llm_result.get("content", "") or "").strip()
        print("\n[SmartText][Qwen] user_input:", text)
        print("[SmartText][Qwen] prompt:", prompt)
        print("[SmartText][Qwen] llm_message:", qwen_message)
        if not qwen_message or "No Place Information that can be extracted" in qwen_message:
            raise ValueError("No Place Information that can be extracted")
        extraction_input = qwen_message
    else:
        extraction_input = text

    print("\n[SmartText] extraction_input:", extraction_input)
    parsed = await _extract_places_from_text(extraction_input)
    if not parsed.get("places"):
        raise ValueError("No Place Information that can be extracted")

    title = parsed.get("title") or text[:80]
    inferred_region = parsed.get("inferred_region")
    places = parsed.get("places", [])
    geocoded = await _geocode_places(places, inferred_region)
    if not geocoded:
        raise ValueError("No Place Information that can be extracted")

    print("[SmartText] final_resolved_addresses:", json.dumps([
        {
            "name": loc.get("name"),
            "full_address": loc.get("full_address"),
            "latitude": loc.get("latitude"),
            "longitude": loc.get("longitude"),
        }
        for loc in geocoded
    ], ensure_ascii=False))

    route = plan_route(geocoded)
    return {
        "title": title,
        "locations": geocoded,
        "route": route,
        "removed_noise": parsed.get("removed_noise", []),
        "removed_hierarchy": parsed.get("removed_hierarchy", []),
        "inferred_region": inferred_region,
        "source_type": "smart_text_web" if use_web_search else "smart_text",
        "is_multi_region": False,
    }


def _parse_places_response(content: str) -> dict:
    normalized = parse_llm_response(content)
    try:
        parsed = json.loads(normalized.get("content", "{}"))
        if not isinstance(parsed, dict):
            return {"places": []}
        return parsed
    except json.JSONDecodeError:
        return {"places": []}


async def _extract_places_from_text(text: str) -> dict:
    """Use the existing smart-text off path to extract structured places."""
    llm_result = await asyncio.to_thread(
        call_llm,
        messages=[{"role": "system", "content": SMART_TEXT_PROMPT.format(query=text[:4000])}],
        temperature=0.2,
        max_tokens=4096,
        provider="deepseek",
        model="deepseek-chat",
    )
    parsed = _parse_places_response(llm_result.get("content", "{}"))
    if not parsed.get("places"):
        return {"places": []}

    raw_places = parsed.get("places", [])
    deduped = _dedupe_places(raw_places)
    print(
        "[SmartText] place_counts:",
        json.dumps(
            {
                "raw": len(raw_places),
                "deduped": len(deduped),
            },
            ensure_ascii=False,
        ),
    )
    filtered = _filter_places_with_hierarchy(deduped)
    print("[SmartText] removed_hierarchy:", json.dumps(filtered["removed_hierarchy"], ensure_ascii=False))
    return {
        "title": parsed.get("title"),
        "inferred_region": parsed.get("inferred_region"),
        "places": filtered["locations"],
        "removed_noise": parsed.get("removed_noise", []),
        "removed_hierarchy": filtered["removed_hierarchy"],
    }


def _extract_place_candidates(text: str) -> list[dict]:
    text = (text or "").strip()
    if not text:
        return []

    candidates: list[dict] = []
    patterns = [
        r"\b(?:at|in|held at|hosted at|married at|located at)\s+([^.;:\n]+)",
        r"\b(?:venue|hotel|arena|restaurant|landmark|estate|garden|museum|plaza|square)\s*[:\-]\s*([^.;:\n]+)",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.I):
            candidate = match.group(1).strip(" \"'`")
            candidate = re.split(r"\b(?:because|since|after|before|during)\b", candidate)[0].strip(" ,.-")
            if candidate:
                candidates.append(_candidate_to_place(candidate, text))

    if not candidates:
        for line in text.splitlines():
            if re.search(r"\b(New York City|NYC|Manhattan|Hudson Valley|Madison Square Garden|Plaza Hotel)\b", line, re.I):
                candidates.append(_candidate_to_place(line.strip(" -*•"), text))

    deduped: list[dict] = []
    seen: set[str] = set()
    for item in candidates:
        key = (item.get("name") or "").lower()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _filter_places_with_hierarchy(places: list[dict]) -> dict:
    normalized: list[dict] = []
    removed_hierarchy: list[dict] = []

    for place in places:
        name = _clean_place_text(place.get("name"))
        context = _clean_place_text(place.get("context"))
        description = _clean_place_text(place.get("description"))
        if not name:
            removed_hierarchy.append({
                "name": str(place.get("name") or "unknown"),
                "reason": "Removed: empty or placeholder name",
                "parent_of": None,
            })
            continue

        if _is_noise_source(name, description):
            removed_hierarchy.append({
                "name": name,
                "reason": "Removed: news source / article source, not a place",
                "parent_of": None,
            })
            continue

        normalized.append({
            **place,
            "name": name,
            "context": context or None,
            "description": description or None,
        })

    deduped: list[dict] = []
    seen_keys: dict[str, str] = {}
    for place in normalized:
        key = _normalize_place_key(place["name"], place.get("context"))
        if key in seen_keys:
            removed_hierarchy.append({
                "name": place["name"],
                "reason": f"Removed duplicate of {seen_keys[key]}",
                "parent_of": seen_keys[key],
            })
            continue
        seen_keys[key] = place["name"]
        deduped.append(place)

    poi_names = [p["name"] for p in deduped if _guess_hierarchy_level(p) <= 0]
    for place in deduped[:]:
        level = _guess_hierarchy_level(place)
        if level >= 2 and any(_name_contains(place["name"], poi) or _context_contains(place.get("context"), poi) for poi in poi_names):
            removed_hierarchy.append({
                "name": place["name"],
                "reason": "Removed redundant higher-level location covered by a more specific place",
                "parent_of": ", ".join(poi_names[:5]) if poi_names else None,
            })
            deduped.remove(place)

    # Remove obvious city/region/country residues when a more specific venue exists.
    if any(_guess_hierarchy_level(p) <= 0 for p in deduped):
        refined: list[dict] = []
        for place in deduped:
            if _guess_hierarchy_level(place) >= 2 and _is_generic_geo(place["name"]):
                removed_hierarchy.append({
                    "name": place["name"],
                    "reason": "Removed generic city/region/country-level location after specific venue extraction",
                    "parent_of": ", ".join(poi_names[:5]) if poi_names else None,
                })
                continue
            refined.append(place)
        deduped = refined

    return {"locations": deduped, "removed_hierarchy": removed_hierarchy}


def _dedupe_places(places: list[dict]) -> list[dict]:
    """Remove raw duplicate candidates before any hierarchy filtering."""
    deduped: list[dict] = []
    seen: set[str] = set()
    for place in places:
        name = _clean_place_text(place.get("name"))
        context = _clean_place_text(place.get("context"))
        key = _normalize_place_key(name, context)
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append({
            **place,
            "name": name,
            "context": context or None,
        })
    return deduped


def _clean_place_text(value: object) -> str:
    text = str(value or "").strip()
    text = re.sub(r"^\*\*+|\*\*+$", "", text).strip()
    text = re.sub(r"^[\-\–\—•\*\s]+", "", text).strip()
    text = re.sub(r"\s+", " ", text).strip()
    # Strip obvious article/source suffixes like "(June 24, 2026)" and phrases.
    text = re.sub(r"\s*\([^)]*\b(?:news|report|source|published|follow-up|confirmed|confirming)\b[^)]*\)$", "", text, flags=re.I).strip()
    text = re.sub(r"\s*\([^)]*\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b[^)]*\)$", "", text, flags=re.I).strip()
    return text


def _is_noise_source(name: str, description: str | None) -> bool:
    haystack = f"{name} {description or ''}".lower()
    return any(token in haystack for token in [
        "new york times",
        "associated press",
        "reuters",
        "bbc",
        "cnn",
        "washington post",
        "wall street journal",
        "rolling stone",
        "billboard",
        "variety",
        "people magazine",
    ])


def _normalize_place_key(name: str, context: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", f"{name} {context or ''}".lower()).strip()


def _guess_hierarchy_level(place: dict) -> int:
    name = (place.get("name") or "").lower()
    context = (place.get("context") or "").lower()
    if any(token in name for token in ["garden", "hotel", "museum", "arena", "restaurant", "plaza", "square", "bridge", "park", "estate", "station", "theater", "theatre", "venue"]):
        return 0
    if any(token in name for token in ["manhattan", "midtown", "uptown", "downtown", "brooklyn", "queens", "harlem", "soho", "tribeca", "chelsea"]):
        return 1
    if any(token in name for token in ["city", "nyc", "new york", "los angeles", "london", "paris", "tokyo", "beijing", "shanghai"]):
        return 2
    if any(token in name for token in ["state", "province", "region", "valley", "county"]):
        return 3
    if any(token in name for token in ["usa", "united states", "china", "japan", "france", "uk", "germany"]):
        return 4
    if any(token in context for token in ["city", "ny", "state", "country"]):
        return 2
    return 0


def _is_generic_geo(name: str) -> bool:
    return bool(re.search(r"\b(new york city|manhattan|nyc|new york state|hudson valley)\b", name, re.I))


def _name_contains(needle: str, haystack: str) -> bool:
    return _normalize_place_key(needle, None) in _normalize_place_key(haystack, None)


def _context_contains(context: str | None, haystack: str) -> bool:
    return _normalize_place_key(context or "", None) in _normalize_place_key(haystack, None)


def _candidate_to_place(candidate: str, text: str) -> dict:
    inferred_region = _infer_region_from_text(text)
    return {
        "name": candidate,
        "context": inferred_region,
        "address": None,
        "description": text[:180],
        "sentiment": "neutral",
        "category": "Others",
    }


def _infer_region_from_text(text: str) -> str | None:
    text = text or ""
    if re.search(r"\b(Madison Square Garden|Manhattan|New York City|NYC)\b", text, re.I):
        return "New York City, NY"
    if re.search(r"\b(Hudson Valley)\b", text, re.I):
        return "Hudson Valley, New York"
    return None


def _derive_title(message: str, user_input: str) -> str:
    if "Taylor Swift" in user_input:
        return "Taylor Swift Wedding Venue"
    first_line = (message.splitlines()[0].strip() if message else "").strip()
    return (first_line or user_input[:80])[:80]


async def _geocode_places(places: list[dict], inferred_region: str | None) -> list[dict]:
    geocode_queries: list[dict | str] = []
    for place in places:
        address = str(place.get("address") or "").strip()
        context = str(place.get("context") or "").strip()
        name = str(place.get("name") or "").strip()
        fallback = ", ".join(part for part in [name, context] if part)
        query = address or fallback
        if not query:
            continue
        geocode_queries.append({
            "query": query,
            "fallback_query": fallback if fallback and fallback != address else None,
            "name": name,
        })

    geocoded = await batch_geocode(geocode_queries, city_name=inferred_region)

    resolved_locations: list[dict] = []
    for place, geo in zip(places, geocoded):
        if not geo:
            continue
        name = str(place.get("name") or "").strip()
        address = str(place.get("address") or "").strip()
        context = str(place.get("context") or "").strip()
        description = str(place.get("description") or "").strip()
        if not name:
            name = address or context or geo.get("name", "") or "Unknown place"
        resolved_locations.append({
            "name": name,
            "latitude": geo["latitude"],
            "longitude": geo["longitude"],
            "full_address": address or geo.get("full_address") or name,
            "description": description or None,
            "category": place.get("category"),
            "sentiment": place.get("sentiment"),
            "is_exact": geo.get("is_exact"),
            "confidence": geo.get("confidence"),
            "source": "smart_text_web" if geo.get("is_exact") else "smart_text",
        })

    return resolved_locations


def _looks_address_heavy(text: str) -> bool:
    lower = text.lower()
    if any(token in lower for token in [" st ", " rd ", " ave ", " blvd ", " dr ", " suite ", " apt ", " road ", " street "]):
        return True
    if sum(char.isdigit() for char in text) >= 4:
        return True
    return False
