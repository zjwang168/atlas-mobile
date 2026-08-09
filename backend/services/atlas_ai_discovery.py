"""Atlas AI discovery flow: query -> exact addresses -> address-first geocoding."""

from __future__ import annotations

import asyncio
import json

from backend.services.geocoder import batch_geocode
from backend.services.llm_client import call_llm, parse_llm_response
from backend.services.route_planner import plan_route

# NOTE: All JSON curly braces in this prompt are doubled to avoid Python
# str.format() treating them as placeholders. The single {query} is the only
# interpolation point.
ATLAS_AI_DISCOVERY_PROMPT = """You are Atlas AI, a precise travel-location research assistant.

Given a user request, return a curated list of REAL-WORLD places that satisfy it.

Output ONLY valid JSON with this exact structure:
{{
  "title": "short title for this request",
  "inferred_region": "primary city/region or null",
  "region_tagline": "2-4 English words that evoke the inferred region, or null",
  "places": [
    {{
      "name": "real-world place name",
      "address": "full postal address with street number, city, state/region, country if known",
      "context": "city, state/region",
      "description": "a location-specific, license-plate-style English slogan of no more than 4 English words",
      "sentiment": "positive",
      "category": "Tourist Attractions",
      "fictional_or_alt_name": "optional fictional/alternate label or null"
    }}
  ]
}}

Rules:
1. Prefer REAL, VISITABLE places only.
2. You MUST provide the most precise full street address you can for each place.
   IMPORTANT: Addresses MUST be in English (e.g. "The Bund, 18 Zhongshan East 1st Rd, Huangpu, Shanghai, China")
   so that mapping APIs can geocode them correctly. Translate Chinese/other-language addresses
   to English. If a place has a well-known English name, use it in "name".
3. If a place is commonly known by a fictional label, keep the real place in "name" and put the fictional label in "fictional_or_alt_name".
4. If you are not reasonably confident in a precise address, omit that place.
5. The description must be a location-specific, license-plate-style English slogan of no more than 4 English words.
   Do not use a category label, do not truncate a sentence, and do not write a complete sentence.
6. "sentiment" must be one of "positive", "neutral", "negative".
7. "category" must be one of:
   "Tourist Attractions", "Dining & Drinking", "Entertainment",
   "Museums & Exhibitions", "Transit Hubs", "Religious Sites", "Others"
8. Return exactly the number of places requested when the user specifies a number; otherwise return 3-12 places.
9. Set region_tagline to exactly 2-4 refined English words, not a sentence.

User request:
{query}

JSON:"""


async def discover_places_from_query(query: str, request_id: str | None = None) -> dict:
    from backend.services import progress
    progress.stream_note(request_id, "atlas_ai:research", {"detail": "Researching exact places from the request."})
    llm_result = await asyncio.to_thread(
        call_llm,
        messages=[
            {
                "role": "system",
                "content": ATLAS_AI_DISCOVERY_PROMPT.format(query=query[:4000]),
            },
        ],
        temperature=0.2,
        max_tokens=4096,
        request_id=request_id,
    )

    content = llm_result.get("content", "{}")
    normalized = parse_llm_response(content)
    parsed = json.loads(normalized.get("content", "{}"))

    title = parsed.get("title") or query[:80]
    inferred_region = parsed.get("inferred_region")
    region_tagline = parsed.get("region_tagline")
    if inferred_region:
        progress.stream_note(request_id, "analysis:region", {"region": inferred_region, "tagline": region_tagline})
    places = parsed.get("places", [])

    # Geocode by place name and regional context. AI-generated street numbers
    # are often fictional for attractions and can force a low-confidence fuzzy
    # match, so the discovery address is intentionally not sent to geocoders.
    geocode_queries: list[str] = []
    for place in places:
        context = (place.get("context") or "").strip()
        name = (place.get("name") or "").strip()
        geocode_queries.append(", ".join(part for part in [name, context] if part))

    geocoded = await batch_geocode(geocode_queries, city_name=inferred_region)
    progress.stream_note(request_id, "atlas_ai:geocode", {"detail": f"Resolved {len([g for g in geocoded if g])} candidate places."})

    resolved_locations: list[dict] = []
    for place, geo in zip(places, geocoded):
        if not geo:
            print(f"[AtlasAIDiscovery] geocode failed | name={place.get('name')} | address={place.get('address')}")
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
            "full_address": geo.get("full_address") or display_name,
            "description": description,
            "category": place.get("category"),
            "sentiment": place.get("sentiment"),
            "is_exact": geo.get("is_exact"),
            "confidence": geo.get("confidence"),
            "source": "atlas_ai_discovery",
        })

    if not resolved_locations:
        print(f"[AtlasAIDiscovery] no resolved locations | query={query!r} | candidates={len(places)}")
        raise ValueError("No valid places with precise addresses could be resolved from this request.")

    route = plan_route(resolved_locations) if resolved_locations else {
        "ordered_locations": [],
        "total_distance_km": 0.0,
        "segments": [],
    }

    return {
        "title": title,
        "locations": resolved_locations,
        "route": route,
        "removed_noise": [],
        "removed_hierarchy": [],
        "inferred_region": inferred_region,
        "region_tagline": region_tagline,
        "source_type": "atlas_ai",
    }
