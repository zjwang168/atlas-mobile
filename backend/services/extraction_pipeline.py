"""
Hierarchical geographic entity extraction pipeline.

Two-stage approach:
  Stage 1: LLM extracts all geographic entities with hierarchy classification.
  Stage 2: Rule-based filtering removes redundant high-level entities.
"""

import asyncio
import json

# NOTE: All JSON curly braces in this prompt are doubled ({{, }}) to avoid
#       Python str.format() interpreting them as template placeholders.
#       The single {text} placeholder is the only interpolation point.
HIERARCHICAL_EXTRACTION_PROMPT = """You are a precise geographic entity extractor. Given the text below, extract ALL geographic locations mentioned.

For each location, classify its hierarchy level:
- 0 = Point of Interest / Landmark / Specific venue (e.g., "Golden Gate Bridge", "Joe's Restaurant", "Shibuya Crossing")
- 1 = District / Neighborhood (e.g., "Chinatown", "Greenwich Village", "Harajuku")
- 2 = City / Town (e.g., "San Francisco", "Tokyo", "Kyoto")
- 3 = State / Province / Region (e.g., "California", "Ile-de-France", "Kansai")
- 4 = Country (e.g., "USA", "Japan", "France")

Output ONLY a JSON object with this exact structure:
{{
  "entities": [
    {{"name": "Golden Gate Bridge", "hierarchy_level": 0, "context": "San Francisco",
      "description": "Iconic suspension bridge with stunning bay views.",
      "sentiment": "positive",
      "category": "Tourist Attractions"}},
    {{"name": "California", "hierarchy_level": 3, "context": null,
      "description": null, "sentiment": null, "category": null}}
  ],
  "inferred_region": "San Francisco Bay Area",
  "is_multi_region": false,
  "is_multi_country": false,
  "source_summary": "A Reddit post about visiting San Francisco's tourist attractions"
}}

Rules:
1. Include EVERY geographic reference, even obvious ones like city/country names.
2. For Level 0 entities, always include "context" — the city or region they belong to.
3. If the post covers multiple distinct regions (e.g., a Europe trip), set is_multi_region to true.
4. If the post covers multiple countries, set is_multi_country to true.
5. Infer the primary region from context. If 80%+ locations are in one region, set inferred_region.
6. For ambiguous names like "Chaoyang", include clarifying context like "Chaoyang, Beijing".
7. Include neighborhoods (e.g. "Chinatown", "North Beach", "Gastown"),
   districts, landmarks, parks, bridges, squares, streets, mountains, beaches,
   and well-known public spaces. These ARE valid geographic locations.
8. Do NOT extract individual business names (specific restaurants, bars, cafes, shops)
   like "Pourhouse", "Go Fish", "Six Acres", "Joe's Pizza". These are not map-searchable
   geographic locations. But do include the neighborhood/area they are in.
9. When in doubt, prefer to INCLUDE the location. The post-processing pipeline will
   handle noise filtering automatically.
10. For each entity, add a "description" field — a one-sentence summary extracted from
     the text. This should capture how the place is described in the post (e.g.
     "right next to the centre", "worth a visit", "beautiful park with gardens").
     Keep it concise, under 20 words. Use the original text's sentiment and style.
     If no description can be inferred, set it to null.
11. For each entity, add a "sentiment" field. Classify the post's sentiment toward
     this location as one of: "positive" (强烈推荐/喜欢), "neutral" (一般/还可以),
     "negative" (不推荐/不喜欢). Base this on how the text describes it.
     If sentiment cannot be determined, set it to null.
12. For each entity, add a "category" field. Choose exactly one from:
     "Tourist Attractions", "Dining & Drinking", "Entertainment",
     "Museums & Exhibitions", "Transit Hubs", "Religious Sites", "Others"

Text:
{text}

JSON:"""


class ExtractionPipeline:
    """Two-stage extraction: LLM extraction + rule-based hierarchical filtering."""

    @staticmethod
    async def extract(text: str, source_type: str = "generic") -> dict:
        """
        Full extraction pipeline.

        Returns:
        {
            "locations": [{"name": str, "context": str, "hierarchy_level": int}],
            "removed_noise": [{"name": str, "reason": str}],
            "removed_hierarchy": [{"name": str, "reason": str, "parent_of": str}],
            "inferred_region": str | None,
            "is_multi_region": bool
        }
        """
        # Stage 1: Raw extraction via LLM
        entities = await ExtractionPipeline._stage1_extract(text)

        # Stage 2: Filter by hierarchy
        filtered = ExtractionPipeline._stage2_filter_hierarchy(entities["entities"])

        # Stage 3: Detect outliers
        final = ExtractionPipeline._stage3_detect_outliers(
            filtered["locations"],
            entities.get("inferred_region"),
            entities.get("is_multi_region", False),
            entities.get("is_multi_country", False),
        )

        return {
            "locations": final.get("locations", filtered.get("locations", [])),
            "removed_hierarchy": filtered.get("removed_hierarchy", []),
            "removed_noise": final.get("removed_noise", []),
            "inferred_region": entities.get("inferred_region"),
            "is_multi_region": entities.get("is_multi_region", False),
        }

    @staticmethod
    async def _stage1_extract(text: str) -> dict:
        """Stage 1: Use LLM to extract all entities with hierarchy levels."""
        from backend.services.llm_client import call_llm

        result = await asyncio.to_thread(
            call_llm,
            messages=[
                {
                    "role": "system",
                    "content": HIERARCHICAL_EXTRACTION_PROMPT.format(
                        text=text[:16000]
                    ),
                },
            ],
            temperature=0.2,
            max_tokens=8192,
        )

        content = result.get("content", "{}")
        try:
            parsed = json.loads(content)

        except json.JSONDecodeError:
            print(f"[extraction] Stage1 JSON parse failed, content length={len(content)}, tail={content[-80:]!r}")
            return {
                "entities": [],
                "inferred_region": None,
                "is_multi_region": False,
                "is_multi_country": False,
            }

        return {
            "entities": parsed.get("entities", []),
            "inferred_region": parsed.get("inferred_region"),
            "is_multi_region": parsed.get("is_multi_region", False),
            "is_multi_country": parsed.get("is_multi_country", False),
        }

    @staticmethod
    def _stage2_filter_hierarchy(entities: list[dict]) -> dict:
        """
        Stage 2: Remove redundant high-level entities.

        Rules:
        1. If a Level 0 POI exists within a Level 2 city, keep POI, discard city
        2. If multiple POIs in same city, keep all POIs, discard city
        3. If city has no POIs, keep the city
        4. Always discard Level 3 (state) if Level 0/1/2 exists within it
        5. Always discard Level 4 (country) if anything exists within it
        6. NEVER discard Level 0/1 entities

        Example:
        Input:  [GGB(l0), Chinatown(l0), SF(l2), CA(l3), USA(l4)]
        Output: [GGB(l0), Chinatown(l0)]  -- SF/CA/USA discarded as redundant

        Input:  [Tokyo(l2), Osaka(l2), Jeju(l2), South Korea(l4)]
        Output: [Tokyo(l2), Osaka(l2), Jeju(l2)]  -- South Korea discarded

        Input:  [GGB(l0), SF Chinatown(l0), LA(l2), CA(l3)]
        Output: [GGB(l0), Chinatown(l0), LA(l2)]  -- CA discarded
        """
        removed = []
        kept = []

        # Separate by level
        level0 = [e for e in entities if e.get("hierarchy_level") == 0]
        level1 = [e for e in entities if e.get("hierarchy_level") == 1]
        level2 = [e for e in entities if e.get("hierarchy_level") == 2]
        level3 = [e for e in entities if e.get("hierarchy_level") == 3]
        level4 = [e for e in entities if e.get("hierarchy_level") == 4]

        # Always keep Level 0 (POIs)
        kept.extend(level0)

        # For Level 1 (districts): keep if not covered by a Level 0 context
        # Simple heuristic: keep all districts for now
        kept.extend(level1)

        # For Level 2 (cities): keep only if no Level 0 POI explicitly names
        # this city in its context
        kept_cities = []
        for city in level2:
            city_name = city["name"].lower()
            # Check if any POI has this city as context
            has_poi_in_city = any(
                city_name in (poi.get("context", "") or "").lower()
                for poi in level0
            )
            if not has_poi_in_city:
                kept_cities.append(city)
            else:
                removed.append(
                    {
                        "name": city["name"],
                        "reason": "Redundant: covered by specific POIs within this city",
                        "parent_of": ", ".join(
                            p["name"]
                            for p in level0
                            if city_name
                            in (p.get("context", "") or "").lower()
                        ),
                    }
                )
        kept.extend(kept_cities)

        # For Level 3 (states): discard if any Level 0/1/2 exists (check name + context)
        for state in level3:
            state_name = state["name"].lower()
            # Check if any child mentions this state in context OR if child name contains state
            children = [
                e
                for e in (level0 + level1 + level2)
                if state_name in (e.get("context", "") or "").lower()
                or state_name in e["name"].lower()
            ]
            # Also discard if there are ANY level0/1 entities (likely in this state)
            if children or len(level0) + len(level1) > 0:
                removed.append(
                    {
                        "name": state["name"],
                        "reason": "Redundant: contains more specific locations",
                        "parent_of": ", ".join(set(c["name"] for c in children[:5])),
                    }
                )
            else:
                kept.append(state)

        # For Level 4 (countries): discard if any Level 0/1/2/3 exists (check name + context)
        for country in level4:
            country_name = country["name"].lower()
            children = [
                e
                for e in (level0 + level1 + level2 + level3)
                if country_name in (e.get("context", "") or "").lower()
                or country_name in e["name"].lower()
            ]
            # Also discard if there are ANY level0/1/2 entities
            if children or len(level0) + len(level1) + len(level2) > 0:
                removed.append(
                    {
                        "name": country["name"],
                        "reason": "Redundant: contains more specific locations within this country",
                        "parent_of": ", ".join(set(c["name"] for c in children[:5])),
                    }
                )
            else:
                kept.append(country)

        # Additional pass: re-check city-level entities against POI context
        final_kept = []
        for loc in kept:
            hier_level = loc.get("hierarchy_level", 2)
            loc_name = loc["name"].lower()
            if hier_level == 2:
                has_poi_in_city = any(
                    loc_name in (poi.get("context", "") or "").lower()
                    for poi in level0
                )
                if has_poi_in_city and len(level0) >= 2:
                    removed.append(
                        {
                            "name": loc["name"],
                            "reason": "Redundant: specific POIs already cover this city",
                            "parent_of": ", ".join(
                                p["name"]
                                for p in level0
                                if loc_name in (p.get("context", "") or "").lower()
                            ),
                        }
                    )
                    continue
            final_kept.append(loc)

        return {"locations": final_kept, "removed_hierarchy": removed}

    @staticmethod
    def _stage3_detect_outliers(
        locations: list[dict],
        inferred_region: str | None = None,
        is_multi_region: bool = False,
        is_multi_country: bool = False,
    ) -> dict:
        """
        Stage 3: Pass-through — no text-based filtering here.
        
        Coordinate-based outlier detection is handled post-geocoding
        by `_validate_coordinates` in agent_orchestrator.py, which has
        access to actual lat/lng data. Text-based matching at this stage
        (pre-geocoding) is unreliable — e.g. "Montmartre" doesn't
        contain the substring "Paris" or "France".
        
        Returns all locations unchanged with empty noise lists.
        """
        return {
            "locations": locations,
            "removed_noise": [],
            "removed_hierarchy": [],
        }
