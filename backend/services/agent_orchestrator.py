"""
Agent Orchestrator — Supervisor Agent that coordinates the multi-agent pipeline.

Uses a tool-calling loop pattern:
1. Classify URL → determine source type
2. Scrape content → extract text
3. Two-stage extraction → filtered location list
4. Batch geocode → coordinates
5. TSP route → ordered locations
6. Create session memory → store all artifacts
7. For follow-up chat: agent loop with tool calls
"""

import asyncio
import json
import time
from typing import Optional

from backend.services.conversation_manager import Session, conversation_manager
from backend.services.tool_definitions import TOOLS, registry


class AgentOrchestrator:
    """
    Supervisor Agent that coordinates all sub-agents.

    For the initial parse_link pipeline:
        Runs a deterministic sequence (no LLM agent loop needed for speed).

    For follow-up chat:
        Runs the full agent loop with tool calling.
    """

    MAX_STEPS = 10
    STEP_TIMEOUT = 15  # seconds per tool call
    TOTAL_TIMEOUT = 60  # seconds total

    def __init__(self):
        from backend.services.tool_definitions import init_registry
        init_registry()  # Ensure all tools are registered

    async def run_pipeline(self, url: str, session: Session) -> dict:
        """
        Run the complete extraction pipeline for a URL.

        This is a deterministic pipeline (not an agent loop) for speed and reliability.
        Returns the extracted locations, route, and metadata.
        """
        from backend.services.web_scraper import WebScraper

        # 1. Classify and scrape
        source_type = WebScraper.classify_source(url)
        session.source_url = url
        session.source_type = source_type

        scrape_result = await WebScraper.scrape(url)
        if not scrape_result.get("success"):
            raise ValueError(f"Failed to scrape URL: {scrape_result.get('error', 'Unknown error')}")

        content = scrape_result.get("content", "")
        title = scrape_result.get("title", "")
        session.title = title

        return await self._process_content(content, source_type, session)

    async def _process_content(self, content: str, source_type: str, session: Session) -> dict:
        """Shared pipeline: extraction -> entity linking -> geocoding -> route.

        Used by both run_pipeline (URL input) and run_pipeline_from_text
        (user-pasted text). Everything below is source-agnostic.
        """
        # 2. Extract locations with hierarchy
        from backend.services.extraction_pipeline import ExtractionPipeline
        extraction = await ExtractionPipeline.extract(content, source_type)

        location_names = extraction.get("locations", [])
        session.removed_noise = extraction.get("removed_noise", [])
        session.removed_hierarchy = extraction.get("removed_hierarchy", [])
        session.inferred_region = extraction.get("inferred_region")
        session.is_multi_region = extraction.get("is_multi_region", False)

        if not location_names:
            raise ValueError("No geographic locations could be extracted from this content.")

        # 2.5 Entity Linking — disambiguate ambiguous location names
        location_names = await self._entity_linking(location_names, extraction.get("inferred_region"))

        # 2.6 Geocode the inferred_region to get a proximity bias point
        proximity = None
        city_center = None
        inferred_region = extraction.get("inferred_region")
        if inferred_region:
            try:
                from backend.services.geocoder import _geocode_geoapify
                region_geo = await _geocode_geoapify(inferred_region)
                if region_geo:
                    proximity = (region_geo["longitude"], region_geo["latitude"])
                    city_center = proximity
                    print(f"[AgentOrchestrator] Using proximity bias: {proximity} for '{inferred_region}'")
            except Exception:
                # If geocoding the region fails, proceed without proximity bias.
                # The coordinate validation step will handle outlier filtering.
                print(f"[AgentOrchestrator] Could not geocode region '{inferred_region}', proceeding without proximity bias")

        # 2.8 Deduplicate location names before geocoding
        seen_names_in_query = set()
        unique_locations = []
        for loc in location_names:
            name_key = loc["name"].strip().lower()
            if name_key not in seen_names_in_query:
                seen_names_in_query.add(name_key)
                unique_locations.append(loc)

        if len(unique_locations) < len(location_names):
            print(f"[AgentOrchestrator] Pre-geocode dedup: {len(location_names)} -> {len(unique_locations)}")
        location_names = unique_locations

        # 3. Geocode locations — include context + proximity bias
        from backend.services.geocoder import batch_geocode
        contexts = [loc.get("context", "") for loc in location_names]

        # When the inferred region is known (e.g. "Paris, France"), use it
        # as the default geographic context for ALL locations that lack
        # per-entity context from the LLM. This dramatically improves
        # geocoding accuracy — e.g. "Luxembourg" -> "Luxembourg Gardens, Paris"
        # instead of the country Luxembourg.
        default_context = inferred_region if inferred_region else ""
        # Shorten verbose region names for geocoding queries
        # e.g. "Washington DC metropolitan area" -> "Washington DC"
        if default_context and "metropolitan" in default_context.lower():
            parts = default_context.split()
            if parts:
                default_context = " ".join(parts[:2]) if len(parts) >= 2 else parts[0]

        # Build geocoding queries — STRICTLY avoid duplicate context
        geocode_queries = []
        for loc in location_names:
            name = loc["name"]
            ctx = loc.get("context", "")
            
            # Use the SIMPLEST possible query: just the name.
            # Entity Linking already appends city/region (e.g. "White House, Washington DC").
            # Adding any extra context causes Photon/Nominatim 403 from long URLs.
            geocode_queries.append(name)

        geocoded = await batch_geocode(
            geocode_queries, proximity=proximity,
            city_name=inferred_region, city_center=city_center,
        )

        # Map geocoded results back to original names + context
        locations = []
        for i, geo in enumerate(geocoded):
            if geo:
                # Preserve the original name (not the geocoding query string)
                original_name = location_names[i]["name"]
                geo["name"] = original_name
                geo["context"] = contexts[i] if i < len(contexts) else ""
                geo["hierarchy_level"] = location_names[i].get("hierarchy_level", 2) if i < len(location_names) else 2
                geo["sentiment"] = location_names[i].get("sentiment")
                geo["description"] = location_names[i].get("description")
                geo["category"] = location_names[i].get("category")
                locations.append(geo)

        # 3.5 Deduplicate — by NAME only, NOT by coordinates
        # Different places (AGO vs ROM) can be 300m apart — they are NOT duplicates.
        seen_names = set()
        deduped = []
        for loc in locations:
            name_key = loc.get("name", "").strip().lower()
            if name_key and name_key not in seen_names:
                seen_names.add(name_key)
                deduped.append(loc)
            elif not name_key:
                deduped.append(loc)

        if len(deduped) < len(locations):
            print(f"[AgentOrchestrator] Deduplicated {len(locations) - len(deduped)} locations (same name)")
        locations = deduped

        if not locations:
            raise ValueError("Could not geocode any of the extracted location names.")

        session.locations = locations

        # 3.5 Validate geocoded coordinates against inferred region
        validated = self._validate_coordinates(locations, extraction.get("inferred_region"))
        removed_count = len(locations) - len(validated)
        if removed_count > 0:
            # Track removed locations
            removed_names = [loc["name"] for loc in locations if loc not in validated]
            validation_noise = [
                {"name": name, "reason": f"Coordinates outside target region"}
                for name in removed_names
            ]
            session.removed_noise = (session.removed_noise or []) + validation_noise

        locations = validated
        session.locations = locations

        # 3.6 Force city/country level locations (hierarchy_level >= 2) to "Others" category
        for loc in locations:
            if loc.get("hierarchy_level", 2) >= 2:
                loc["category"] = "Others"

        # 3.7 Print location details with sentiment
        print(f"\n{'='*60}")
        print(f"  LOCATION DETAILS")
        print(f"{'='*60}")
        for loc in location_names:
            desc = loc.get("description", "")
            sentiment = loc.get("sentiment", "")
            category = loc.get("category", "")
            sentiment_icon = {"positive": "👍", "neutral": "➖", "negative": "👎"}.get(sentiment, "?")
            parts = [f"  {loc['name']}"]
            if sentiment:
                parts.append(f"[{sentiment_icon} {sentiment}]")
            if category:
                parts.append(f"({category})")
            if desc:
                parts.append(f"\n     {desc}")
            print(" ".join(parts))

        if session.removed_hierarchy:
            print(f"\n{'─'*40}")
            print(f"  REMOVED HIERARCHY")
            for rh in session.removed_hierarchy:
                name = rh.get('name', rh) if isinstance(rh, dict) else rh
                reason = rh.get('reason', '') if isinstance(rh, dict) else ''
                print(f"  • {name}: {reason[:60]}")

        if session.removed_noise:
            print(f"\n{'─'*40}")
            print(f"  REMOVED AS NOISE")
            for rn in session.removed_noise:
                name = rn.get('name', rn) if isinstance(rn, dict) else rn
                reason = rn.get('reason', '') if isinstance(rn, dict) else ''
                print(f"  • {name}: {reason[:60]}")

        print(f"{'='*60}\n")

        # 4. Plan route
        from backend.services.route_planner import plan_route
        route = plan_route(locations)
        session.route = route

        # 5. Save session
        session.add_message("system", f"Extracted {len(locations)} locations from the provided URL.")

        # 6. Auto-save to Supabase + update memory
        try:
            await conversation_manager.save_conversation(session.session_id)
            await self._update_memory(session)
        except Exception:
            pass

        return {
            "title": session.title,
            "locations": locations,
            "route": route,
            "removed_noise": session.removed_noise,
            "removed_hierarchy": session.removed_hierarchy,
            "inferred_region": session.inferred_region,
            "source_type": source_type,
            "session_id": session.session_id,
        }

    async def run_pipeline_from_text(self, text: str, session: Session) -> dict:
        """Run the extraction pipeline on user-pasted text (no scraping).

        Covers sources we cannot scrape - Xiaohongshu notes, WeChat articles,
        text a friend sent - the user copies the content and pastes it in.
        """
        session.source_url = None
        session.source_type = "text"
        # Derive a short title from the first non-empty line of the text
        first_line = next((ln.strip() for ln in text.splitlines() if ln.strip()), "Pasted text")
        session.title = first_line[:80]

        return await self._process_content(text, "generic", session)

    def _validate_coordinates(self, locations: list[dict], inferred_region: str | None = None) -> list[dict]:
        """
        Validate geocoded coordinates — relaxed validation.

        Since geocoder now returns None (not default coordinates) when no good
        match is found, only remove extreme outliers (>500km from the cluster
        median center) that indicate cross-country geocoding errors.
        """
        if len(locations) <= 2:
            return locations

        # Calculate median center
        lats = sorted([loc["latitude"] for loc in locations])
        lngs = sorted([loc["longitude"] for loc in locations])
        median_lat = lats[len(lats) // 2]
        median_lng = lngs[len(lngs) // 2]

        # Calculate distances from median center
        from backend.services.route_planner import haversine
        distances = []
        for loc in locations:
            d = haversine(median_lat, median_lng, loc["latitude"], loc["longitude"])
            distances.append(d)

        # Dynamic threshold: use median distance as baseline
        sorted_dists = sorted(distances)
        median_dist = sorted_dists[len(sorted_dists) // 2]
        threshold = max(200.0, min(2000.0, median_dist * 8))

        validated = []
        removed_noise = []

        for i, loc in enumerate(locations):
            dist = distances[i]
            if dist <= threshold:
                validated.append(loc)
            else:
                removed_noise.append({
                    "name": loc.get("name", ""),
                    "reason": (
                        f"Extreme outlier: {dist:.0f} km from main cluster "
                        f"(threshold {threshold:.0f} km)"
                    ),
                })

        return validated

    async def _entity_linking(self, location_names: list[dict], inferred_region: str | None = None) -> list[dict]:
        """
        Entity Linking — disambiguate ambiguous location names using LLM.

        Rule 13 from the extraction prompt is moved here as a separate LLM call
        because merging disambiguation into the extraction prompt confused the LLM
        and caused it to miss entities. A dedicated call with a focused prompt
        yields better recall.

        For each location name, the LLM decides whether to:
        - Append clarifying city/region in parentheses (e.g. "Chaoyang" → "Chaoyang, Beijing")
        - Expand abbreviations to full names (e.g. "ROM" → "Royal Ontario Museum")
        - Leave unambiguous names as-is

        Returns the updated list with disambiguated names.
        """
        import json
        import re

        from backend.services.llm_client import call_llm

        # Step 1: LLM-based disambiguation (abbreviations/aliases + generic term resolution)
        names_list = "\n".join(
            f"{i}. {loc['name']}" + (f"  (context: {loc.get('context', '')})" if loc.get('context') else "")
            for i, loc in enumerate(location_names)
        )

        prompt = f"""You are a precise geographic entity linker. Given a list of location names from a travel post, disambiguate any ambiguous names.

Rules:
1. For abbreviations, expand to full name (e.g. "ROM" → "Royal Ontario Museum", "AGO" → "Art Gallery of Ontario", "MOCA" → "Museum of Contemporary Art", "GGB" → "Golden Gate Bridge")
2. For ambiguous common names, append clarifying city/region in parentheses (e.g. "Chaoyang" → "Chaoyang, Beijing", "Luxembourg" → "Luxembourg Gardens, Paris" if context shows it's in Paris)
3. For names that are already precise and unambiguous (e.g. "Eiffel Tower", "Tokyo Tower"), leave unchanged.
4. Use the surrounding context to determine the correct entity.
5. For ALL locations, append geographic context to ensure correct geocoding.
   If a location name is ambiguous (multiple places share the same name),
   add the appropriate region/province/state to distinguish it.
   
   Examples of correct disambiguation (the LLM should infer this pattern):
   - "Suzhou" in the context of Jiangsu/Shanghai area → "Suzhou, Jiangsu"
   - "Suzhou" in the context of Anhui area → "Suzhou, Anhui"
   - "Cambridge" in the context of UK → "Cambridge, UK"
   - "Cambridge" in the context of US → "Cambridge, Massachusetts"
   - "Portland" in the context of US West Coast → "Portland, Oregon"
   - "Portland" in the context of US East Coast → "Portland, Maine"
   - "Springfield" → always add state context
   
   Use the inferred region AND the post content to determine the correct context.
   If the name is already unambiguous, keep it unchanged.
6. RESOLVE GENERIC TERMS: If a location name is a generic/category description (e.g. "monuments", "the tower", "the bridge", "the mall", "the palace", "the park", "the statue"), resolve it to the SPECIFIC geographic entity based on the inferred region context.

   Examples:
   - "monuments" in Washington DC → "Washington Monument"
   - "the tower" in Paris → "Eiffel Tower"
   - "the bridge" in San Francisco → "Golden Gate Bridge"
   - "the mall" in Washington DC → "National Mall"
   - "the palace" in London → "Buckingham Palace"
   - Generic term without clear context → keep as-is

7. If a name is already clear, keep it unchanged.

{f"Region context: {inferred_region}" if inferred_region else ""}

Location names:
{names_list}

Output ONLY a JSON object with this exact structure:
{{"disambiguated": [
  {{"index": 0, "original_name": "Louvre", "disambiguated_name": "Louvre Museum"}},
  {{"index": 1, "original_name": "Eiffel Tower", "disambiguated_name": "Eiffel Tower"}}
]}}"""

        try:
            result = await asyncio.to_thread(
                call_llm,
                messages=[{"role": "system", "content": prompt}],
                temperature=0.2,
                max_tokens=2048,
            )

            content = result.get("content", "{}")
            parsed = json.loads(content)
            disambiguated_list = parsed.get("disambiguated", [])

            # Build lookup from index to disambiguated name
            name_map = {}
            for item in disambiguated_list:
                idx = item.get("index")
                disambiguated = item.get("disambiguated_name", "")
                if idx is not None and disambiguated:
                    name_map[idx] = disambiguated

            # Apply disambiguation
            updated = []
            for i, loc in enumerate(location_names):
                loc = dict(loc)  # Copy to avoid mutating original
                if i in name_map:
                    old_name = loc["name"]
                    new_name = name_map[i]
                    if new_name != old_name:
                        print(f"[EntityLinking] '{old_name}' → '{new_name}'")
                    loc["name"] = new_name
                updated.append(loc)

            changed_count = sum(1 for i in name_map if name_map[i] != location_names[i]["name"])
            if changed_count > 0:
                print(f"[EntityLinking] Disambiguated {changed_count}/{len(location_names)} names")

            return updated

        except Exception as e:
            print(f"[EntityLinking] Failed: {e}")
            return location_names

    async def chat(self, session_id: str, user_message: str) -> dict:
        """
        Continue conversation with the agent.
        Uses a tool-calling agent loop for follow-up interactions.
        """
        session = conversation_manager.get_session(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")

        # Add user message
        session.add_message("user", user_message)

        # Run agent loop
        result = await self._agent_loop(session)

        return {
            "session_id": session_id,
            "response": result.get("answer", ""),
            "locations": session.locations,
            "route": session.route,
            "tool_calls_used": result.get("tool_calls_used", []),
            "status": result.get("status", "success"),
            "partial": result.get("partial", False),
        }

    async def _agent_loop(self, session: Session) -> dict:
        """
        Core agent loop with tool calling.

        Loop:
        1. Build prompt with system instructions + conversation history + current map state
        2. Call LLM
        3. If LLM returns tool_call → execute tool → append result → repeat
        4. If LLM returns final_answer → return
        5. If max_steps reached → return partial result
        6. If timeout → return partial result
        """
        from backend.services.llm_client import call_llm

        step = 0
        total_tool_calls = []
        start_time = time.time()

        while step < self.MAX_STEPS:
            step += 1

            # Check total timeout
            if time.time() - start_time > self.TOTAL_TIMEOUT:
                return {
                    "status": "timeout",
                    "answer": "The operation timed out. Here's what I have so far.",
                    "partial": True,
                    "tool_calls_used": total_tool_calls,
                }

            # Build context
            context = self._build_agent_context(session)

            # Call LLM
            try:
                llm_result = await asyncio.to_thread(
                    call_llm,
                    messages=context,
                    tools=TOOLS,
                    temperature=0.3,
                    max_tokens=2048,
                )
            except Exception as e:
                session.add_message("assistant", f"I encountered an error: {str(e)}")
                return {
                    "status": "error",
                    "answer": f"Sorry, I encountered an error: {str(e)}",
                    "tool_calls_used": total_tool_calls,
                    "partial": True,
                }

            # Parse result
            response_type = llm_result.get("type", "text")

            if response_type == "tool_call":
                tool_calls = llm_result.get("tool_calls", [])
                if not tool_calls:
                    continue

                for tc in tool_calls:
                    tool_name = tc.get("name", "")
                    tool_args = tc.get("arguments", {})
                    total_tool_calls.append(tool_name)

                    # Execute tool with timeout
                    try:
                        tool_result = await asyncio.wait_for(
                            registry.execute(tool_name, tool_args),
                            timeout=self.STEP_TIMEOUT,
                        )
                    except asyncio.TimeoutError:
                        tool_result = {"error": f"Tool {tool_name} timed out"}
                    except Exception as e:
                        tool_result = {"error": str(e)}

                    # Store in session
                    session.add_message(
                        "assistant",
                        f"[Used tool: {tool_name}]",
                        tool_calls=[{"name": tool_name, "arguments": tool_args}],
                        tool_results=[tool_result],
                    )

                    # If the tool modified locations or route, update session
                    self._apply_tool_result(session, tool_name, tool_args, tool_result)

            elif response_type == "final_answer":
                answer = llm_result.get("content", "")
                session.add_message("assistant", answer)
                return {
                    "status": "success",
                    "answer": answer,
                    "tool_calls_used": total_tool_calls,
                    "partial": False,
                }

            else:
                # Text response (no tool call)
                content = llm_result.get("content", "")
                if content:
                    session.add_message("assistant", content)
                    return {
                        "status": "success",
                        "answer": content,
                        "tool_calls_used": total_tool_calls,
                        "partial": False,
                    }

        # Max steps reached
        return {
            "status": "max_steps",
            "answer": "I've reached the maximum number of steps. Let me summarize what I've done.",
            "tool_calls_used": total_tool_calls,
            "partial": True,
        }

    def _build_agent_context(self, session: Session) -> list[dict]:
        """Build the full context for the agent LLM call."""
        system_prompt = f"""You are a travel assistant AI that helps users plan itineraries from web content.

Current session state:
- Locations on map: {len(session.locations)}
- Route planned: {'Yes' if session.route else 'No'}
- Total distance: {session.route.get('total_distance_km', 'N/A') if session.route else 'N/A'} km
- Source: {session.source_type or 'N/A'}

You have access to tools. Use them when the user asks to:
- Add/remove locations: use map_operation
- Reorder or optimize routes: use map_operation or plan_route
- Find more information about a place: use geocode_location
- Search for nearby places: use geocode_location with context

When the user's request is simple (e.g., just asking a question), respond directly without tools.
When you need to modify the map or route, use the appropriate tool.
Always explain what you're doing before calling a tool."""

        context = [{"role": "system", "content": system_prompt}]

        # Add recent messages (last 10)
        recent = session.get_recent_context(10)
        for msg in recent:
            context.append({
                "role": msg["role"],
                "content": msg["content"],
            })

        return context

    def _apply_tool_result(self, session: Session, tool_name: str, args: dict, result: dict):
        """Apply tool results back to session state."""
        if tool_name == "geocode_location" and result.get("success"):
            loc = result.get("result", {})
            if loc:
                # Add new location
                session.locations.append({
                    "name": loc.get("name", args.get("name", "")),
                    "latitude": loc.get("latitude", 0),
                    "longitude": loc.get("longitude", 0),
                    "full_address": loc.get("full_address", ""),
                })

        elif tool_name == "plan_route" and result.get("success"):
            route = result.get("result", {})
            if route:
                session.route = route

        elif tool_name == "map_operation" and result.get("success"):
            action = args.get("action", "")
            params = args.get("params", {})
            if action == "remove_pin" and "index" in params:
                idx = params["index"]
                if 0 <= idx < len(session.locations):
                    session.locations.pop(idx)
                    # Re-plan route
                    if len(session.locations) >= 2:
                        from backend.services.route_planner import plan_route
                        session.route = plan_route(session.locations)
                    else:
                        session.route = None


    async def _update_memory(self, session: Session):
        """Auto-update long-term memory."""
        import asyncio
        import json
        import re

        from backend.services.llm_client import call_llm

        # Build memory prompt from current session
        memory_prompt = f"""Analyze this travel conversation and extract user interests/preferences as
        concise memory items. Output a JSON array of objects: {{"key": str, "value": str, "category": str}}.
        
        Categories: preference, visited_place, interest, disliked, plan
        
        Conversation:
        Title: {session.title[:100] if session.title else 'N/A'}
        Source: {session.source_url or 'N/A'}
        Locations discussed: {[loc.get("name", "") for loc in (session.locations or [])[:15]]}
        
        Rules:
        - Key should be a short label (e.g. "cuisine_preference", "travel_style")
        - Value should be descriptive (e.g. "User prefers street food over fine dining")
        - Only include items that are clearly indicated, don't fabricate
        
        JSON:"""

        raw_content = "[]"
        try:
            result = await asyncio.to_thread(
                call_llm,
                messages=[{"role": "system", "content": memory_prompt}],
                temperature=0.3,
                max_tokens=1024,
            )
            raw_content = result.get("content", "[]")

            # ---- Robust JSON extraction ----
            # Strip markdown code fences: ```json ... ``` or ``` ... ```
            cleaned = raw_content.strip()
            if cleaned.startswith("```"):
                cleaned = re.sub(r'^```(?:json)?\s*\n?', '', cleaned)
                cleaned = re.sub(r'\n?```\s*$', '', cleaned)
                cleaned = cleaned.strip()

            memories = json.loads(cleaned)

            # Validate we got a list; unwrap if LLM wrapped in an object
            if not isinstance(memories, list):
                print(f"[Memory] LLM returned non-list ({type(memories).__name__}), attempting unwrap")
                if isinstance(memories, dict):
                    # Try common wrapper keys
                    for key in ("memories", "items", "data", "results"):
                        val = memories.get(key)
                        if isinstance(val, list):
                            memories = val
                            break
                    else:
                        # Fallback: take first list value found
                        for val in memories.values():
                            if isinstance(val, list):
                                memories = val
                                break
                        else:
                            memories = []
                else:
                    memories = []

            print(f"[Memory] Extracted {len(memories)} memory item(s) from session {session.session_id[:8]}")

            # Save new memories via conversation_manager (handles Supabase persist)
            if session.session_id and memories:
                saved_count = 0
                for mem in memories[:10]:
                    success = await conversation_manager.add_memory(
                        session.session_id,
                        mem.get("key", ""),
                        mem.get("value", ""),
                        mem.get("category", "preference"),
                    )
                    if success:
                        saved_count += 1

                print(f"[Memory] Saved {saved_count}/{min(len(memories), 10)} items to Supabase")
            else:
                print(f"[Memory] No memories to save (session_id={bool(session.session_id)}, memories={bool(memories)})")

        except json.JSONDecodeError as e:
            print(f"[Memory] JSON parse error: {e}")
            print(f"[Memory] Raw LLM content (first 500 chars): {raw_content[:500]}")
        except Exception as e:
            print(f"[Memory] Update failed: {e}")


# Module-level singleton
agent_orchestrator = AgentOrchestrator()
