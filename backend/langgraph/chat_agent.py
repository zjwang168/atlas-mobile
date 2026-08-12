"""Conversational Atlas agent with bounded, confirmation-first tool calling."""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
import time
import uuid
from typing import Any, AsyncIterator

import httpx
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import BaseTool, tool

from backend.langchain.runtime import get_chat_model
from backend.services.conversation_manager import conversation_manager

MAX_CONTEXT_MESSAGES = 20
MAX_AGENT_STEPS = 6
CHAT_TIMEOUT = 90
CHAT_PROVIDER = "openai_mango"
DEFAULT_CHAT_MODEL = "gpt-4o-mini"
NEARBY_DEFAULT_RADIUS_KM = 25
NEARBY_MAX_RADIUS_KM = 100
ATLAS_TRANSPORT_MODES = {
    "walk", "bike", "drive", "taxi", "bus", "coach", "subway", "train", "ferry", "flight",
}
_ACTION_MARKER_RE = re.compile(r"\[\[(?:PLACE_ACTION_CARD|CONFIRM_ADD_PLACES):[\s\S]*?\]\]")


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return "".join(
            part if isinstance(part, str) else str(part.get("text") or "")
            for part in content
            if isinstance(part, str) or (isinstance(part, dict) and part.get("type") == "text")
        ).strip()
    return str(content or "").strip()


def _chunk_to_text(chunk: Any) -> str:
    content = getattr(chunk, "content", chunk)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part if isinstance(part, str) else str(part.get("text") or "")
            for part in content
            if isinstance(part, str) or (isinstance(part, dict) and part.get("type") == "text")
        )
    return ""


def _location_context(session: Any) -> str:
    locations = getattr(session, "locations", []) or []
    if not locations:
        return "No places have been explicitly attached to this chat."
    lines = []
    for index, location in enumerate(locations[:50], start=1):
        name = str(location.get("name") or "Unknown place")
        address = str(location.get("full_address") or location.get("description") or "").strip()
        coordinates = ""
        if location.get("latitude") is not None and location.get("longitude") is not None:
            coordinates = f" ({location['latitude']}, {location['longitude']})"
        lines.append(f"{index}. {name}{coordinates}{f' | {address}' if address else ''}")
    return "\n".join(lines)


def _pending_atlas_context(session: Any) -> str:
    action = getattr(session, "pending_chat_action", None)
    if not action or action.get("kind") != "create_atlas":
        return "No Atlas draft is waiting for confirmation."
    lines = [f"Current Atlas draft: {action.get('title') or 'Untitled'}"]
    for index, place in enumerate(action.get("places") or [], start=1):
        schedule = ""
        if place.get("timeline_time"):
            day = f"Day {place['timeline_day']} · " if place.get("timeline_day") else ""
            schedule = f" | {day}{place['timeline_time']}"
        transport = f" | arrive by {place['transport']}" if place.get("transport") else ""
        coordinates = ""
        if place.get("latitude") is not None and place.get("longitude") is not None:
            coordinates = f" ({place['latitude']}, {place['longitude']})"
        lines.append(f"{index}. {place.get('name') or 'Unknown place'}{coordinates}{schedule}{transport}")
    return "\n".join(lines)


def _system_prompt(session: Any) -> str:
    title = str(getattr(session, "title", "") or "").strip()
    title_line = f"Chat title: {title}\n" if title else ""
    current = getattr(session, "user_location", None)
    location_line = (
        f"Current device location: longitude {current[0]:.6f}, latitude {current[1]:.6f}."
        if current and len(current) == 2
        else "Current device location is unavailable. Ask for a city or permission before nearby search."
    )
    return f"""You are Atlas AI, a travel and map agent inside the Atlas app.

Give concise, useful answers. For current, local, or verifiable facts, use live
web search when it improves the answer. Never invent a business, coordinates,
or an app write.

Tool rules:
- A nearby request, including gas stations, MUST call find_nearby_places. When
  the user names multiple categories, pass every distinct category in the
  categories array in one call (for example, ["car washes", "gas stations"]).
  Use a concrete POI query, not a loose description: for example use "dog park"
  for a park where dogs can be walked. A POI match alone does not prove rules
  such as leash policy, opening hours, or whether dogs are currently allowed.
- For pasted notes or an itinerary that the user wants added, call
  extract_pasted_places, then propose_add_places. This is only a proposal.
- For creating an Atlas, find or extract real places first, then call
  propose_create_atlas. This is only a proposal.
- If an Atlas draft already exists and the user asks to change its places,
  order, timing, or transport, call propose_create_atlas again with the
  complete revised list. Preserve every unchanged place. Put schedule data on
  each place using timeline_day (integer), timeline_time (human-readable time),
  and transport (one of walk, bike, drive, taxi, bus, coach, subway, train,
  ferry, flight). The transport on a place means the leg arriving at that
  place from the previous stop. Use the editor's whole-hour time format (for
  example 8am, 1pm, 4pm). Use visit_duration_minutes or
  travel_duration_minutes when you have a reasonable estimate.
- When the user gives start or finish constraints, produce a complete ordered
  schedule and state assumptions in the answer. Do not invent verified opening
  hours; label unverified durations as estimates.
- Never claim that a proposal was saved or created until the client confirms it.

{title_line}{location_line}

Explicit places attached to this chat:
{_location_context(session)}

Pending Atlas draft:
{_pending_atlas_context(session)}"""


def _history_messages(session: Any) -> list[BaseMessage]:
    messages: list[BaseMessage] = []
    for message in session.get_recent_context(MAX_CONTEXT_MESSAGES):
        role = message.get("role")
        content = _ACTION_MARKER_RE.sub("", str(message.get("content") or "")).strip()
        if not content or role == "tool" or content.startswith("[Used tool:"):
            continue
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))
    return messages


def _stored_presentation(value: Any) -> dict[str, Any] | None:
    """Read a persisted presentation from a tool-result payload."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return None
    if not isinstance(value, list):
        return None
    for item in value:
        if not isinstance(item, dict) or item.get("name") != "import_welcome":
            continue
        result = item.get("result")
        if isinstance(result, dict) and isinstance(result.get("presentation"), dict):
            return result["presentation"]
    return None


def _import_welcome_fallback(session: Any, deselected_names: list[str]) -> str:
    places = getattr(session, "locations", []) or []
    count = len(places)
    names = ", ".join(str(place.get("name") or "a place") for place in places[:3])
    suffix = f", including {names}" if names else ""
    skipped = f" I kept {len(deselected_names)} unselected place{'s' if len(deselected_names) != 1 else ''} out of this chat." if deselected_names else ""
    return (
        f"Hi, your {count} saved place{'s' if count != 1 else ''}{suffix} are ready to explore on the map below.{skipped}\n\n"
        "We can:\n- build a practical day-by-day route\n- compare neighborhoods and group nearby stops\n- find a good next stop, meal, or activity nearby\n\n"
        "What would you like to plan first?"
    )


async def generate_import_welcome(session_id: str, deselected_locations: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Create the first assistant turn for a saved import without a fake user turn."""
    session = conversation_manager.get_session(session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")

    for message in session.messages:
        if message.get("role") != "assistant":
            continue
        presentation = _stored_presentation(message.get("tool_results"))
        if presentation:
            return {
                "session_id": session.session_id,
                "conversation_id": session.conversation_id,
                "response": message.get("content") or _import_welcome_fallback(session, []),
                "locations": session.locations,
                "route": session.route,
                "tool_calls_used": [],
                "tool_results": message.get("tool_results") or [],
                "status": "success",
                "partial": False,
                "pending_action": None,
                "presentation": presentation,
                "place_cards": [],
                "metrics": {"latency_ms": 0, "tool_call_count": 0},
            }

    selected = _dedupe_places(getattr(session, "locations", []) or [], limit=50)
    session.locations = selected
    deselected_names = [
        str(place.get("name") or "").strip()[:200]
        for place in (deselected_locations or [])[:50]
        if isinstance(place, dict) and str(place.get("name") or "").strip()
    ]
    started_at = time.perf_counter()
    # This opening is product copy, not a question that needs model reasoning.
    # Generating it locally removes a full LLM round trip from Save and Ask AI.
    answer = _import_welcome_fallback(session, deselected_names)
    presentation = {
        "kind": "places_map",
        "title": f"{len(selected)} saved place{'s' if len(selected) != 1 else ''}",
        "user_location": (
            {"longitude": session.user_location[0], "latitude": session.user_location[1]}
            if session.user_location and len(session.user_location) == 2 else None
        ),
        "places": selected,
        "route": None,
    }
    session.chat_presentation = presentation
    tool_results = [{"name": "import_welcome", "result": {"presentation": presentation}}]
    session.add_message("assistant", answer, tool_results=tool_results)
    try:
        await conversation_manager.save_conversation(session.session_id)
    except Exception as error:
        print(f"[Chat] Failed to persist import welcome: {error}")
    return {
        "session_id": session.session_id,
        "conversation_id": session.conversation_id,
        "response": answer,
        "locations": session.locations,
        "route": session.route,
        "tool_calls_used": [],
        "tool_results": tool_results,
        "status": "success",
        "partial": False,
        "pending_action": None,
        "presentation": presentation,
        "place_cards": [],
        "metrics": {"latency_ms": round((time.perf_counter() - started_at) * 1000), "tool_call_count": 0},
    }


async def generate_atlas_welcome(session_id: str) -> dict[str, Any]:
    """Create the assistant-first opening message for a saved Atlas edit."""
    session = conversation_manager.get_session(session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")

    for message in session.messages:
        if message.get("role") != "assistant":
            continue
        presentation = _stored_presentation(message.get("tool_results"))
        if presentation and presentation.get("kind") == "atlas_draft":
            return {
                "session_id": session.session_id, "conversation_id": session.conversation_id,
                "response": message.get("content") or "Hi, your Atlas is ready to keep planning.",
                "locations": session.locations, "route": session.route, "tool_calls_used": [],
                "tool_results": message.get("tool_results") or [], "status": "success", "partial": False,
                "pending_action": None, "presentation": presentation, "place_cards": [],
                "metrics": {"latency_ms": 0, "tool_call_count": 0},
            }

    places = _dedupe_places(getattr(session, "locations", []) or [], limit=50)
    session.locations = places
    title = str(getattr(session, "title", "") or "your Atlas").strip()[:100]
    started_at = time.perf_counter()
    # The opening map card and suggested actions are known at save time. Avoid
    # an LLM request here so the Atlas editor can enter chat immediately.
    answer = (
        f"Hi, {title} is saved and ready to explore. The orange numbered map below follows your current stop order.\n\n"
        "We can:\n- tighten the route and travel times\n- add or adjust a day-by-day schedule\n- find a useful stop near any point\n\n"
        "What would you like to refine first?"
    )
    presentation = {
        "kind": "atlas_draft", "title": title, "places": places,
        "planning_note": "Your saved Atlas order is shown on the map.", "route": session.route,
        "user_location": (
            {"longitude": session.user_location[0], "latitude": session.user_location[1]}
            if session.user_location and len(session.user_location) == 2 else None
        ),
    }
    session.chat_presentation = presentation
    tool_results = [{"name": "atlas_welcome", "result": {"presentation": presentation}}]
    session.add_message("assistant", answer, tool_results=tool_results)
    try:
        await conversation_manager.save_conversation(session.session_id)
    except Exception as error:
        print(f"[Chat] Failed to persist Atlas welcome: {error}")
    return {
        "session_id": session.session_id, "conversation_id": session.conversation_id,
        "response": answer, "locations": session.locations, "route": session.route,
        "tool_calls_used": [], "tool_results": tool_results, "status": "success", "partial": False,
        "pending_action": None, "presentation": presentation, "place_cards": [],
        "metrics": {"latency_ms": round((time.perf_counter() - started_at) * 1000), "tool_call_count": 0},
    }


def _normalize_place(place: dict[str, Any]) -> dict[str, Any] | None:
    try:
        name = str(place.get("name") or "").strip()
        latitude = float(place.get("latitude"))
        longitude = float(place.get("longitude"))
    except (TypeError, ValueError):
        return None
    if not name or not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None
    timeline_day: int | None = None
    try:
        if place.get("timeline_day") is not None:
            timeline_day = max(1, int(place["timeline_day"]))
    except (TypeError, ValueError):
        timeline_day = None
    timeline_time = str(place.get("timeline_time") or "").strip()[:40] or None
    transport = str(place.get("transport") or "").strip().casefold()
    if transport not in ATLAS_TRANSPORT_MODES:
        transport = None

    def optional_minutes(key: str) -> int | None:
        try:
            value = place.get(key)
            if value is None or value == "":
                return None
            return max(0, min(int(value), 24 * 60))
        except (TypeError, ValueError):
            return None

    return {
        "name": name[:200],
        "latitude": latitude,
        "longitude": longitude,
        "full_address": str(place.get("full_address") or place.get("subtitle") or place.get("description") or "").strip()[:300],
        "description": str(place.get("description") or "").strip()[:500] or None,
        "category": str(place.get("category") or "Place").strip()[:100],
        "external_id": str(place.get("external_id") or "").strip() or None,
        "source": str(place.get("source") or "atlas_ai").strip()[:80],
        "photo_url": place.get("photo_url"),
        "city": place.get("city"),
        "region": place.get("region"),
        "country": place.get("country"),
        "timeline_day": timeline_day,
        "timeline_time": timeline_time,
        "transport": transport,
        "visit_duration_minutes": optional_minutes("visit_duration_minutes"),
        "travel_duration_minutes": optional_minutes("travel_duration_minutes"),
    }


def _dedupe_places(places: list[dict[str, Any]], limit: int = 12) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[tuple[str, int, int]] = set()
    for raw in places:
        place = _normalize_place(raw)
        if not place:
            continue
        key = (place["name"].casefold(), round(place["latitude"] * 10_000), round(place["longitude"] * 10_000))
        if key in seen:
            continue
        seen.add(key)
        result.append(place)
        if len(result) >= limit:
            break
    return result


def _nearby_categories(categories: list[str] | None, query: str | None) -> list[str]:
    """Normalize multi-category tool input and tolerate older single-query calls."""
    raw = categories or ([query] if query else [])
    normalized: list[str] = []
    seen: set[str] = set()
    for value in raw:
        for candidate in re.split(r"\s*(?:,|/|&|\band\b)\s*", str(value or ""), flags=re.IGNORECASE):
            clean = " ".join(candidate.split()).strip(" .")
            key = clean.casefold()
            if clean and key not in seen:
                seen.add(key)
                normalized.append(clean[:100])
    return normalized[:6]


def _nearby_distance_km(origin: tuple[float, float], place: dict[str, Any]) -> float:
    """Use straight-line distance only to consistently order mixed categories."""
    longitude, latitude = origin
    latitude_delta = math.radians(float(place["latitude"]) - latitude)
    longitude_delta = math.radians(float(place["longitude"]) - longitude)
    latitude_start = math.radians(latitude)
    latitude_end = math.radians(float(place["latitude"]))
    factor = math.sin(latitude_delta / 2) ** 2 + math.cos(latitude_start) * math.cos(latitude_end) * math.sin(longitude_delta / 2) ** 2
    return 6371 * 2 * math.atan2(math.sqrt(factor), math.sqrt(1 - factor))


def _nearby_bbox(longitude: float, latitude: float, radius_km: float) -> str:
    """Return a Mapbox bbox around the device location for a local search."""
    latitude_delta = radius_km / 111.32
    longitude_delta = radius_km / max(111.32 * math.cos(math.radians(latitude)), 0.01)
    west = max(-180, longitude - longitude_delta)
    east = min(180, longitude + longitude_delta)
    south = max(-90, latitude - latitude_delta)
    north = min(90, latitude + latitude_delta)
    return f"{west:.6f},{south:.6f},{east:.6f},{north:.6f}"


def _nearby_search_query(category: str) -> str:
    """Translate common conversational requests into Mapbox-friendly POI terms."""
    normalized = " ".join(category.casefold().split())
    if (
        "dog park" in normalized
        or "dog-friendly park" in normalized
        or "dog friendly park" in normalized
        or "park for dog" in normalized
        or "遛狗" in category
        or ("狗" in category and "公园" in category)
    ):
        return "dog park"
    if "car wash" in normalized or "洗车" in category:
        return "car wash"
    if "gas station" in normalized or "加油站" in category:
        return "gas station"
    return category


def _nearby_title(categories: list[str]) -> str:
    if not categories:
        return "Nearby places"
    if len(categories) == 1:
        return f"Nearby {categories[0]}"
    if len(categories) == 2:
        return f"Nearby {categories[0]} and {categories[1]}"
    return f"Nearby {', '.join(categories[:-1])}, and {categories[-1]}"


async def _road_route(coordinates: list[tuple[float, float]]) -> dict[str, Any] | None:
    """Return a real walking route when Mapbox routing is configured."""
    if len(coordinates) < 2 or not os.getenv("MAPBOX_ACCESS_TOKEN", "").strip():
        return None
    coordinate_string = ";".join(f"{lng},{lat}" for lng, lat in coordinates[:25])
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            response = await client.get(
                f"https://api.mapbox.com/directions/v5/mapbox/walking/{coordinate_string}",
                params={"access_token": os.environ["MAPBOX_ACCESS_TOKEN"], "geometries": "geojson", "overview": "full"},
            )
            response.raise_for_status()
        route = (response.json().get("routes") or [None])[0]
        if not route or not route.get("geometry"):
            return None
        return {
            "route": {"type": "Feature", "properties": {}, "geometry": route["geometry"]},
            "distance_km": round(float(route.get("distance", 0)) / 1000, 2),
            "duration_minutes": round(float(route.get("duration", 0)) / 60),
        }
    except (httpx.HTTPError, TypeError, ValueError, KeyError):
        return None


def _agent_tools(session: Any, state: dict[str, Any]) -> list[BaseTool]:
    @tool
    async def find_nearby_places(
        categories: list[str] | None = None,
        query: str | None = None,
        limit_per_category: int | None = None,
        limit: int | None = None,
        radius_km: int | None = None,
    ) -> dict[str, Any]:
        """Find POIs within a local GPS radius, never returning distant global matches."""
        current = getattr(session, "user_location", None)
        if not current or len(current) != 2:
            return {"error": "Current device location is unavailable."}
        longitude, latitude = float(current[0]), float(current[1])
        from backend.services import place_search_service

        requested_categories = _nearby_categories(categories, query)
        if not requested_categories:
            return {"error": "At least one nearby place category is required."}
        category_limit = max(1, min(int(limit_per_category or limit or 3), 8))
        search_radius_km = max(1, min(int(radius_km or NEARBY_DEFAULT_RADIUS_KM), NEARBY_MAX_RADIUS_KM))
        bbox = _nearby_bbox(longitude, latitude, search_radius_km)
        candidate_limit = min(10, max(category_limit * 2, 6))

        async def search_category(category: str) -> tuple[str, list[dict[str, Any]]]:
            session_token = str(uuid.uuid4())
            search_query = _nearby_search_query(category)
            suggestions = await place_search_service.suggest(
                query=search_query,
                session_token=session_token,
                proximity=f"{longitude},{latitude}",
                bbox=bbox,
                limit=candidate_limit,
            )
            retrieved = await asyncio.gather(*[
                place_search_service.retrieve(item["external_id"], session_token)
                for item in suggestions[:candidate_limit]
            ])
            candidates = _dedupe_places(
                [place for result in retrieved for place in result],
                limit=candidate_limit,
            )
            # Mapbox's proximity is only a ranking preference. Keep this hard
            # check so an ambiguous category can never zoom a nearby map out to
            # unrelated places elsewhere in the world.
            places = [
                place for place in candidates
                if _nearby_distance_km((longitude, latitude), place) <= search_radius_km
            ]
            places.sort(key=lambda place: _nearby_distance_km((longitude, latitude), place))
            places = places[:category_limit]
            for place in places:
                place["requested_category"] = category
            return category, places

        searched = await asyncio.gather(
            *(search_category(category) for category in requested_categories),
            return_exceptions=True,
        )
        groups = state.setdefault("nearby_groups", {})
        not_found_categories: list[str] = []
        for result in searched:
            if isinstance(result, Exception):
                continue
            category, places = result
            if places:
                groups[category] = places
            else:
                not_found_categories.append(category)

        merged: list[dict[str, Any]] = []
        seen: set[tuple[str, int, int]] = set()
        for category_places in groups.values():
            for place in category_places:
                key = (place["name"].casefold(), round(place["latitude"] * 10_000), round(place["longitude"] * 10_000))
                if key not in seen:
                    seen.add(key)
                    merged.append(place)
        places = sorted(merged, key=lambda place: _nearby_distance_km((longitude, latitude), place))[:24]
        displayed_categories = list(groups.keys())
        if not places:
            return {
                "categories": requested_categories,
                "places": [],
                "radius_km": search_radius_km,
                "error": f"No matching places were found within {search_radius_km} km.",
            }
        route = await _road_route([(longitude, latitude), (places[0]["longitude"], places[0]["latitude"])])
        session.locations = places
        session.route = route
        state["presentation"] = {
            "kind": "nearby_map", "title": _nearby_title(displayed_categories),
            "user_location": {"longitude": longitude, "latitude": latitude},
            "places": places,
            "groups": [{"category": category, "places": category_places} for category, category_places in groups.items()],
            "route": route,
        }
        return {
            "categories": requested_categories,
            "groups": [{"category": category, "places": category_places} for category, category_places in groups.items()],
            "places": places,
            "route": route,
            "radius_km": search_radius_km,
            "not_found_categories": not_found_categories,
        }

    @tool
    async def extract_pasted_places(text: str) -> dict[str, Any]:
        """Extract and geocode real places from text pasted by the user."""
        from backend.services.smart_text_service import analyze_smart_text

        result = await analyze_smart_text(text[:12_000], use_web_search=False)
        places = _dedupe_places(result.get("locations") or [])
        session.locations = places
        session.route = result.get("route")
        state["presentation"] = {
            "kind": "places_map", "title": result.get("title") or "Places from your text",
            "places": places, "route": session.route,
        }
        return {"title": result.get("title"), "places": places, "route": session.route}

    @tool
    async def propose_add_places(places: list[dict[str, Any]]) -> dict[str, Any]:
        """Propose saving parsed places to My Places. This never writes data."""
        normalized = _dedupe_places(places)
        if not normalized:
            return {"error": "A proposal needs at least one geocoded place."}
        action = {
            "action_id": str(uuid.uuid4()), "kind": "save_places",
            "title": f"Add {len(normalized)} place{'s' if len(normalized) != 1 else ''}",
            "places": normalized,
        }
        session.pending_chat_action = action
        state["pending_action"] = action
        state["presentation"] = {"kind": "places_map", "title": action["title"], "places": normalized, "route": session.route}
        return {"proposal": action}

    @tool
    async def propose_create_atlas(
        title: str,
        places: list[dict[str, Any]],
        planning_note: str | None = None,
    ) -> dict[str, Any]:
        """Propose or revise an Atlas draft with ordered, geocoded places.

        Each place may include timeline_day, timeline_time, transport,
        visit_duration_minutes, and travel_duration_minutes. This never writes
        an Atlas; the client must confirm the proposal first.
        """
        normalized = _dedupe_places(places)
        clean_title = " ".join(title.split())[:100]
        if not clean_title or not normalized:
            return {"error": "An Atlas draft needs a title and at least one geocoded place."}
        action = {
            "action_id": str(uuid.uuid4()), "kind": "create_atlas", "title": clean_title,
            "places": normalized, "planning_note": " ".join((planning_note or "").split())[:500] or None,
        }
        # The next user turn may refine this proposal. Preserve the full,
        # geocoded draft in the regular chat context so the model can submit a
        # revised complete itinerary without re-geocoding unchanged stops.
        session.locations = normalized
        session.pending_chat_action = action
        state["pending_action"] = action
        state["presentation"] = {
            "kind": "atlas_draft", "title": clean_title, "places": normalized,
            "planning_note": action["planning_note"], "route": session.route,
        }
        return {"proposal": action}

    return [find_nearby_places, extract_pasted_places, propose_add_places, propose_create_atlas]


async def _run_agent(session: Any, user_message: str) -> dict[str, Any]:
    message = (user_message or "").strip()
    if not message:
        raise ValueError("Message cannot be empty")
    if not session.messages and session.title in ("", "Atlas AI chat"):
        session.title = message[:100]
    started_at = time.perf_counter()
    session.chat_presentation = None
    session.add_message("user", message)
    model_name = os.environ.get("OPENAI_MODEL_MANGO") or os.environ.get("OPENAI_MODEL", DEFAULT_CHAT_MODEL)
    model = get_chat_model(CHAT_PROVIDER, model_name, temperature=0.3)
    prompt: list[BaseMessage] = [SystemMessage(content=_system_prompt(session)), *_history_messages(session)]
    state: dict[str, Any] = {"presentation": None, "pending_action": None, "nearby_groups": {}}
    tools = _agent_tools(session, state)
    tools_by_name = {item.name: item for item in tools}
    tool_calls_used: list[str] = []
    tool_results: list[dict[str, Any]] = []
    # Binding replaces the request tool list, so carry hosted web search along
    # with Atlas function tools for this Responses API call.
    bound_model = model.bind_tools([*tools, {"type": "web_search"}]) if hasattr(model, "bind_tools") else model
    answer = ""
    final_response: Any = None
    status, partial = "success", False
    try:
        async with asyncio.timeout(CHAT_TIMEOUT):
            for _ in range(MAX_AGENT_STEPS):
                response = await bound_model.ainvoke(prompt)
                final_response = response
                calls = list(getattr(response, "tool_calls", None) or [])
                if not calls:
                    answer = _content_to_text(getattr(response, "content", response))
                    break
                prompt.append(response)
                for call in calls:
                    name = str(call.get("name") or "")
                    call_id = str(call.get("id") or uuid.uuid4())
                    tool_calls_used.append(name)
                    selected = tools_by_name.get(name)
                    if not selected:
                        result: dict[str, Any] = {"error": f"Unsupported tool: {name}"}
                    else:
                        try:
                            result = await selected.ainvoke(call.get("args") or {})
                        except Exception as error:
                            result = {"error": f"{name} failed: {type(error).__name__}"}
                    tool_results.append({"name": name, "result": result})
                    prompt.append(ToolMessage(content=json.dumps(result, ensure_ascii=False), tool_call_id=call_id))
            else:
                answer = "I could not complete that Atlas request safely. Please try a narrower request."
    except TimeoutError:
        answer, status, partial = "The response timed out. Please try again.", "timeout", True
    except Exception as error:
        answer, status, partial = f"Sorry, I couldn't answer that right now: {error}", "error", True
    answer = answer or "I don't have a response for that yet."
    session.chat_presentation = state["presentation"]
    session.add_message("assistant", answer, tool_calls=tool_calls_used or None, tool_results=tool_results or None)
    try:
        await conversation_manager.save_conversation(session.session_id)
    except Exception as error:
        print(f"[Chat] Failed to persist conversation: {error}")
    metadata = getattr(final_response, "response_metadata", {}) if final_response else {}
    usage = metadata.get("token_usage") or metadata.get("usage") or {}
    return {
        "session_id": session.session_id, "conversation_id": session.conversation_id, "response": answer, "locations": session.locations,
        "route": session.route, "tool_calls_used": tool_calls_used, "tool_results": tool_results,
        "status": status, "partial": partial, "pending_action": state["pending_action"],
        "presentation": state["presentation"], "place_cards": [],
        "metrics": {
            "latency_ms": round((time.perf_counter() - started_at) * 1000),
            "tool_call_count": len(tool_calls_used),
            "input_tokens": usage.get("input_tokens") or usage.get("prompt_tokens"),
            "output_tokens": usage.get("output_tokens") or usage.get("completion_tokens"),
        },
    }


async def run_chat(session_id: str, user_message: str) -> dict:
    session = conversation_manager.get_session(session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")
    return await _run_agent(session, user_message)


async def stream_chat(session_id: str, user_message: str) -> AsyncIterator[dict]:
    session = conversation_manager.get_session(session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")
    model_name = os.environ.get("OPENAI_MODEL_MANGO") or os.environ.get("OPENAI_MODEL", DEFAULT_CHAT_MODEL)
    model = get_chat_model(CHAT_PROVIDER, model_name, temperature=0.3)
    # Keep the old streaming contract for lightweight test doubles and any
    # provider that only implements native text streaming.
    if not hasattr(model, "ainvoke"):
        if not session.messages and session.title in ("", "Atlas AI chat"):
            session.title = user_message.strip()[:100]
        session.add_message("user", user_message)
        parts: list[str] = []
        prompt = [SystemMessage(content=_system_prompt(session)), *_history_messages(session)]
        async for chunk in model.astream(prompt):
            delta = _chunk_to_text(chunk)
            if delta:
                parts.append(delta)
                yield {"type": "token", "delta": delta}
        answer = "".join(parts).strip() or "I don't have a response for that yet."
        session.add_message("assistant", answer)
        try:
            await conversation_manager.save_conversation(session.session_id)
        except Exception:
            pass
        yield {
            "type": "complete", "session_id": session.session_id, "conversation_id": session.conversation_id, "response": answer,
            "locations": session.locations, "route": session.route, "tool_calls_used": [],
            "tool_results": [], "status": "success", "partial": False, "pending_action": None,
            "presentation": None, "place_cards": [], "metrics": {"latency_ms": 0, "tool_call_count": 0},
        }
        return
    result = await _run_agent(session, user_message)
    answer = result["response"]
    for index in range(0, len(answer), 36):
        yield {"type": "token", "delta": answer[index:index + 36]}
    yield {"type": "complete", **result}
