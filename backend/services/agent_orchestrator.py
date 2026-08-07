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
import re
import time
from typing import Optional

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

from backend.services.content_classifier import classify_location_content
from backend.services.conversation_manager import Session, conversation_manager
from backend.services.performance_logger import PipelineMetrics, record_metrics
from backend.services.tool_definitions import TOOLS, registry
from backend.services.translation import translate_to_english


def _matches_inferred_region(geocoded: dict, inferred_region: str | None) -> bool:
    """Reject a globally valid geocoder result that conflicts with one-region content."""
    if not inferred_region:
        return True
    address = re.sub(r"[^a-z0-9]+", " ", (geocoded.get("full_address") or "").lower())
    if not address.strip():
        return False
    ignored_parts = {"us", "usa", "united states", "uk", "united kingdom", "france", "italy", "japan", "china"}
    candidates = [
        re.sub(r"[^a-z0-9]+", " ", part.lower()).strip()
        for part in inferred_region.split(",")
    ]
    candidates = [part for part in candidates if len(part) > 2 and part not in ignored_parts]
    return any(re.search(rf"\b{re.escape(candidate)}\b", address) for candidate in candidates)


def _stream_identified_places(request_id: str | None, locations: list[dict], limit: int = 12) -> None:
    """Publish actual extracted names for the UI without adding analysis work."""
    from backend.services import progress
    progress.stream_identified_places(request_id, locations, limit=limit)


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
        self._parse_graph = self._build_parse_graph()
        self._background_tasks: set[asyncio.Task] = set()

    @property
    def parse_graph(self):
        """Expose the compiled parse graph for LangGraph Studio / server entrypoints."""
        return self._parse_graph

    async def run_pipeline(self, url: str, session: Session, request_id: str | None = None) -> dict:
        """Run the complete extraction pipeline for a URL through LangGraph."""
        from backend.services.cache import get_cached_result, set_cached_result
        from backend.services.llm_client import get_last_llm_usage

        # ── Initialize performance metrics ──────────────────────────────
        metrics = PipelineMetrics()
        metrics.run_id = f"run_{int(time.time() * 1000)}"
        metrics.source_url = url
        metrics.t_request = time.time()

        # 0. Check cache — return immediately on hit
        cached = get_cached_result(url)
        if cached is not None:
            from backend.services.place_image_service.place_image_service import _missing_photo_count, _photo_signature, enrich_response_with_photos

            print(f"[AgentOrchestrator] Cache HIT for URL: {url[:80]}")
            # Photo enrichment entry point 2: internal orchestrator URL cache.
            # This cache-hit return can bypass main.py's get_or_build_response
            # wrapper, so cached payloads are upgraded here before they leave
            # run_pipeline().
            missing_before = _missing_photo_count(cached)
            if missing_before:
                photo_before = _photo_signature(cached)
                await enrich_response_with_photos(cached)
                if _photo_signature(cached) != photo_before:
                    # Persist when the cached response gained or explicitly
                    # recorded photo_url fields before it is bundled.
                    set_cached_result(url, cached)
            now = time.time()
            metrics.t_fetch_done = now
            metrics.t_parse_done = now
            metrics.t_geocode_done = now
            metrics.t_photo_done = now
            metrics.t_response = now
            record_metrics(metrics)

            # Restore session fields from cached result
            session.source_url = url
            session.source_type = cached.get("source_type")
            session.title = cached.get("title", "")
            session.locations = cached.get("locations", [])
            session.route = cached.get("route")
            session.inferred_region = cached.get("inferred_region")
            session.removed_noise = cached.get("removed_noise", [])
            session.removed_hierarchy = cached.get("removed_hierarchy", [])
            return cached

        result = await self._parse_graph.ainvoke(
            {
                "mode": "url",
                "url": url,
                "content": "",
                "source_type": "scrape",
                "title": "",
                "session": session,
                "metrics": metrics,
                "request_id": request_id,
                "title_hint": None,
            },
            config={
                "configurable": {"thread_id": request_id or session.session_id},
                "run_name": "AtlasParseGraph:url_pipeline",
            },
        )

        from backend.services.place_image_service.place_image_service import enrich_response_with_photos

        # Fresh orchestrator results are enriched before this internal cache
        # write; main.py may still run the response-bundling wrapper afterward
        # for /parse_link, so that wrapper should treat already-present
        # photo_url fields as complete.
        await enrich_response_with_photos(result)
        metrics.t_photo_done = time.time()

        # Store successful result in cache
        set_cached_result(url, result)
        print(f"[AgentOrchestrator] Cached result for URL: {url[:80]}")

        # ── Finalize and record metrics ─────────────────────────────────
        metrics.t_response = time.time()
        record_metrics(metrics)

        return result

    async def _process_content(self, content: str, source_type: str, session: Session,
                               metrics: Optional[PipelineMetrics] = None,
                               request_id: str | None = None,
                               title: str | None = None) -> dict:
        """Shared pipeline: extraction -> entity linking -> geocoding -> route.

        Used by both run_pipeline (URL input) and run_pipeline_from_text
        (user-pasted text). Everything below is source-agnostic.

        Args:
            metrics: Optional PipelineMetrics to record timing and LLM token usage.
        """
        # 2. Decide whether the content is name-heavy or address-heavy.
        mode = await classify_location_content(content, source_type=source_type)
        session.source_type = mode
        from backend.services import progress
        progress.stream_note(request_id, "langchain:route", {"detail": f"Routing as {mode}."})

        if mode == "address_first":
            from backend.services.atlas_ai_discovery import \
                discover_places_from_query

            discovery = await discover_places_from_query(content, request_id=request_id)
            locations = discovery.get("locations", [])
            session.removed_noise = discovery.get("removed_noise", [])
            session.removed_hierarchy = discovery.get("removed_hierarchy", [])
            session.inferred_region = discovery.get("inferred_region")
            session.is_multi_region = discovery.get("is_multi_region", False)

            from backend.services import progress
            progress.mark(request_id, "entity_linking_done", "Places identified.", {
                "location_count": len(locations),
                "inferred_region": discovery.get("inferred_region"),
                "mode": mode,
            })
            _stream_identified_places(request_id, locations)
            progress.stream_note(request_id, "Routing", {"detail": "Address-heavy content detected; geocoding directly."})
            progress.mark(request_id, "geocode_done", "Coordinates resolved.", {
                "query_count": len(locations),
                "resolved_count": len(locations),
            })

            if metrics:
                metrics.t_parse_done = time.time()

            session.locations = locations
            session.route = discovery.get("route")
            return {
                "title": discovery.get("title", session.title),
                "locations": locations,
                "route": discovery.get("route"),
                "removed_noise": session.removed_noise,
                "removed_hierarchy": session.removed_hierarchy,
                "inferred_region": session.inferred_region,
                "source_type": discovery.get("source_type", mode),
                "session_id": session.session_id,
            }

        # 3. Extract locations with hierarchy
        from backend.services.extraction_pipeline import ExtractionPipeline
        from backend.services.llm_client import get_last_llm_usage
        extraction = await ExtractionPipeline.extract(content, source_type, request_id=request_id)

        # ── Record LLM token usage from extraction ──────────────────────
        if metrics:
            extr_usage = get_last_llm_usage()
            metrics.llm_calls.append({
                "call_name": "extraction",
                "input_tokens": extr_usage.get("input_tokens", 0),
                "output_tokens": extr_usage.get("output_tokens", 0),
                "duration_s": extr_usage.get("duration_s", 0.0),
            })

        location_names = extraction.get("locations", [])
        session.removed_noise = extraction.get("removed_noise", [])
        session.removed_hierarchy = extraction.get("removed_hierarchy", [])
        session.inferred_region = extraction.get("inferred_region")
        session.is_multi_region = extraction.get("is_multi_region", False)

        if not location_names:
            # Some travel articles are better handled as discovery tasks than
            # as strict entity extraction. Retry once with a compact query built
            # from the title + a short excerpt of the content.
            from backend.services.atlas_ai_discovery import \
                discover_places_from_query

            fallback_query = "\n".join(
                part for part in [
                    (title or "").strip(),
                    content[:3000].strip(),
                ]
                if part
            )
            if fallback_query:
                try:
                    discovery = await discover_places_from_query(fallback_query, request_id=request_id)
                    fallback_locations = discovery.get("locations", [])
                    if fallback_locations:
                        session.removed_noise = discovery.get("removed_noise", [])
                        session.removed_hierarchy = discovery.get("removed_hierarchy", [])
                        session.inferred_region = discovery.get("inferred_region")
                        session.is_multi_region = discovery.get("is_multi_region", False)
                        session.locations = fallback_locations
                        session.route = discovery.get("route")
                        return {
                            "title": discovery.get("title", session.title),
                            "locations": fallback_locations,
                            "route": discovery.get("route"),
                            "removed_noise": session.removed_noise,
                            "removed_hierarchy": session.removed_hierarchy,
                            "inferred_region": session.inferred_region,
                            "source_type": discovery.get("source_type", "atlas_ai"),
                            "session_id": session.session_id,
                        }
                except Exception:
                    pass

            raise ValueError("No geographic locations could be extracted from this content.")

        # 2.5 Entity linking is only needed for aliases, abbreviations, and
        # generic labels. Extraction already supplies context for normal POIs.
        if self._needs_entity_linking(location_names, extraction.get("inferred_region")):
            location_names = await self._entity_linking(location_names, extraction.get("inferred_region"), request_id=request_id)
        from backend.services import progress
        _stream_identified_places(request_id, location_names)
        progress.mark(request_id, "entity_linking_done", "Places identified.", {
            "location_count": len(location_names),
            "inferred_region": extraction.get("inferred_region"),
            "mode": mode,
        })
        progress.stream_note(request_id, "Analyzing", {"detail": "Finding named places and disambiguating them."})

        # ── Parse complete: text analysis finished ──────────────────────
        if metrics:
            metrics.t_parse_done = time.time()

        # 2.6 Geocode the inferred_region to get a proximity bias point
        proximity = None
        city_center = None
        inferred_region = extraction.get("inferred_region")
        if inferred_region:
            try:
                from backend.services.geocoder import \
                    geocode as _geocode_region

                # 使用完整 geocode 函数（含 fallback 链 + country check），不用 amenity-only 版本
                region_geo = await _geocode_region(inferred_region)
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

        # Build geocoding queries — prefer exact address from LLM when available.
        geocode_queries = []
        for loc in location_names:
            name = loc["name"]
            exact_address = (loc.get("address") or "").strip()
            if exact_address:
                geocode_queries.append({
                    "query": exact_address,
                    "fallback_query": name,
                    "name": name,
                })
            else:
                geocode_queries.append(name)

        geocoded = await batch_geocode(
            geocode_queries, proximity=proximity,
            city_name=inferred_region, city_center=city_center,
        )
        progress.mark(request_id, "geocode_done", "Coordinates resolved.", {
            "query_count": len(geocode_queries),
            "resolved_count": len([item for item in geocoded if item]),
        })
        progress.stream_note(request_id, "Routing", {"detail": "Coordinates resolved; planning the route."})

        # ── Geocode complete ────────────────────────────────────────────
        if metrics:
            metrics.t_geocode_done = time.time()

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
        validated = self._validate_coordinates(
            locations,
            extraction.get("inferred_region"),
            is_multi_region=extraction.get("is_multi_region", False),
            region_center=city_center,
        )
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
            await self._update_memory(session, metrics=metrics)
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

    async def run_pipeline_from_text(
        self,
        text: str,
        session: Session,
        request_id: str | None = None,
        title: str | None = None,
        source_type: str = "text",
    ) -> dict:
        """Run the extraction pipeline on user-pasted text (no scraping).

        Covers sources we cannot scrape - Xiaohongshu notes, WeChat articles,
        text a friend sent - the user copies the content and pastes it in.
        """
        text = await translate_to_english(text, request_id=request_id)
        session.source_url = None
        session.source_type = source_type
        if title:
            session.title = title[:120]
        else:
            # Derive a short title from the first non-empty line of the text
            first_line = next((ln.strip() for ln in text.splitlines() if ln.strip()), "Pasted text")
            session.title = first_line[:80]

        # ── Initialize performance metrics ──────────────────────────────
        metrics = PipelineMetrics()
        metrics.run_id = f"run_{int(time.time() * 1000)}"
        metrics.source_url = "pasted_text"
        metrics.t_request = time.time()

        result = await self._parse_graph.ainvoke(
            {
                "mode": "text",
                "url": None,
                "content": text,
                "source_type": source_type,
                "title": session.title,
                "session": session,
                "metrics": metrics,
                "request_id": request_id,
                "title_hint": session.title,
            },
            config={
                "configurable": {"thread_id": request_id or session.session_id},
                "run_name": "AtlasParseGraph:text_pipeline",
            },
        )

        # ── Finalize and record metrics ─────────────────────────────────
        metrics.t_response = time.time()
        record_metrics(metrics)

        return result

    def _build_parse_graph(self):
        graph = StateGraph(dict)

        graph.add_node("fetch", self._graph_fetch)
        graph.add_node("classify", self._graph_classify)
        graph.add_node("extract", self._graph_extract)
        graph.add_node("entity_link", self._graph_entity_link)
        graph.add_node("geocode", self._graph_geocode)
        graph.add_node("route", self._graph_route)
        graph.add_node("persist", self._graph_persist)

        graph.set_entry_point("fetch")
        graph.add_edge("fetch", "classify")
        graph.add_conditional_edges("classify", self._route_after_classify, {
            "address_first": "geocode",
            "named_poi": "extract",
        })
        graph.add_edge("extract", "entity_link")
        graph.add_edge("entity_link", "geocode")
        graph.add_edge("geocode", "route")
        graph.add_edge("route", "persist")
        graph.add_edge("persist", END)

        return graph.compile(
            name="AtlasParseGraph",
            checkpointer=MemorySaver(),
        )

    async def _graph_fetch(self, state: dict) -> dict:
        from backend.services import progress
        from backend.services.web_scraper import WebScraper

        if state["mode"] != "url":
            return state

        session: Session = state["session"]
        url = state["url"]
        session.source_url = url
        session.source_type = "scrape"

        scrape_result = await WebScraper.scrape(url)
        if not scrape_result.get("success"):
            raise ValueError(f"Failed to scrape URL: {scrape_result.get('error', 'Unknown error')}")
        content = scrape_result.get("content", "")
        title = scrape_result.get("title", "")
        title = await translate_to_english(title or url, request_id=state["request_id"])
        session.title = title
        content = await translate_to_english(content, request_id=state["request_id"])
        metrics: Optional[PipelineMetrics] = state.get("metrics")
        if metrics:
            metrics.t_fetch_done = time.time()
        progress.mark(state["request_id"], "source_fetched", "Source prepared.", {
            "title": title,
            "characters": len(content),
            "source_type": scrape_result.get("source_type", "generic"),
            "provider": scrape_result.get("provider"),
        })
        progress.stream_note(state["request_id"], "Analyzing", {"detail": "Source is in hand; extracting and resolving places now."})
        state["content"] = content
        state["source_type"] = scrape_result.get("source_type", "generic")
        state["ranked_items"] = scrape_result.get("ranked_items")
        state["ranked_region"] = scrape_result.get("inferred_region")
        state["title"] = title
        return state

    async def _graph_classify(self, state: dict) -> dict:
        if state["mode"] == "url":
            if state.get("ranked_items"):
                state["source_type"] = "ranked_list"
                return state
            state["source_type"] = await classify_location_content(state["content"], source_type=state["source_type"])
        return state

    def _route_after_classify(self, state: dict) -> str:
        from backend.services import progress
        progress.stream_note(state["request_id"], "langchain:route", {"detail": f"Routing as {state['source_type']}."})
        return "address_first" if state["source_type"] == "address_first" else "named_poi"

    async def _graph_extract(self, state: dict) -> dict:
        from backend.services.extraction_pipeline import ExtractionPipeline
        extraction = await ExtractionPipeline.extract(
            state["content"],
            state["source_type"],
            request_id=state["request_id"],
            ranked_items=state.get("ranked_items"),
            inferred_region=state.get("ranked_region"),
        )
        state["extraction"] = extraction
        return state

    async def _graph_entity_link(self, state: dict) -> dict:
        extraction = state.get("extraction", {})
        locations = extraction.get("locations", [])
        if not locations:
            state["locations"] = []
            return state
        if self._needs_entity_linking(locations, extraction.get("inferred_region")):
            state["locations"] = await self._entity_linking(locations, extraction.get("inferred_region"), request_id=state["request_id"])
        else:
            state["locations"] = locations
        _stream_identified_places(state["request_id"], state["locations"])
        metrics: Optional[PipelineMetrics] = state.get("metrics")
        if metrics:
            metrics.t_parse_done = time.time()
        return state

    async def _graph_geocode(self, state: dict) -> dict:
        from backend.services import progress
        from backend.services.atlas_ai_discovery import \
            discover_places_from_query
        extraction = state.get("extraction", {})
        session: Session = state["session"]

        if state.get("source_type") == "address_first":
            discovery = await discover_places_from_query(state["content"], request_id=state["request_id"])
            state["final_result"] = discovery
            session.removed_noise = discovery.get("removed_noise", [])
            session.removed_hierarchy = discovery.get("removed_hierarchy", [])
            session.inferred_region = discovery.get("inferred_region")
            session.is_multi_region = discovery.get("is_multi_region", False)
            progress.mark(state["request_id"], "entity_linking_done", "Places identified.", {
                "location_count": len(discovery.get("locations", [])),
                "inferred_region": discovery.get("inferred_region"),
                "mode": state.get("source_type"),
            })
            _stream_identified_places(state["request_id"], discovery.get("locations", []))
            progress.mark(state["request_id"], "geocode_done", "Coordinates resolved.", {
                "query_count": len(discovery.get("locations", [])),
                "resolved_count": len(discovery.get("locations", [])),
            })
            metrics: Optional[PipelineMetrics] = state.get("metrics")
            if metrics:
                now = time.time()
                metrics.t_parse_done = now
                metrics.t_geocode_done = now
            return state

        locations = state.get("locations", [])
        state["final_result"] = await self._process_geocode_only(locations, extraction, session, state["request_id"])
        metrics: Optional[PipelineMetrics] = state.get("metrics")
        if metrics:
            metrics.t_geocode_done = time.time()
        return state

    async def _process_geocode_only(self, location_names: list[dict], extraction: dict, session: Session, request_id: str | None) -> dict:
        from backend.services import progress
        from backend.services.geocoder import batch_geocode

        session.removed_noise = extraction.get("removed_noise", [])
        session.removed_hierarchy = extraction.get("removed_hierarchy", [])
        session.inferred_region = extraction.get("inferred_region")
        session.is_multi_region = extraction.get("is_multi_region", False)
        if not location_names:
            raise ValueError("No geographic locations could be extracted from this content.")

        # Comments often repeat the same venue. Preserve distinct same-named
        # places in different contexts, but do not spend limited geocoding
        # capacity resolving an identical entity more than once.
        unique_locations: list[dict] = []
        seen_queries: set[tuple[str, str]] = set()
        for location in location_names:
            name = (location.get("name") or "").strip()
            context = (location.get("context") or extraction.get("inferred_region") or "").strip()
            key = (name.lower(), context.lower())
            if name and key not in seen_queries:
                seen_queries.add(key)
                unique_locations.append(location)

        geocode_queries: list[dict] = []
        for location in unique_locations:
            name = (location.get("name") or "").strip()
            context = (location.get("context") or extraction.get("inferred_region") or "").strip()
            address = (location.get("address") or "").strip()
            contextual_name = f"{name}, {context}" if context and context.lower() not in name.lower() else name
            geocode_queries.append({
                "query": address or contextual_name,
                "fallback_query": contextual_name if address and contextual_name != address else None,
            })

        geocoded = await batch_geocode(geocode_queries, city_name=extraction.get("inferred_region"))
        progress.mark(request_id, "geocode_done", "Coordinates resolved.", {"query_count": len(geocode_queries), "resolved_count": len([i for i in geocoded if i])})
        progress.stream_note(request_id, "Routing", {"detail": "Coordinates resolved; planning the route."})
        locations = []
        enforce_region = bool(extraction.get("inferred_region")) and not extraction.get("is_multi_region", False)
        for loc, geo in zip(unique_locations, geocoded):
            if geo:
                if enforce_region and not _matches_inferred_region(geo, extraction.get("inferred_region")):
                    session.removed_noise.append({
                        "name": loc.get("name", ""),
                        "reason": f"Geocoding result is outside the inferred region: {extraction.get('inferred_region')}",
                    })
                    continue
                geo["name"] = loc["name"]
                geo["context"] = loc.get("context", "")
                geo["hierarchy_level"] = loc.get("hierarchy_level", 2)
                geo["sentiment"] = loc.get("sentiment")
                geo["description"] = loc.get("description")
                geo["category"] = loc.get("category")
                locations.append(geo)
        session.locations = locations
        return {
            "locations": locations,
            "removed_noise": session.removed_noise,
            "removed_hierarchy": session.removed_hierarchy,
            "inferred_region": session.inferred_region,
        }


    async def _graph_route(self, state: dict) -> dict:
        from backend.services.route_planner import plan_route
        session: Session = state["session"]
        final_result = state.get("final_result", {})
        locations = final_result.get("locations", state.get("locations", []))
        session.locations = locations
        session.route = plan_route(locations)
        final_result["route"] = session.route
        state["final_result"] = final_result
        return state

    async def _graph_persist(self, state: dict) -> dict:
        session: Session = state["session"]
        final_result = state.get("final_result", {})
        session.add_message("system", f"Extracted {len(final_result.get('locations', []))} locations from the provided URL.")
        self._schedule_background_persistence(session, state.get("metrics"))
        final_result["title"] = final_result.get("title", session.title)
        final_result["session_id"] = session.session_id
        final_result["source_type"] = final_result.get("source_type", state.get("source_type"))
        return final_result

    @staticmethod
    def _needs_entity_linking(location_names: list[dict], inferred_region: str | None) -> bool:
        """Avoid a second LLM pass when extraction already made POIs unambiguous."""
        generic_names = {
            "the tower", "tower", "the bridge", "bridge", "the mall", "mall",
            "the palace", "palace", "the park", "park", "the museum", "museum",
            "monument", "monuments", "the beach", "beach", "the square", "square",
        }
        for location in location_names:
            name = (location.get("name") or "").strip()
            context = (location.get("context") or "").strip()
            if not name or name.lower() in generic_names:
                return True
            if len(name) <= 3 and name.isupper():
                return True
            if not context and not inferred_region:
                return True
        return False

    def _schedule_background_persistence(self, session: Session, metrics: Optional[PipelineMetrics]) -> None:
        async def persist() -> None:
            try:
                await conversation_manager.save_conversation(session.session_id)
                await self._update_memory(session, metrics=metrics)
            except Exception as exc:
                print(f"[AgentOrchestrator] Background session persistence failed: {exc}")

        task = asyncio.create_task(persist())
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)

    def _validate_coordinates(
        self,
        locations: list[dict],
        inferred_region: str | None = None,
        is_multi_region: bool = False,
        region_center: tuple[float, float] | None = None,
    ) -> list[dict]:
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
        if is_multi_region:
            threshold = max(200.0, min(1200.0, median_dist * 8))
        else:
            threshold = max(80.0, min(300.0, median_dist * 6))

        validated = []
        removed_noise = []

        for i, loc in enumerate(locations):
            dist = distances[i]
            if region_center and not is_multi_region:
                from backend.services.route_planner import haversine
                dist_from_region = haversine(region_center[1], region_center[0], loc["latitude"], loc["longitude"])
                if dist_from_region > 300.0:
                    removed_noise.append({
                        "name": loc.get("name", ""),
                        "reason": (
                            f"Far from inferred region '{inferred_region}': "
                            f"{dist_from_region:.0f} km away"
                        ),
                    })
                    continue
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

    async def _entity_linking(self, location_names: list[dict], inferred_region: str | None = None, request_id: str | None = None) -> list[dict]:
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

IMPORTANT: Input names may be in any language. You MUST output ALL disambiguated names in ENGLISH. Translate any non-English names to their English equivalent.

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
                request_id=request_id,
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
        if not session.user_memory_summary:
            try:
                memories = await conversation_manager.get_all_memories()
                if memories:
                    summary_lines = []
                    for memory in memories[:20]:
                        key = memory.get("key", "memory")
                        value = memory.get("value", "")
                        category = memory.get("category", "preference")
                        summary_lines.append(f"- {key} ({category}): {value}")
                    session.user_memory_summary = "\n".join(summary_lines)
            except Exception:
                pass

        # Run agent loop
        result = await self._agent_loop(session)
        try:
            asyncio.create_task(self._post_chat_maintenance(session))
        except Exception:
            pass

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
                    extra_body={
                        "metadata": {
                            "run_name": "agent_loop_step",
                            "step": step,
                            "session_id": session.session_id,
                        }
                    },
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
                    if tool_name == "map_operation":
                        tool_args = {**tool_args, "session_id": session.session_id}
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

    async def _post_chat_maintenance(self, session: Session) -> None:
        """Run summary, memory, and persistence after the response is returned."""
        try:
            await self._maybe_roll_conversation_summary(session)
            await self._update_memory(session)
            await conversation_manager.save_conversation(session.session_id)
        except Exception:
            pass

    async def _maybe_roll_conversation_summary(self, session: Session) -> None:
        """Compress every ~10 new chat messages into a persisted summary."""
        from backend.services.llm_client import call_llm

        if len(session.messages) < 10:
            return
        if len(session.messages) - session.summary_message_count < 10:
            return

        start_index = session.summary_message_count
        end_index = len(session.messages)
        chunk = session.messages[start_index:end_index][-10:]

        summary_prompt = """You are summarizing a travel chat for future follow-up.
Return a concise English summary (max 120 words) capturing:
1. The user's current goal
2. Places or regions discussed
3. Preferences, constraints, dislikes, and decisions
4. Open questions / next actions

Keep names and facts precise. Do not invent anything.
"""
        messages = [{"role": "system", "content": summary_prompt}]
        for msg in chunk:
            messages.append({
                "role": msg.get("role", "user"),
                "content": str(msg.get("content", "")),
            })

        result = await asyncio.to_thread(
            call_llm,
            messages=messages,
            temperature=0.1,
            max_tokens=256,
        )
        summary = (result.get("content") or "").strip()
        if not summary:
            return

        session.conversation_summary = summary
        session.summary_message_count = end_index
        session.last_summary_at = time.time()
        await conversation_manager.save_conversation_summary(
            session.session_id,
            summary,
            start_message_index=start_index,
            end_message_index=end_index,
        )

    def _build_agent_context(self, session: Session) -> list[dict]:
        """Build the full context for the agent LLM call."""
        system_prompt = f"""You are a travel assistant AI that helps users plan itineraries from web content.

Current session state:
- Locations on map: {len(session.locations)}
- Location names: {", ".join(loc.get("name", "") for loc in session.locations[:12]) or "N/A"}
- Route planned: {'Yes' if session.route else 'No'}
- Total distance: {session.route.get('total_distance_km', 'N/A') if session.route else 'N/A'} km
- Source: {session.source_type or 'N/A'}
{f'- Rolling summary: {session.conversation_summary}' if session.conversation_summary else ''}
{f'- Long-term memory: {session.user_memory_summary}' if session.user_memory_summary else ''}

You have access to tools. Use them when the user asks to:
- Add/remove locations: use map_operation
- Reorder or optimize routes: use map_operation or plan_route
- Find more information about a place: use geocode_location
- Search for nearby places: use geocode_location with context
- Discover a fresh set of places from a topic or pasted content: first identify candidate real-world places, then use geocode_location or batch_geocode to validate them before your final answer

When the user's request is simple (e.g., just asking a question), respond directly without tools.
When you need to modify the map or route, use the appropriate tool.
When the user is asking for a list of places, prefer a compact line-by-line answer with concrete place names and city/region context so the client can turn it into map pins.
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

    async def _update_memory(self, session: Session, metrics: Optional[PipelineMetrics] = None):
        """Auto-update long-term user memory from the current session."""
        import asyncio
        import json
        import re

        from backend.services.llm_client import call_llm, get_last_llm_usage

        recent_messages = session.get_recent_context(20)
        if not recent_messages:
            return

        memory_prompt = f"""You are extracting durable user memory from a travel app conversation.

Return valid JSON with this exact shape:
{{
  "profile_summary": "2-4 concise English sentences about the user",
  "memories": [
    {{"key": "short_key", "value": "durable memory sentence", "category": "preference|interest|visited_place|disliked|constraint|plan"}}
  ]
}}

Rules:
1. Extract only durable, reusable facts about the user.
2. Prefer preferences, constraints, visited places, and recurring interests.
3. Do not store transient task details unless they are important for future chats.
4. Keep everything in English.
5. If nothing useful is present, return an empty memories array and a brief neutral profile summary.

Conversation summary:
{session.conversation_summary or "N/A"}
"""
        messages = [{"role": "system", "content": memory_prompt}]
        for msg in recent_messages:
            messages.append({
                "role": msg.get("role", "user"),
                "content": str(msg.get("content", "")),
            })

        raw_content = "[]"
        try:
            result = await asyncio.to_thread(
                call_llm,
                messages=messages,
                temperature=0.2,
                max_tokens=1024,
            )
            raw_content = result.get("content", "[]")

            if metrics:
                mem_usage = get_last_llm_usage()
                metrics.llm_calls.append({
                    "call_name": "memory_update",
                    "input_tokens": mem_usage.get("input_tokens", 0),
                    "output_tokens": mem_usage.get("output_tokens", 0),
                    "duration_s": mem_usage.get("duration_s", 0.0),
                })

            cleaned = raw_content.strip()
            if cleaned.startswith("```"):
                cleaned = re.sub(r'^```(?:json)?\s*\n?', '', cleaned)
                cleaned = re.sub(r'\n?```\s*$', '', cleaned)
                cleaned = cleaned.strip()

            parsed = json.loads(cleaned)
            if not isinstance(parsed, dict):
                return

            profile_summary = str(parsed.get("profile_summary", "")).strip()
            if profile_summary:
                await conversation_manager.add_memory(
                    session.session_id,
                    "user.profile_summary",
                    profile_summary,
                    "profile",
                )

            memories = parsed.get("memories", [])
            if not isinstance(memories, list):
                memories = []

            saved_count = 0
            for mem in memories[:12]:
                key = str(mem.get("key", "")).strip()
                value = str(mem.get("value", "")).strip()
                category = str(mem.get("category", "preference")).strip() or "preference"
                if not key or not value:
                    continue
                success = await conversation_manager.add_memory(
                    session.session_id,
                    f"user.{key}",
                    value,
                    category,
                )
                if success:
                    saved_count += 1

            if profile_summary or saved_count:
                print(f"[Memory] Updated profile + {saved_count} durable memory item(s) for session {session.session_id[:8]}")
        except json.JSONDecodeError as e:
            print(f"[Memory] JSON parse error: {e}")
            print(f"[Memory] Raw LLM content (first 500 chars): {raw_content[:500]}")
        except Exception as e:
            print(f"[Memory] Update failed: {e}")

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
            elif action == "add_pin":
                added_locations = result.get("locations") or []
                if added_locations:
                    session.locations = added_locations
                    if len(session.locations) >= 2:
                        from backend.services.route_planner import plan_route
                        session.route = plan_route(session.locations)
            elif action == "save_to_my_places":
                # No direct session state change needed; persistence handled by tool.
                pass




# Module-level singleton
agent_orchestrator = AgentOrchestrator()
