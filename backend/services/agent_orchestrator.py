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

        # 2.6 Geocode the inferred_region to get a proximity bias point + city center
        proximity = None
        city_center = None
        inferred_region = extraction.get("inferred_region")
        if inferred_region:
            try:
                from backend.services.geocoder import geocode
                region_geo = await geocode(inferred_region)
                if region_geo:
                    proximity = (region_geo["longitude"], region_geo["latitude"])
                    city_center = proximity
                    print(f"[AgentOrchestrator] Using proximity bias: {proximity} for '{inferred_region}'")
            except Exception:
                pass  # If geocoding the region fails, proceed without proximity

        # 3. Geocode locations — include context + proximity bias
        from backend.services.geocoder import batch_geocode
        contexts = [loc.get("context", "") for loc in location_names]

        # When the inferred region is known (e.g. "Paris, France"), use it
        # as the default geographic context for ALL locations that lack
        # per-entity context from the LLM. This dramatically improves
        # geocoding accuracy — e.g. "Luxembourg" -> "Luxembourg Gardens, Paris"
        # instead of the country Luxembourg.
        default_context = inferred_region if inferred_region else ""

        # Build geocoding queries — prefer entity-level context, fall back
        # to the inferred region, then empty.
        geocode_queries = []
        for loc in location_names:
            name = loc["name"]
            ctx = loc.get("context", "")
            if ctx:
                geocode_queries.append(f"{name}, {ctx}")
            elif default_context:
                geocode_queries.append(f"{name}, {default_context}")
            else:
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

        # 4. Plan route
        from backend.services.route_planner import plan_route
        route = plan_route(locations)
        session.route = route

        # 5. Save session
        session.add_message("system", f"Extracted {len(locations)} locations from the provided URL.")

        return {
            "title": title,
            "locations": locations,
            "route": route,
            "removed_noise": session.removed_noise,
            "removed_hierarchy": session.removed_hierarchy,
            "inferred_region": session.inferred_region,
            "source_type": source_type,
            "session_id": session.session_id,
        }

    async def _entity_linking(self, locations: list[dict], inferred_region: str | None) -> list[dict]:
        """
        Entity Linking — disambiguate potentially ambiguous location names.

        Uses an LLM call to resolve common ambiguities:
        - "Louvre" -> "Louvre Museum, Paris"
        - "Luxembourg" -> "Luxembourg Gardens, Paris"
        - "Tuileries" -> "Jardin des Tuileries, Paris"
        - "Le Marais" -> "Le Marais, Paris 3rd/4th"

        This runs AFTER the extraction pipeline (which identifies names)
        but BEFORE geocoding (which maps names to coordinates).
        """
        import asyncio
        import json

        from backend.services.llm_client import call_llm

        names = [loc["name"] for loc in locations]

        entity_linking_prompt = f"""You are a precise geographic entity linker.
Given a list of place names and the inferred geographic region,
disambiguate each name so that a geocoding API can find the correct location.

Inferred region: {inferred_region or 'Unknown'}

Location names:
{json.dumps(names, ensure_ascii=False, indent=2)}

Rules:
1. If a name is ambiguous, add clarifying context in parentheses.
2. For well-known landmarks in the inferred region, make the name specific.
3. Examples of good disambiguation:
   - "ROM" → "Royal Ontario Museum, Toronto"
   - "AGO" → "Art Gallery of Ontario, Toronto"
   - "CN Tower" → "CN Tower, Toronto"
   - "Luxembourg" → "Luxembourg Gardens, Paris" (NOT the country)
   - "Louvre" → "Louvre Museum, Paris"
   - "MOCA" → "Museum of Contemporary Art Toronto"
4. If a name is already clear, keep it unchanged.
5. Output ONLY a JSON array of strings, same order.
"""

        try:
            result = await asyncio.to_thread(
                call_llm,
                messages=[{"role": "system", "content": entity_linking_prompt}],
                temperature=0.1,
                max_tokens=2048,
            )

            content = result.get("content", "[]")
            disambiguated = json.loads(content)

            if isinstance(disambiguated, list) and len(disambiguated) == len(locations):
                for i, new_name in enumerate(disambiguated):
                    if new_name and isinstance(new_name, str) and new_name != names[i]:
                        locations[i]["name"] = new_name
                        print(f"[EntityLinking] '{names[i]}' → '{new_name}'")
        except Exception as e:
            print(f"[EntityLinking] Failed: {e}")

        return locations

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

        # Only remove extreme outliers > 500km (cross-country errors)
        threshold = 500.0

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


# Module-level singleton
agent_orchestrator = AgentOrchestrator()
