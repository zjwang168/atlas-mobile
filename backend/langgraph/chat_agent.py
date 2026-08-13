"""Conversational Atlas agent with bounded, confirmation-first tool calling."""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
import time
import uuid
from collections.abc import Awaitable, Callable
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
CONSTRAINED_PLACE_MAX_CANDIDATES = 5
CONSTRAINED_PLACE_MAX_RESOLUTION_DISTANCE_KM = 50
SIMILAR_LOCAL_RADIUS_KM = 50
SIMILAR_PLACE_MAX_CANDIDATES = 5
ATLAS_TRANSPORT_MODES = {
    "walk", "bike", "drive", "taxi", "bus", "coach", "subway", "train", "ferry", "flight",
}
_ACTION_MARKER_RE = re.compile(r"\[\[(?:PLACE_ACTION_CARD|CONFIRM_ADD_PLACES):[\s\S]*?\]\]")
_PRECISE_CONSTRAINT_RE = re.compile(
    r"\b(?:rating|rated|review|reviews|price|cheap|expensive|menu|vegan|vegetarian|"
    r"gluten[- ]free|breakfast|brunch|open now|takeaway|takeout|on my way|on the way|"
    r"along (?:my |the )?route|commute)\b",
    re.IGNORECASE,
)
_PRECISE_CONSTRAINT_CJK_TERMS = (
    "评分", "评价", "价格", "菜单", "素食", "纯素", "早餐", "早午餐", "外带", "打包", "顺路", "通勤", "路上",
)

# These labels intentionally describe only Atlas operations. They must never
# include model reasoning, tool inputs, search queries, or tool output.
_AGENT_STATUS_LABELS = {
    "resolve_special_place": "Locating the address",
    "propose_special_place_change": "Preparing the location update",
    "find_places_between_special_places": "Finding places along the route",
    "find_nearby_places": "Searching nearby places",
    "find_verified_places": "Checking live venue details",
    "find_similar_places": "Finding comparable places",
    "present_response_places": "Pinning places on the map",
    "extract_pasted_places": "Extracting places from your text",
    "research_screen_locations": "Researching locations",
    "propose_add_places": "Preparing places to save",
    "propose_create_atlas": "Preparing your Atlas",
    "web_search": "Researching current information",
}


async def _emit_agent_status(
    on_status: Callable[[str], Awaitable[None]] | None,
    label: str,
) -> None:
    if not on_status:
        return
    try:
        await on_status(label)
    except Exception:
        # Progress display must never affect an otherwise valid chat request.
        pass


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
    actions = getattr(session, "pending_chat_actions", []) or []
    action = next((item for item in reversed(actions) if item.get("kind") == "create_atlas"), None)
    action = action or getattr(session, "pending_chat_action", None)
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


def _pending_special_place_context(session: Any) -> str:
    actions = getattr(session, "pending_chat_actions", []) or []
    action = next((
        item for item in reversed(actions)
        if item.get("kind") in {"save_special_place", "delete_special_place"}
    ), None)
    action = action or getattr(session, "pending_chat_action", None)
    if not isinstance(action, dict) or action.get("kind") not in {"save_special_place", "delete_special_place"}:
        return "No Home, Office, or School confirmation is waiting."
    role = str(action.get("special_role") or "place").title()
    place = (action.get("places") or [{}])[0]
    address = str(place.get("full_address") or "").strip()
    return f"{role} confirmation is waiting for {address or place.get('name') or role}."


def _is_special_place_confirmation_ack(message: str, action: Any) -> bool:
    """Keep a pending special-place decision out of a new model turn."""
    if not isinstance(action, dict) or action.get("kind") not in {"save_special_place", "delete_special_place"}:
        return False
    normalized = re.sub(r"[\s.!?，。！？]+", "", str(message or "").casefold())
    return normalized in {"yes", "yeah", "yep", "ok", "okay", "sure", "好的", "好", "确认", "是"}


def _special_places_context(session: Any) -> str:
    places = getattr(session, "special_places", []) or []
    valid = [place for place in places if isinstance(place, dict) and place.get("role") in {"home", "office", "school"}]
    if not valid:
        return "No saved Home, Office, or School locations."
    return "\n".join(
        f"{str(place['role']).title()}: {place.get('name') or place.get('full_address') or 'Saved place'} "
        f"({float(place['longitude']):.6f}, {float(place['latitude']):.6f})"
        for place in valid
        if place.get("longitude") is not None and place.get("latitude") is not None
    ) or "No saved Home, Office, or School locations."


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
  When the user says "near my Home/Office/School" or "near home/office/school",
  pass anchor_role="home", "office", or "school" respectively. Those requests
  search around the saved special-place coordinate, never around device GPS.
  When the user names a place that is not one of their saved Home, Office, or
  School locations (for example, "closest car wash to Stanford University"),
  pass that exact place name as anchor_query so the search is centered on it,
  not on the device GPS.
- For a place request with rating, price, menu, dietary, availability, or
  route/commute constraints, call find_verified_places instead. It uses live
  web research to find named venues and Mapbox only to resolve those venues to
  map points. Never pass the whole descriptive phrase to Mapbox or claim that
  an unverified constraint is true.
- For "places similar to X" requests, call find_similar_places. Do not use
  saved places to identify X. First classify X: restaurants, cafes, bars,
  shops, and other local venues use reference_kind="local_venue" and default
  to 50 km from the current device location. Museums,
  landmarks, architecture, natural attractions, and other destination places
  use reference_kind="destination" and default to global results. When the
  user explicitly gives a city/region, pass it as area. When they explicitly
  ask for worldwide results, pass scope="global". If X is ambiguous, ask a
  concise clarification instead of guessing its category or scope.
- Whenever your final answer names or recommends one or more specific real
  POIs, venues, attractions, or landmarks, call present_response_places first
  with those exact place names (and a city/area when useful). It resolves only
  real map points and creates the ordinary selectable map card below the
  response. Do not use it for cities, countries, neighborhoods, generic place
  categories, or answers without a specific mappable POI. If another place
  finder has already produced the points for this response, keep its map
  presentation instead of calling present_response_places again. Never name a
  specific place in the final answer unless it came from a successful place
  tool result.
- For pasted notes or an itinerary that the user wants added, call
  extract_pasted_places, then propose_add_places. This is only a proposal.
- For requests for film, television, or music-video filming locations, sets,
  or locations associated with a named work, call research_screen_locations.
  It uses the Paste Text live-research and geocoding pipeline, then produces
  one Atlas confirmation proposal itself. Do not call propose_create_atlas
  again after it.
- Treat every request to make, build, plan, prepare, or design a multi-stop
  trip, travel plan, itinerary, route, or travel guide as a request to create
  an Atlas, even when the user does not say "Atlas". This includes Chinese
  requests such as "做一个...行程", "帮我规划...旅游攻略", or "...三日游".
  Find or extract real, geocoded places first, then call
  propose_create_atlas with the complete ordered itinerary. Do not answer
  with a plain-text itinerary or use propose_add_places for these requests.
  This is only a proposal; keep the final natural-language answer concise and
  let the Atlas draft card provide the create/cancel confirmation.
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
- Home, Office, and School are sensitive system places. Treat their values in
  the Saved special places section as trusted. For a request involving one of
  those roles, use it directly when available. If it is missing, ask the user
  for an address, place name, or map point; never guess it. When they provide
  a candidate, call resolve_special_place, then propose_special_place_change.
  That proposal is required for every create, replacement, and deletion. Never
  persist, replace, or delete a special place directly.
- When the current user turn explicitly gives an address, place name, or map
  point for their Home, Office/Company, or School and that role is not in
  Saved special places, always call resolve_special_place followed by
  propose_special_place_change. This must produce the existing confirmation
  note with cancel and save controls, even when you also answer another
  request in the same turn. Do not ask whether to save it in plain text.
- If a route or road-trip request was waiting for a missing Home, Office, or
  School and the current turn supplies that location, complete the original
  request in this same turn. Resolve and propose the special place, then find
  real, geocoded stops and call propose_create_atlas. Return both confirmation
  proposals; do not require a save or a repeated planning request first.
- If a Home, Office, or School confirmation is already waiting, a message such
  as "yes", "okay", or "好的" does not create a new location and does not
  confirm it. Tell the user to use the visible Save or Cancel control, and do
  not call resolve_special_place or propose_special_place_change again.
- For a route recommendation phrased as "from my place" / "from where I am"
  to Office/Company, School, or Home, treat the origin as the current device
  location. If Office/Company is missing, ask only for the Office/Company location. Do not also ask for
  Home or a separate origin. For a route recommendation "from my place" back
  Home, ask only for Home when it is missing. If School is missing, ask only
  for School. In all cases, ask only for the missing special place named as
  the destination; do not request every special place before answering.
- For a route recommendation phrased as "from Home", "from Office", or
  "from School" to a named landmark, venue, city, or other concrete POI,
  treat the saved role as the origin. Do not ask for that role again when it
  exists in Saved special places. Resolve the named destination, find real
  stops along the route, and propose the complete ordered Atlas. Only ask for
  an address when the explicitly named origin role is actually absent.
- For a dining or activity request "between" two saved special places with no
  live constraint, call find_places_between_special_places. For rating, price,
  menu, dietary, availability, or commute constraints, call
  find_verified_places first. It must state that route fit remains unverified
  until the origin and destination are explicitly supplied to the tool.
- When the current user turn includes an image, inspect the visible scene and
  text (including OCR clues). Convert those observations into a concrete POI
  or venue query, then call find_nearby_places to produce the map result.
  If the image names a venue or landmark, resolve it with a map search tool
  before presenting it. The image may suggest a category or query, but never
  proves unobservable facts such as ratings, opening hours, availability, or
  an exact location. Never invent a venue, address, or coordinate; map cards
  must come from a tool result.

{title_line}{location_line}

Explicit places attached to this chat:
{_location_context(session)}

Pending Atlas draft:
{_pending_atlas_context(session)}

Saved special places:
{_special_places_context(session)}

Pending special-place confirmation:
{_pending_special_place_context(session)}"""


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
    skipped = (
        f" I left {len(deselected_names)} unselected place{'s' if len(deselected_names) != 1 else ''} out of this chat."
        if deselected_names else ""
    )
    return (
        f"Hi! Great picks - your {count} saved place{'s' if count != 1 else ''} are on the map below.{skipped}\n\n"
        "We can shape a route, group nearby stops, or find a great next place."
    )


async def generate_import_welcome(session_id: str, deselected_locations: list[dict[str, Any]] | None = None, welcome_text: str | None = None) -> dict[str, Any]:
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
    answer = (welcome_text or '').strip()[:1200] or _import_welcome_fallback(session, deselected_names)
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


def _explicit_save_place_names(message: str) -> list[str]:
    """Parse an unambiguous `Save these places: A, B, and C` command.

    Short, named lists should not go through the pasted-text extraction model:
    it is designed for prose and can reject a perfectly valid list of POIs.
    """
    match = re.match(r"^\s*(?:please\s+)?(?:save|add)\s+(?:these\s+)?(?:places?\s*:\s*)?(.+?)\s*$", message, re.IGNORECASE)
    if not match:
        return []
    source = re.sub(r"^(?:these\s+)?\d+\s+places?\s*:\s*", "", match.group(1), flags=re.IGNORECASE)
    source = re.sub(r"\s+(?:and|&)\s+", ",", source, flags=re.IGNORECASE)
    names = []
    for value in source.split(","):
        name = " ".join(value.split()).strip(" .")
        if name and len(name) <= 200 and name.casefold() not in {item.casefold() for item in names}:
            names.append(name)
    return names[:8]


def _explicit_atlas_place_names(message: str) -> list[str]:
    """Parse an unambiguous `Create an atlas for A, B, and C` command."""
    match = re.match(
        r"^\s*(?:please\s+)?(?:create|make|build)\s+(?:an?\s+)?atlas\s+(?:for\s+)?(?:these\s+)?(.+?)\s*$",
        message,
        re.IGNORECASE,
    )
    if not match:
        return []
    return _explicit_save_place_names(f"Save places: {match.group(1)}")


async def _resolve_explicit_place_names(names: list[str]) -> list[dict[str, Any]]:
    """Resolve each requested POI independently, preferring a literal match."""
    from backend.services import place_search_service

    async def resolve_one(name: str) -> dict[str, Any] | None:
        token = str(uuid.uuid4())
        try:
            suggestions = await place_search_service.suggest(name, token, limit=5)
            retrieved = await asyncio.gather(*(
                place_search_service.retrieve(item["external_id"], token)
                for item in suggestions[:5]
            ), return_exceptions=True)
        except Exception:
            return None
        candidates = _dedupe_places([
            place for group in retrieved if isinstance(group, list) for place in group
        ], limit=8)
        if not candidates:
            return None
        candidates.sort(key=lambda place: _special_place_match_score(name, [
            place.get("name", ""), place.get("full_address", ""),
        ]), reverse=True)
        return candidates[0]

    resolved = await asyncio.gather(*(resolve_one(name) for name in names))
    return _dedupe_places([place for place in resolved if place], limit=len(names))


_SPECIAL_PLACE_AREA_TERMS = (
    "chinatown", "neighborhood", "district", "downtown", "uptown", "midtown",
    "old town", "city center", "中国城", "市中心", "城区", "街区",
)


def _special_place_query_variants(query: str) -> list[str]:
    """Return a few literal query variants for Mapbox label matching.

    This is deliberately a very small location-name alias table, not a model
    translation step. It lets a Chinese user-provided neighborhood match the
    English labels commonly returned by Mapbox without weakening matching for
    unrelated POIs.
    """
    clean = " ".join(str(query or "").split()).strip()
    if not clean:
        return []
    aliases = (
        ("旧金山中国城", "San Francisco Chinatown"),
        ("旧金山", "San Francisco"),
        ("中国城", "Chinatown"),
    )
    translated = clean
    for source, target in aliases:
        translated = translated.replace(source, target)
    return list(dict.fromkeys([clean, translated]))


def _special_place_tokens(value: str) -> set[str]:
    return {
        token for token in re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]+", value.casefold())
        if len(token) > 1
    }


def _is_special_place_area_query(query: str) -> bool:
    text = query.casefold()
    return any(term in text for term in _SPECIAL_PLACE_AREA_TERMS)


def _special_place_name_match_score(query: str, name: str) -> int:
    """Score a literal place-name match independently from its address.

    A city name is commonly present in the address of every nearby business.
    Address-only matching therefore must never turn a city or neighborhood
    supplied as Home, Office, or School into an arbitrary POI. Geocoded
    address features are included because Search Box represents some city
    centers that way; business categories are deliberately excluded.
    """
    normalized_name = " ".join(str(name or "").casefold().split())
    best = 0
    for variant in _special_place_query_variants(query):
        normalized = " ".join(variant.casefold().split())
        if normalized and normalized == normalized_name:
            best = max(best, 20_000 + len(normalized))
        elif normalized and normalized in normalized_name:
            best = max(best, 10_000 + len(normalized))
    return best


def _looks_like_street_address(query: str) -> bool:
    """Whether an address-only Search Box match is safe to consider."""
    text = query.casefold()
    return bool(re.search(
        r"\d|\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|suite|ste)\b",
        text,
    ))


def _is_geographic_feature(place: dict[str, Any], raw: dict[str, Any]) -> bool:
    """Allow bare city/area queries only for geographic, non-business features."""
    category = " ".join(str(value or "") for value in (
        place.get("category"), raw.get("feature_type"), raw.get("place_type"),
    )).casefold()
    return any(term in category for term in (
        "place", "city", "locality", "municipality", "region", "district",
        "neighborhood", "town", "village", "county", "address",
    ))


def _special_place_match_score(query: str, values: list[str]) -> int:
    """Score an exact user-place match without accepting nearby businesses."""
    haystack = " ".join(str(value or "") for value in values).casefold()
    best = 0
    for variant in _special_place_query_variants(query):
        normalized = " ".join(variant.casefold().split())
        if normalized and normalized in haystack:
            best = max(best, 10_000 + len(normalized))
            continue
        tokens = _special_place_tokens(variant)
        if tokens and tokens.issubset(_special_place_tokens(haystack)):
            best = max(best, len(tokens))
    return best


def _same_special_place(expected: dict[str, Any], proposed: dict[str, Any]) -> bool:
    """Require a proposal to use the actual point produced by the resolver."""
    try:
        return (
            abs(float(expected["latitude"]) - float(proposed["latitude"])) < 0.0002
            and abs(float(expected["longitude"]) - float(proposed["longitude"])) < 0.0002
        )
    except (KeyError, TypeError, ValueError):
        return False


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


def _nearby_special_place_role(text: str) -> str | None:
    """Identify a Home/Office/School-centered nearby request."""
    normalized = str(text or "").casefold()
    patterns = (
        ("home", r"\b(?:near|nearby|around|by) (?:my )?home\b|(?:我)?家(?:附近|周边|旁边)"),
        ("office", r"\b(?:near|nearby|around|by) (?:my )?(?:office|company|work)\b|(?:我)?(?:公司|办公室|单位)(?:附近|周边|旁边)"),
        ("school", r"\b(?:near|nearby|around|by) (?:my )?(?:school|campus|university)\b|(?:我)?(?:学校|校园|大学)(?:附近|周边|旁边)"),
    )
    return next((role for role, pattern in patterns if re.search(pattern, normalized)), None)


def _nearby_named_anchor_query(text: str) -> str | None:
    """Extract an explicit landmark from common nearby-search phrasing.

    This is a guardrail for tool calls where the model recognized the POI
    category but omitted `anchor_query`; saved special-place anchors continue
    to take precedence.
    """
    source = " ".join(str(text or "").split()).strip()
    patterns = (
        r"(?:离|距离)\s*(.+?)\s*(?:最近|附近|周边|旁边)\s*(?:的)?",
        r"(?:near|nearby|closest to|closest)\s+(.+?)(?:[，,。.!?]|$)",
    )
    for pattern in patterns:
        match = re.search(pattern, source, re.IGNORECASE)
        if not match:
            continue
        candidate = match.group(1).strip(" ，,。.!?")
        if candidate and len(candidate) <= 160:
            return candidate
    return None


def _special_place_anchor(session: Any, role: str | None) -> dict[str, Any] | None:
    """Read a valid saved special-place coordinate for local search."""
    if role not in {"home", "office", "school"}:
        return None
    place = next((
        item for item in (getattr(session, "special_places", []) or [])
        if isinstance(item, dict) and str(item.get("role") or "").lower() == role
    ), None)
    if not place:
        return None
    try:
        longitude, latitude = float(place["longitude"]), float(place["latitude"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
        return None
    return {
        "role": role,
        "name": str(place.get("name") or role.title()),
        "longitude": longitude,
        "latitude": latitude,
        "full_address": place.get("full_address"),
    }


def _parse_json_object(value: str) -> dict[str, Any]:
    """Parse a model JSON object even when it wrapped the object in prose."""
    text = (value or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            return {}
        try:
            parsed = json.loads(text[start:end + 1])
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}


def _requires_live_verification(requirements: str) -> bool:
    """Keep simple nearby POI requests on Mapbox; verify constrained ones live."""
    text = requirements or ""
    return bool(_PRECISE_CONSTRAINT_RE.search(text) or any(term in text for term in _PRECISE_CONSTRAINT_CJK_TERMS))


async def _research_precise_places(
    requirements: str,
    area: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    """Use OpenAI web search to turn ambiguous constraints into named venues."""
    model_name = os.environ.get("OPENAI_MODEL_MANGO") or os.environ.get("OPENAI_MODEL", DEFAULT_CHAT_MODEL)
    model = get_chat_model(CHAT_PROVIDER, model_name, temperature=0.0)
    area_line = f"Search area: {area}." if area else "Search area: use the user's stated area only; do not invent one."
    prompt = f"""You are a local-place researcher. Use live web search before answering.

Find real venues that satisfy the user's exact constraints. Do not rely on model memory.
{area_line}
User request: {requirements}

Return ONLY JSON with this schema:
{{"candidates":[{{"name":"venue name","address":"specific address or neighborhood","why":"short evidence-based reason","rating":"rating only if a source states it","price":"price only if a source states it","menu_evidence":"specific menu/item evidence if requested","source_urls":["https://..."]}}],"unverified_constraints":["constraint that could not be verified"]}}

Rules:
- Include at most {limit} candidates.
- Never invent ratings, prices, menu items, hours, dietary suitability, or route detours.
- A candidate without a specific venue name and at least one source URL must be omitted.
- If the request says "on my route" but no origin and destination are supplied, list it in unverified_constraints.
"""
    response = await model.ainvoke([SystemMessage(content=prompt)])
    payload = _parse_json_object(_content_to_text(getattr(response, "content", response)))
    raw_candidates = payload.get("candidates") if isinstance(payload.get("candidates"), list) else []
    candidates: list[dict[str, Any]] = []
    for raw in raw_candidates[:limit]:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        urls = [str(url).strip() for url in raw.get("source_urls") or [] if str(url).strip().startswith(("http://", "https://"))]
        if not name or not urls:
            continue
        candidates.append({
            "name": name[:200],
            "address": str(raw.get("address") or "").strip()[:300],
            "why": str(raw.get("why") or "").strip()[:500],
            "rating": str(raw.get("rating") or "").strip()[:80],
            "price": str(raw.get("price") or "").strip()[:80],
            "menu_evidence": str(raw.get("menu_evidence") or "").strip()[:250],
            "source_urls": urls[:3],
        })
    return candidates


async def _mapbox_resolve_researched_place(
    candidate: dict[str, Any],
    origin: tuple[float, float] | None,
) -> dict[str, Any] | None:
    """Map a web-verified venue name to one concrete Mapbox POI."""
    from backend.services import place_search_service

    session_token = str(uuid.uuid4())
    query = " ".join(part for part in [candidate.get("name"), candidate.get("address")] if part).strip()
    try:
        suggestions = await place_search_service.suggest(
            query=query,
            session_token=session_token,
            proximity=f"{origin[0]},{origin[1]}" if origin else None,
            limit=5,
        )
        retrieved = await asyncio.gather(*[
            place_search_service.retrieve(item["external_id"], session_token)
            for item in suggestions[:5]
        ], return_exceptions=True)
    except Exception:
        return None

    normalized_name = re.sub(r"[^a-z0-9]+", " ", str(candidate["name"]).casefold()).strip()
    name_terms = set(normalized_name.split())
    matches = [place for group in retrieved if isinstance(group, list) for place in group]
    matches = [place for place in matches if _normalize_place(place)]
    if not matches:
        return None
    matches.sort(key=lambda place: len(name_terms & set(re.sub(r"[^a-z0-9]+", " ", str(place.get("name") or "").casefold()).split())), reverse=True)
    place = _normalize_place(matches[0])
    if not place:
        return None
    evidence = "; ".join(part for part in [candidate.get("why"), candidate.get("rating"), candidate.get("price"), candidate.get("menu_evidence")] if part)
    place["description"] = evidence[:700] or place.get("description")
    place["verification_sources"] = candidate["source_urls"]
    place["requested_category"] = "live-verified"
    return place


async def _research_similar_places(
    reference_place: str,
    reference_kind: str,
    area: str | None,
    scope: str,
    limit: int,
) -> list[dict[str, Any]]:
    """Research named analogues before resolving them to map points."""
    model_name = os.environ.get("OPENAI_MODEL_MANGO") or os.environ.get("OPENAI_MODEL", DEFAULT_CHAT_MODEL)
    model = get_chat_model(CHAT_PROVIDER, model_name, temperature=0.0)
    area_line = f"Limit candidates to {area}." if area else "Do not infer a city or region."
    scope_line = (
        "Search worldwide."
        if scope == "global"
        else f"Search only in {area}." if scope == "area" and area
        else f"Search locally around the user's current location; {area_line}"
    )
    prompt = f"""You are a place researcher. Use live web search before answering.

Find real places comparable to the reference place, based on their type,
experience, cultural role, or cuisine. Do not use a user's saved places.
Reference place: {reference_place}
Reference type: {reference_kind}
{scope_line}

Return ONLY JSON with this schema:
{{"candidates":[{{"name":"venue name","address":"specific address or city","why":"short comparison","source_urls":["https://..."]}}]}}

Rules:
- Return at most {limit} candidates.
- Every candidate needs a specific name and at least one source URL.
- Do not invent venues, locations, or source URLs.
"""
    response = await model.ainvoke([SystemMessage(content=prompt)])
    payload = _parse_json_object(_content_to_text(getattr(response, "content", response)))
    raw_candidates = payload.get("candidates") if isinstance(payload.get("candidates"), list) else []
    candidates: list[dict[str, Any]] = []
    for raw in raw_candidates[:limit]:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        urls = [str(url).strip() for url in raw.get("source_urls") or [] if str(url).strip().startswith(("http://", "https://"))]
        if not name or not urls:
            continue
        candidates.append({
            "name": name[:200],
            "address": str(raw.get("address") or "").strip()[:300],
            "why": str(raw.get("why") or "").strip()[:500],
            "source_urls": urls[:3],
        })
    return candidates


def _commute_anchors(session: Any) -> tuple[dict[str, Any], dict[str, Any]] | None:
    roles = {
        str(item.get("role") or "").lower(): item
        for item in (getattr(session, "special_places", []) or [])
        if isinstance(item, dict)
    }
    home, office = roles.get("home"), roles.get("office")
    if not home or not office:
        return None
    try:
        float(home["longitude"]), float(home["latitude"]), float(office["longitude"]), float(office["latitude"])
    except (KeyError, TypeError, ValueError):
        return None
    return home, office


def _commute_anchors_for_requirements(
    session: Any,
    requirements: str,
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """Resolve a commute's two anchors without turning "my place" into Home."""
    text = requirements.casefold()
    roles = {
        str(item.get("role") or "").lower(): item
        for item in (getattr(session, "special_places", []) or [])
        if isinstance(item, dict)
    }
    current = getattr(session, "user_location", None)
    current_place = None
    if current and len(current) == 2:
        try:
            current_place = {
                "role": "current_location", "name": "Current location",
                "longitude": float(current[0]), "latitude": float(current[1]),
            }
        except (TypeError, ValueError):
            pass

    from_my_place = bool(re.search(r"\bfrom (?:my place|where i am|my location)\b|从我的地方(?:出发)?|从我这(?:里|儿)?出发|从当前位置出发", text))
    to_office = bool(re.search(r"\b(?:to|toward|going to) (?:my )?(?:office|company|work)\b|(?:去|到)(?:我的)?(?:公司|办公室|单位)", text))
    to_home = bool(re.search(r"\b(?:to|back to|going home) (?:my )?home\b|回(?:我的)?家", text))
    to_school = bool(re.search(r"\b(?:to|toward|going to) (?:my )?(?:school|campus|university)\b|(?:去|到)(?:我的)?(?:学校|校园|大学)", text))
    if from_my_place and current_place and to_office:
        office = roles.get("office")
        return (current_place, office) if office else None
    if from_my_place and current_place and to_home:
        home = roles.get("home")
        return (current_place, home) if home else None
    if from_my_place and current_place and to_school:
        school = roles.get("school")
        return (current_place, school) if school else None
    return _commute_anchors(session)


def _current_location_commute_role(requirements: str) -> str | None:
    """Return the explicitly requested destination role for a GPS-origin commute."""
    text = requirements.casefold()
    from_current = bool(re.search(
        r"\bfrom (?:my place|where i am|my location)\b|从我的地方(?:出发)?|从我这(?:里|儿)?出发|从当前位置出发",
        text,
    ))
    if not from_current:
        return None
    role_patterns = (
        ("office", r"\b(?:to|toward|going to) (?:my )?(?:office|company|work)\b|(?:去|到)(?:我的)?(?:公司|办公室|单位)"),
        ("home", r"\b(?:to|back to|going home) (?:my )?home\b|回(?:我的)?家"),
        ("school", r"\b(?:to|toward|going to) (?:my )?(?:school|campus|university)\b|(?:去|到)(?:我的)?(?:学校|校园|大学)"),
    )
    return next((role for role, pattern in role_patterns if re.search(pattern, text)), None)


async def _finalize_commute_presentation(session: Any, state: dict[str, Any]) -> None:
    """Make commute map output independent of the model's tool-call order."""
    presentation = state.get("presentation")
    if not isinstance(presentation, dict) or not isinstance(presentation.get("places"), list):
        return
    recent_user_messages = [
        str(item.get("content") or "")
        for item in (getattr(session, "messages", []) or [])[-8:]
        if isinstance(item, dict) and item.get("role") == "user"
    ]
    destination: dict[str, Any] | None = None
    actions = state.get("pending_actions") or []
    action = state.get("pending_action")
    special_action = next((
        item for item in reversed(actions)
        if isinstance(item, dict) and item.get("kind") == "save_special_place"
    ), None)
    current_message = str(state.get("user_message") or "")
    action_role = (
        str(action.get("special_role") or "").lower()
        if isinstance(action, dict) and action.get("kind") == "save_special_place"
        else None
    )
    # A missing destination is commonly supplied one turn after the commute
    # request. Only that active confirmation may consult recent context;
    # ordinary later searches must not inherit stale commute intent.
    role = _current_location_commute_role(current_message)
    if not role and action_role:
        context = "\n".join([*recent_user_messages[-3:], current_message])
        contextual_role = _current_location_commute_role(context)
        role = action_role if contextual_role == action_role else None
    if not role:
        # Named-destination commute: a saved Home/Office/School is the route
        # origin, while Atlas places remain recommendations/destination. Keep
        # the origin as an anchor pin, never as a duplicate numbered stop.
        context = "\n".join([*recent_user_messages[-3:], current_message])
        named_origin = re.search(
            r"\bfrom (?:my )?(home|office|school|company|work)\b\s+to\s+(.+?)(?:,|\?|$)",
            context,
            re.IGNORECASE,
        )
        if named_origin:
            requested_role = {"company": "office", "work": "office"}.get(named_origin.group(1).casefold(), named_origin.group(1).casefold())
            origin = next((item for item in (getattr(session, "special_places", []) or []) if str(item.get("role") or "").casefold() == requested_role), None)
            places = [item for item in (presentation.get("places") or []) if isinstance(item, dict)]
            if origin and places:
                try:
                    origin_lng, origin_lat = float(origin["longitude"]), float(origin["latitude"])
                    origin_name = str(origin.get("name") or "").casefold()
                    places = [item for item in places if not (
                        str(item.get("name") or "").casefold() == origin_name
                        and abs(float(item["longitude"]) - origin_lng) < 0.002
                        and abs(float(item["latitude"]) - origin_lat) < 0.002
                    )]
                    coordinates = [(origin_lng, origin_lat)]
                    for item in places:
                        coordinates.append((float(item["longitude"]), float(item["latitude"])))
                except (KeyError, TypeError, ValueError):
                    coordinates = []
                if len(coordinates) >= 2:
                    presentation["places"] = places
                    presentation["special_places"] = [
                        *[item for item in (presentation.get("special_places") or []) if item.get("role") != requested_role],
                        {"role": requested_role, "name": origin.get("name") or requested_role.title(),
                         "longitude": origin_lng, "latitude": origin_lat, "full_address": origin.get("full_address")},
                    ]
                    presentation["commute_route"] = await _road_route(coordinates, profile="driving")
                    return
        # A road trip can start at a just-resolved Home and end at the last
        # Atlas stop. The Home proposal remains pending, but its exact map
        # point is safe to use for the preview route.
        context = "\n".join([*recent_user_messages[-3:], current_message]).casefold()
        home_origin_trip = bool(re.search(r"\bfrom (?:my )?home\b|从(?:我)?家(?:出发)?", context))
        proposed_home = special_action if isinstance(special_action, dict) and special_action.get("special_role") == "home" else None
        places = presentation.get("places") or []
        if not (home_origin_trip and proposed_home and places):
            return
        home = (proposed_home.get("places") or [{}])[0]
        destination = places[-1]
        try:
            home_lng, home_lat = float(home["longitude"]), float(home["latitude"])
            destination_lng, destination_lat = float(destination["longitude"]), float(destination["latitude"])
        except (KeyError, TypeError, ValueError):
            return
        presentation["special_places"] = [
            *[item for item in (presentation.get("special_places") or []) if item.get("role") != "home"],
            {"role": "home", "name": home.get("name") or "Home", "longitude": home_lng, "latitude": home_lat, "full_address": home.get("full_address")},
        ]
        presentation["commute_route"] = await _road_route([
            (home_lng, home_lat),
            (destination_lng, destination_lat),
        ], profile="driving")
        return

    if (
        isinstance(action, dict)
        and action.get("kind") == "save_special_place"
        and action.get("special_role") == role
        and isinstance(action.get("places"), list)
        and action["places"]
    ):
        proposed = action["places"][0]
        if isinstance(proposed, dict):
            destination = {
                "role": role,
                "name": proposed.get("name") or role.title(),
                "latitude": proposed.get("latitude"),
                "longitude": proposed.get("longitude"),
                "full_address": proposed.get("full_address") or proposed.get("description"),
            }
    if destination is None:
        destination = next((
            item for item in (getattr(session, "special_places", []) or [])
            if isinstance(item, dict) and str(item.get("role") or "").lower() == role
        ), None)
    current = getattr(session, "user_location", None)
    if not destination or not current or len(current) != 2:
        return
    try:
        origin_lng, origin_lat = float(current[0]), float(current[1])
        destination_lng = float(destination["longitude"])
        destination_lat = float(destination["latitude"])
    except (KeyError, TypeError, ValueError):
        return

    normalized_destination = {
        **destination,
        "role": role,
        "longitude": destination_lng,
        "latitude": destination_lat,
    }
    special_places = [
        item for item in (presentation.get("special_places") or [])
        if isinstance(item, dict) and item.get("role") != role
    ]
    presentation["special_places"] = [*special_places, normalized_destination]
    presentation["commute_destination"] = normalized_destination
    presentation["user_location"] = presentation.get("user_location") or {
        "longitude": origin_lng,
        "latitude": origin_lat,
    }
    if not (presentation.get("commute_route") or {}).get("route"):
        presentation["commute_route"] = await _road_route([
            (origin_lng, origin_lat),
            (destination_lng, destination_lat),
        ], profile="driving")


async def _rank_by_commute_detour(
    origin: dict[str, Any],
    destination: dict[str, Any],
    places: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Rank researched venues by real driving detour between saved anchors."""
    start = (float(origin["longitude"]), float(origin["latitude"]))
    finish = (float(destination["longitude"]), float(destination["latitude"]))
    direct = await _road_route([start, finish], profile="driving")
    if not direct or direct.get("duration_minutes") is None:
        return places, None

    async def with_detour(place: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
        route = await _road_route([start, (place["longitude"], place["latitude"]), finish], profile="driving")
        if route and route.get("duration_minutes") is not None:
            detour = max(0, int(round(route["duration_minutes"] - direct["duration_minutes"])))
            place["travel_duration_minutes"] = detour
            place["description"] = f"{place.get('description') or ''} Driving detour from Home to Office: about {detour} min.".strip()
        return place, route

    ranked = await asyncio.gather(*(with_detour(place) for place in places))
    ranked_places = [place for place, _ in ranked]
    ranked_places.sort(key=lambda place: place.get("travel_duration_minutes", 10**9))
    best_route = next((route for _, route in ranked if route), None)
    return ranked_places, best_route


async def _road_route(coordinates: list[tuple[float, float]], profile: str = "walking") -> dict[str, Any] | None:
    """Return a real Mapbox route for a supported travel profile."""
    if len(coordinates) < 2 or not os.getenv("MAPBOX_ACCESS_TOKEN", "").strip():
        return None
    if profile not in {"walking", "driving", "cycling"}:
        profile = "walking"
    coordinate_string = ";".join(f"{lng},{lat}" for lng, lat in coordinates[:25])
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            response = await client.get(
                f"https://api.mapbox.com/directions/v5/mapbox/{profile}/{coordinate_string}",
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
    def register_pending_action(action: dict[str, Any]) -> None:
        def replaces(existing: dict[str, Any]) -> bool:
            if action.get("kind") == "create_atlas":
                return existing.get("kind") == "create_atlas"
            return (
                action.get("kind") in {"save_special_place", "delete_special_place"}
                and existing.get("kind") in {"save_special_place", "delete_special_place"}
                and existing.get("special_role") == action.get("special_role")
            )

        state["pending_actions"] = [
            item for item in state.setdefault("pending_actions", [])
            if not replaces(item)
        ]
        state["pending_actions"].append(action)
        # Existing tool and persistence code still reads the most recent
        # action. The response additionally exposes the full list so a Home
        # save and an Atlas draft can be confirmed independently.
        session.pending_chat_action = action
        session.pending_chat_actions = [
            *[item for item in getattr(session, "pending_chat_actions", []) if not replaces(item)],
            action,
        ]
        state["pending_action"] = action

    @tool
    async def resolve_special_place(query: str, role: str) -> dict[str, Any]:
        """Resolve a user-supplied Home, Office, or School to that exact map point. Never writes data."""
        clean_role = str(role).strip().lower()
        if clean_role not in {"home", "office", "school"}:
            return {"error": "role must be home, office, or school."}
        clean_query = " ".join(str(query).split())[:500]
        if len(clean_query) < 3:
            return {"error": "A more specific address or place name is needed."}
        from backend.services import place_search_service
        token = str(uuid.uuid4())
        try:
            suggestions = await place_search_service.suggest(clean_query, token, limit=5)
            retrieved = await asyncio.gather(*(
                place_search_service.retrieve(item["external_id"], token)
                for item in suggestions[:5]
            ), return_exceptions=True)
        except Exception as error:
            return {"error": f"Could not resolve this place: {type(error).__name__}"}
        matches: list[tuple[int, int, dict[str, Any]]] = []
        for group in retrieved:
            if not isinstance(group, list):
                continue
            for raw in group:
                place = _normalize_place(raw)
                if not place:
                    continue
                score = _special_place_match_score(clean_query, [
                    place.get("name", ""), place.get("full_address", ""),
                    str(raw.get("city") or ""), str(raw.get("region") or ""), str(raw.get("country") or ""),
                ])
                name_score = _special_place_name_match_score(clean_query, str(place.get("name") or ""))
                # A named POI or street address can use Search Box's address
                # match. A bare city/area cannot: e.g. every San Jose business
                # has "San Jose" in its address, but none is the city itself.
                if (
                    name_score
                    or (score and _looks_like_street_address(clean_query))
                    or (score and _is_geographic_feature(place, raw))
                ):
                    matches.append((name_score, score, place))
        if matches:
            # Area names must resolve to the named area, not an arbitrary hotel,
            # cafe, or other POI whose address only happens to be nearby.
            if _is_special_place_area_query(clean_query):
                matches = [item for item in matches if _is_special_place_area_query(str(item[2].get("name") or ""))]
            if matches:
                matches.sort(key=lambda item: (item[0], item[1]), reverse=True)
                resolved = matches[0][2]
                state.setdefault("resolved_special_places", {})[clean_role] = resolved
                return {"role": clean_role, "place": resolved, "query": clean_query, "resolution": "mapbox"}

        # Search Box has strong POI coverage but cannot resolve every address
        # or neighborhood. Fall back to the app's address geocoder, which never
        # returns fabricated coordinates. Its result retains the literal user
        # query as the saveable name rather than substituting a nearby business.
        try:
            from backend.services.geocoder import geocode_address_first
            geocoded = await geocode_address_first(clean_query)
        except Exception as error:
            return {"error": f"Could not geocode this place: {type(error).__name__}"}
        if not geocoded:
            return {"error": "No exact matching place was found. Please provide a street address or map pin."}
        if not _special_place_match_score(clean_query, [str(geocoded.get("full_address") or "")]):
            return {"error": "The geocoding result did not match the place you provided. Please provide a street address or map pin."}
        fallback = _normalize_place({
            "name": clean_query,
            "latitude": geocoded.get("latitude"),
            "longitude": geocoded.get("longitude"),
            "full_address": geocoded.get("full_address") or clean_query,
            "category": "Address",
            "city": geocoded.get("city"),
            "region": geocoded.get("region"),
            "country": geocoded.get("country"),
            "source": geocoded.get("source") or "geocoder",
        })
        if not fallback:
            return {"error": "The geocoded location did not include a mappable coordinate."}
        state.setdefault("resolved_special_places", {})[clean_role] = fallback
        return {"role": clean_role, "place": fallback, "query": clean_query, "resolution": "geocoder"}

    @tool
    async def propose_special_place_change(
        role: str,
        operation: str,
        place: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Prepare a confirmation-only create, update, or delete of Home, Office, or School."""
        clean_role = str(role).strip().lower()
        clean_operation = str(operation).strip().lower()
        if clean_role not in {"home", "office", "school"} or clean_operation not in {"create", "update", "delete"}:
            return {"error": "role must be home, office, or school and operation must be create, update, or delete."}
        current = next((item for item in (getattr(session, "special_places", []) or []) if item.get("role") == clean_role), None)
        if clean_operation == "delete":
            if not current:
                return {"error": f"No saved {clean_role} exists to delete."}
            normalized = [{
                "name": current.get("name") or clean_role.title(),
                "latitude": current.get("latitude"), "longitude": current.get("longitude"),
                "full_address": current.get("full_address") or "",
            }]
        else:
            normalized = _dedupe_places([place or []], limit=1)
            if not normalized:
                return {"error": "A resolved, geocoded place is required."}
            resolved = state.get("resolved_special_places", {}).get(clean_role)
            if not resolved or not _same_special_place(resolved, normalized[0]):
                return {"error": "The proposed place must be the exact point returned by resolve_special_place."}
            clean_operation = "update" if current else "create"
        role_title = clean_role.title()
        action = {
            "action_id": str(uuid.uuid4()),
            "kind": "delete_special_place" if clean_operation == "delete" else "save_special_place",
            "title": f"{('Delete' if clean_operation == 'delete' else 'Save')} {role_title}",
            "places": normalized,
            "special_role": clean_role,
            "operation": clean_operation,
        }
        register_pending_action(action)
        special_places = [item for item in [current] if item] if clean_operation == "delete" else [{
            "role": clean_role, "name": normalized[0]["name"], "latitude": normalized[0]["latitude"],
            "longitude": normalized[0]["longitude"], "full_address": normalized[0].get("full_address"),
        }]
        # A special-place save may be proposed alongside a restaurant/map
        # response. Keep that response visible and attach this action's pin
        # instead of replacing the map with a single-address preview.
        existing_presentation = state.get("presentation")
        if isinstance(existing_presentation, dict) and isinstance(existing_presentation.get("places"), list):
            merged_special_places = [
                *[item for item in existing_presentation.get("special_places", []) if item.get("role") != clean_role],
                *special_places,
            ]
            commute_route = existing_presentation.get("commute_route")
            recent_user_messages = [
                str(item.get("content") or "")
                for item in (getattr(session, "messages", []) or [])[-6:]
                if isinstance(item, dict) and item.get("role") == "user"
            ]
            message = "\n".join([*recent_user_messages, str(state.get("user_message") or "")])
            current = getattr(session, "user_location", None)
            commute_destination = _commute_anchors_for_requirements(session, message)
            is_new_destination = clean_operation != "delete" and (
                commute_destination is None
                and current
                and len(current) == 2
                and re.search(r"\bfrom (?:my place|where i am|my location)\b|从我的地方(?:出发)?|从我这(?:里|儿)?出发|从当前位置出发", message.casefold())
                and (
                    (clean_role == "office" and re.search(r"\b(?:to|toward|going to) (?:my )?(?:office|company|work)\b|(?:去|到)(?:我的)?(?:公司|办公室|单位)", message.casefold()))
                    or (clean_role == "home" and re.search(r"\b(?:to|back to|going home) (?:my )?home\b|回(?:我的)?家", message.casefold()))
                    or (clean_role == "school" and re.search(r"\b(?:to|toward|going to) (?:my )?(?:school|campus|university)\b|(?:去|到)(?:我的)?(?:学校|校园|大学)", message.casefold()))
                )
            )
            if is_new_destination:
                commute_route = await _road_route([
                    (float(current[0]), float(current[1])),
                    (float(normalized[0]["longitude"]), float(normalized[0]["latitude"])),
                ], profile="driving")
            state["presentation"] = {
                **existing_presentation,
                "special_places": merged_special_places,
                "commute_route": commute_route,
                # Keep destination intent separate from the route result. The
                # mobile client can draw the destination and retry its route
                # if this request is delayed or temporarily unavailable.
                "commute_destination": special_places[0] if is_new_destination else existing_presentation.get("commute_destination"),
            }
        else:
            state["presentation"] = {
                "kind": "places_map", "title": action["title"], "places": normalized,
                "special_places": special_places, "route": None,
            }
        return {"proposal": action}

    @tool
    async def find_places_between_special_places(
        origin_role: str,
        destination_role: str,
        category: str = "restaurant",
        limit: int = 5,
    ) -> dict[str, Any]:
        """Find mappable places near the midpoint between two saved special places, without writing data."""
        roles = {str(item.get("role")).lower(): item for item in (getattr(session, "special_places", []) or []) if isinstance(item, dict)}
        origin = roles.get(str(origin_role).lower())
        destination = roles.get(str(destination_role).lower())
        if not origin or not destination:
            return {"error": "Both requested saved special places are required."}
        try:
            origin_lng, origin_lat = float(origin["longitude"]), float(origin["latitude"])
            destination_lng, destination_lat = float(destination["longitude"]), float(destination["latitude"])
        except (KeyError, TypeError, ValueError):
            return {"error": "A saved special place is missing valid coordinates."}
        midpoint_lng, midpoint_lat = (origin_lng + destination_lng) / 2, (origin_lat + destination_lat) / 2
        from backend.services import place_search_service
        token = str(uuid.uuid4())
        try:
            suggestions = await place_search_service.suggest(" ".join(category.split())[:120] or "restaurant", token, proximity=f"{midpoint_lng},{midpoint_lat}", limit=max(1, min(limit * 2, 10)))
            retrieved = await asyncio.gather(*(place_search_service.retrieve(item["external_id"], token) for item in suggestions))
        except Exception as error:
            return {"error": f"Could not search between these places: {type(error).__name__}"}
        places = _dedupe_places([place for result in retrieved for place in result], limit=max(1, min(limit, 8)))
        route = await _road_route([(origin_lng, origin_lat), (midpoint_lng, midpoint_lat), (destination_lng, destination_lat)])
        anchors = [
            {"role": str(origin_role).lower(), "name": origin.get("name") or str(origin_role).title(), "latitude": origin_lat, "longitude": origin_lng, "full_address": origin.get("full_address")},
            {"role": str(destination_role).lower(), "name": destination.get("name") or str(destination_role).title(), "latitude": destination_lat, "longitude": destination_lng, "full_address": destination.get("full_address")},
        ]
        state["presentation"] = {
            "kind": "places_map", "title": f"{category.title()} between {str(origin_role).title()} and {str(destination_role).title()}",
            "places": places, "special_places": anchors, "route": route,
        }
        return {"places": places, "special_places": anchors, "route": route}

    @tool
    async def find_nearby_places(
        categories: list[str] | None = None,
        query: str | None = None,
        limit_per_category: int | None = None,
        limit: int | None = None,
        radius_km: int | None = None,
        anchor_role: str | None = None,
        anchor_query: str | None = None,
    ) -> dict[str, Any]:
        """Find POIs near GPS, a named place, or a saved Home, Office, or School anchor."""
        current = getattr(session, "user_location", None)
        requested_anchor_role = str(anchor_role or "").strip().lower()
        user_message = str(state.get("user_message") or "")
        clean_anchor_query = " ".join(str(anchor_query or _nearby_named_anchor_query(user_message) or "").split()).strip(" .")[:160]
        inferred_anchor_role = _nearby_special_place_role(user_message)
        resolved_anchor_role = requested_anchor_role if requested_anchor_role in {"home", "office", "school"} else inferred_anchor_role
        anchor = _special_place_anchor(session, resolved_anchor_role)
        if resolved_anchor_role and not anchor:
            return {"error": f"Your saved {resolved_anchor_role.title()} location is unavailable."}
        if anchor:
            longitude, latitude = anchor["longitude"], anchor["latitude"]
        elif clean_anchor_query:
            from backend.services.geocoder import geocode
            resolved = await geocode(clean_anchor_query)
            if not resolved:
                return {"error": f"Could not locate {clean_anchor_query}."}
            try:
                longitude, latitude = float(resolved["longitude"]), float(resolved["latitude"])
            except (KeyError, TypeError, ValueError):
                return {"error": f"Could not locate {clean_anchor_query}."}
            anchor = {
                "role": "anchor",
                "name": str(resolved.get("name") or clean_anchor_query),
                "longitude": longitude,
                "latitude": latitude,
                "full_address": resolved.get("full_address"),
            }
        elif current and len(current) == 2:
            longitude, latitude = float(current[0]), float(current[1])
        else:
            return {"error": "Current device location is unavailable."}
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
            "kind": "nearby_map", "title": f"{_nearby_title(displayed_categories)} near {anchor['name']}" if anchor else _nearby_title(displayed_categories),
            "user_location": {"longitude": longitude, "latitude": latitude},
            "places": places,
            "special_places": [anchor] if anchor else [],
            "groups": [{"category": category, "places": category_places} for category, category_places in groups.items()],
            "route": route,
        }
        return {
            "categories": requested_categories,
            "groups": [{"category": category, "places": category_places} for category, category_places in groups.items()],
            "places": places,
            "route": route,
            "radius_km": search_radius_km,
            "anchor": anchor,
            "not_found_categories": not_found_categories,
        }

    @tool
    async def find_verified_places(
        requirements: str,
        area: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        """Research live ratings, prices, menus, dietary needs, or route constraints before mapping named venues."""
        if not _requires_live_verification(requirements):
            return {"error": "This request has no precise constraint requiring live verification."}
        candidate_limit = max(1, min(int(limit or 3), CONSTRAINED_PLACE_MAX_CANDIDATES))
        origin = getattr(session, "user_location", None)
        anchor = _special_place_anchor(session, _nearby_special_place_role(requirements))
        origin_tuple = (
            (anchor["longitude"], anchor["latitude"])
            if anchor else (float(origin[0]), float(origin[1])) if origin and len(origin) == 2 else None
        )
        research_area = area or (anchor.get("full_address") or anchor.get("name") if anchor else None)
        researched = await _research_precise_places(requirements, research_area, candidate_limit)
        resolved = await asyncio.gather(*[
            _mapbox_resolve_researched_place(candidate, origin_tuple)
            for candidate in researched
        ])
        places = [place for place in resolved if place]
        if origin_tuple:
            places = [
                place for place in places
                if _nearby_distance_km(origin_tuple, place) <= CONSTRAINED_PLACE_MAX_RESOLUTION_DISTANCE_KM
            ]
            places.sort(key=lambda place: _nearby_distance_km(origin_tuple, place))
        unverified: list[str] = []
        commute_requested = bool(re.search(r"\b(?:on my way|on the way|along (?:my |the )?route|commute)\b|顺路|通勤|路上", requirements, re.IGNORECASE))
        commute_route = None
        anchors: list[dict[str, Any]] = []
        if commute_requested:
            commute = _commute_anchors_for_requirements(session, requirements)
            if not commute:
                unverified.append("Route fit is not verified until the destination special place is saved or a destination is provided.")
            else:
                origin_anchor, destination_anchor = commute
                places, _ = await _rank_by_commute_detour(origin_anchor, destination_anchor, places)
                anchors = [{
                    "role": destination_anchor.get("role") or "destination",
                    "name": destination_anchor.get("name") or "Destination",
                    "longitude": destination_anchor["longitude"],
                    "latitude": destination_anchor["latitude"],
                    "full_address": destination_anchor.get("full_address"),
                }]
                commute_route = await _road_route([
                    (float(origin_anchor["longitude"]), float(origin_anchor["latitude"])),
                    (float(destination_anchor["longitude"]), float(destination_anchor["latitude"])),
                ], profile="driving")
        if not places:
            return {
                "places": [],
                "researched_candidates": researched,
                "unverified_constraints": unverified,
                "error": f"Live research found no venue that Mapbox could resolve within {CONSTRAINED_PLACE_MAX_RESOLUTION_DISTANCE_KM} km of the current location.",
            }
        route = await _road_route([(origin_tuple[0], origin_tuple[1]), (places[0]["longitude"], places[0]["latitude"])]) if origin_tuple else None
        session.locations = places
        session.route = route
        state["presentation"] = {
            "kind": "nearby_map",
            "title": f"Live-verified places near {anchor['name']}" if anchor else "Live-verified nearby places",
            "user_location": {"longitude": origin_tuple[0], "latitude": origin_tuple[1]} if origin_tuple else None,
            "places": places,
            "special_places": [anchor] if anchor else anchors,
            "commute_destination": anchors[0] if anchors else None,
            "route": route,
            "commute_route": commute_route,
        }
        return {
            "places": places,
            "researched_candidates": researched,
            "route": route,
            "commute_route": commute_route,
            "special_places": anchors,
            "unverified_constraints": unverified,
        }

    @tool
    async def find_similar_places(
        reference_place: str,
        reference_kind: str,
        area: str | None = None,
        scope: str = "auto",
        limit: int | None = None,
    ) -> dict[str, Any]:
        """Find real places similar to a named reference, enforcing local or global scope."""
        clean_reference = " ".join(str(reference_place or "").split())[:200]
        kind = str(reference_kind or "").strip().lower()
        requested_scope = str(scope or "auto").strip().lower()
        clean_area = " ".join(str(area or "").split())[:200] or None
        if not clean_reference:
            return {"error": "A named reference place is required."}
        if kind not in {"local_venue", "destination"}:
            return {"error": "reference_kind must be local_venue or destination."}
        if requested_scope not in {"auto", "local", "area", "global"}:
            return {"error": "scope must be auto, local, area, or global."}
        if requested_scope == "area" and not clean_area:
            return {"error": "An area is required when scope is area."}

        resolved_scope = (
            "area" if requested_scope == "auto" and clean_area
            else "local" if kind == "local_venue" and requested_scope == "auto"
            else "global" if requested_scope == "auto"
            else requested_scope
        )
        current = getattr(session, "user_location", None)
        origin = None
        if current and len(current) == 2:
            origin = (float(current[0]), float(current[1]))
        if resolved_scope == "local" and not origin:
            return {"error": "Current device location is required for similar local venues."}

        candidate_limit = max(1, min(int(limit or 3), SIMILAR_PLACE_MAX_CANDIDATES))
        researched = await _research_similar_places(
            clean_reference,
            kind,
            clean_area,
            resolved_scope,
            candidate_limit,
        )
        resolved_pairs = await asyncio.gather(*[
            _mapbox_resolve_researched_place(candidate, origin if resolved_scope == "local" else None)
            for candidate in researched
        ])
        pairs = [
            (place, candidate)
            for candidate, place in zip(researched, resolved_pairs)
            if place
        ]
        if resolved_scope == "local" and origin:
            pairs = [
                (place, candidate) for place, candidate in pairs
                if _nearby_distance_km(origin, place) <= SIMILAR_LOCAL_RADIUS_KM
            ]
            pairs.sort(key=lambda pair: _nearby_distance_km(origin, pair[0]))
        places = [place for place, _ in pairs]
        for place, candidate in pairs:
            place["description"] = str(candidate.get("why") or place.get("description") or "")[:700]
            place["verification_sources"] = candidate.get("source_urls") or []
            place["requested_category"] = f"similar to {clean_reference}"

        if not places:
            scope_description = f"within {SIMILAR_LOCAL_RADIUS_KM} km" if resolved_scope == "local" else (f"in {clean_area}" if clean_area else "worldwide")
            return {
                "places": [], "reference_place": clean_reference, "reference_kind": kind,
                "scope": resolved_scope, "researched_candidates": researched,
                "error": f"No mappable places similar to {clean_reference} were found {scope_description}.",
            }
        session.locations = places
        route = await _road_route([(origin[0], origin[1]), (places[0]["longitude"], places[0]["latitude"])]) if origin and resolved_scope == "local" else None
        session.route = route
        state["presentation"] = {
            "kind": "nearby_map" if resolved_scope == "local" else "places_map",
            "title": f"Places similar to {clean_reference}",
            "user_location": {"longitude": origin[0], "latitude": origin[1]} if origin and resolved_scope == "local" else None,
            "places": places, "route": route,
        }
        return {
            "places": places, "reference_place": clean_reference, "reference_kind": kind,
            "scope": resolved_scope, "area": clean_area, "route": route,
            "researched_candidates": researched,
        }

    @tool
    async def present_response_places(
        places: list[str],
        title: str | None = None,
        area: str | None = None,
    ) -> dict[str, Any]:
        """Resolve specific POIs in a reply into a selectable, non-Atlas map result.

        Use only for precise real venues, attractions, landmarks, or other map
        points that the final answer will name. This never proposes a save.
        """
        names: list[str] = []
        seen_names: set[str] = set()
        for value in places or []:
            clean = " ".join(str(value or "").split()).strip(" .")[:200]
            key = clean.casefold()
            if clean and key not in seen_names:
                seen_names.add(key)
                names.append(clean)
        names = names[:8]
        if not names:
            return {"error": "At least one specific place name is required."}

        from backend.services import place_search_service

        clean_area = " ".join(str(area or "").split()).strip(" .")[:160]
        current = getattr(session, "user_location", None)
        proximity = f"{float(current[0])},{float(current[1])}" if current and len(current) == 2 else None

        async def resolve_name(name: str) -> list[dict[str, Any]]:
            query = ", ".join(part for part in [name, clean_area] if part)
            token = str(uuid.uuid4())
            try:
                suggestions = await place_search_service.suggest(
                    query=query,
                    session_token=token,
                    proximity=proximity,
                    limit=5,
                )
                retrieved = await asyncio.gather(*[
                    place_search_service.retrieve(item["external_id"], token)
                    for item in suggestions[:5]
                ], return_exceptions=True)
            except Exception:
                return []
            candidates = _dedupe_places([
                place
                for result in retrieved if isinstance(result, list)
                for place in result
            ], limit=5)
            return candidates[:1]

        resolved = await asyncio.gather(*(resolve_name(name) for name in names))
        mapped_places = _dedupe_places(
            [place for result in resolved for place in result],
            limit=len(names),
        )
        if not mapped_places:
            return {"error": "None of those places could be resolved to a mappable point."}

        clean_title = " ".join(str(title or "Places to explore").split())[:100] or "Places to explore"
        session.locations = mapped_places
        session.route = None
        state["presentation"] = {
            "kind": "places_map",
            "title": clean_title,
            "user_location": (
                {"longitude": float(current[0]), "latitude": float(current[1])}
                if current and len(current) == 2 else None
            ),
            "places": mapped_places,
            "route": None,
        }
        return {"title": clean_title, "places": mapped_places}

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
    async def research_screen_locations(query: str) -> dict[str, Any]:
        """Research and geocode filming locations for a named screen work, then prepare an Atlas for confirmation."""
        clean_query = " ".join(str(query or "").split())[:1_000]
        if len(clean_query) < 3:
            return {"error": "A film, show, or filming-location request is required."}
        from backend.services.smart_text_service import analyze_smart_text

        result = await analyze_smart_text(clean_query, use_web_search=True)
        places = _dedupe_places(result.get("locations") or [])
        if not places:
            return {"error": "No mappable filming locations were found from the researched sources."}

        title = " ".join(str(result.get("title") or clean_query).split())[:100]
        action = {
            "action_id": str(uuid.uuid4()),
            "kind": "create_atlas",
            "title": title,
            "places": places,
            "planning_note": "Filming locations researched from live web sources and geocoded before mapping.",
        }
        session.locations = places
        session.route = result.get("route")
        register_pending_action(action)
        state["presentation"] = {
            "kind": "atlas_draft",
            "title": title,
            "places": places,
            "planning_note": action["planning_note"],
            "route": session.route,
        }
        return {
            "title": title,
            "places": places,
            "route": session.route,
            "proposal": action,
        }

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
        register_pending_action(action)
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
        register_pending_action(action)
        existing_presentation = state.get("presentation")
        state["presentation"] = {
            "kind": "atlas_draft", "title": clean_title, "places": normalized,
            "planning_note": action["planning_note"], "route": session.route,
            "special_places": existing_presentation.get("special_places", []) if isinstance(existing_presentation, dict) else [],
            "commute_route": existing_presentation.get("commute_route") if isinstance(existing_presentation, dict) else None,
            "commute_destination": existing_presentation.get("commute_destination") if isinstance(existing_presentation, dict) else None,
        }
        return {"proposal": action}

    return [resolve_special_place, propose_special_place_change, find_places_between_special_places, find_nearby_places, find_verified_places, find_similar_places, present_response_places, extract_pasted_places, research_screen_locations, propose_add_places, propose_create_atlas]


def _image_bytes(image_base64: str) -> bytes:
    """Decode the Expo image payload used by the existing Add Place OCR tool."""
    import base64

    value = (image_base64 or "").strip()
    if ";base64," in value:
        value = value.split(";base64,", 1)[1]
    try:
        return base64.b64decode(value, validate=False)
    except (ValueError, TypeError) as error:
        raise ValueError("The attached image could not be read.") from error


async def _run_image_recognition_chat(
    session: Any,
    message: str,
    image_base64: str,
    image_mode: str | None,
    on_status: Callable[[str], Awaitable[None]] | None,
) -> dict[str, Any]:
    """Use the Add Place image tools, never the chat model, for attachments."""
    started_at = time.perf_counter()
    mode = "read_text" if image_mode == "read_text" else "identify_location"
    if not session.messages and session.title in ("", "Atlas AI chat"):
        session.title = message[:100]
    session.chat_presentation = None
    session.add_message("user", message)

    try:
        if mode == "read_text":
            await _emit_agent_status(on_status, "Reading text in your image")
            from backend.services.image_scanner import scan_images

            result = await scan_images([_image_bytes(image_base64)])
            tool_name = "read_image_text"
            title = str(result.get("title") or "Places read from image")
        else:
            await _emit_agent_status(on_status, "Identifying the location in your image")
            from backend.services.find_image_places_service import find_image_place

            result = await find_image_place(image_base64)
            tool_name = "identify_image_location"
            title = str(result.get("title") or "Location identified from image")

        places = _dedupe_places(result.get("locations") or [])
        # The Identify Location tool represents an unsuccessful recognition as
        # a zero-coordinate "Unknown Location" placeholder. Do not map it.
        places = [place for place in places if place["name"].casefold() != "unknown location"]
        session.locations = places
        session.route = result.get("route")
        presentation = {
            "kind": "places_map",
            "title": title[:100],
            "places": places,
            "route": session.route,
        } if places else None
        if places:
            answer = (
                f"I found {len(places)} place{'s' if len(places) != 1 else ''} "
                f"with the Add Place {'Read text' if mode == 'read_text' else 'Identify location'} tool."
            )
        elif mode == "read_text":
            answer = "I couldn't find a mappable place in the text from this image."
        else:
            answer = "I couldn't confidently identify a mappable location in this image."
        status, partial = "success", False
    except Exception as error:
        places, presentation = [], None
        result = {"error": type(error).__name__}
        tool_name = "read_image_text" if mode == "read_text" else "identify_image_location"
        answer = "I couldn't read that image right now. Please try another image."
        status, partial = "error", True

    await _emit_agent_status(on_status, "Preparing map results")
    tool_results = [{"name": tool_name, "result": {"places": places, "source": "add_place"}}]
    if presentation:
        tool_results.append({"name": "chat_presentation", "result": {"presentation": presentation}})
    session.chat_presentation = presentation
    session.add_message("assistant", answer, tool_calls=[tool_name], tool_results=tool_results)
    try:
        await conversation_manager.save_conversation(session.session_id)
    except Exception as error:
        print(f"[Chat] Failed to persist image recognition: {error}")
    return {
        "session_id": session.session_id,
        "conversation_id": session.conversation_id,
        "response": answer,
        "locations": places,
        "route": session.route,
        "tool_calls_used": [tool_name],
        "tool_results": tool_results,
        "status": status,
        "partial": partial,
        "pending_action": None,
        "presentation": presentation,
        "place_cards": [],
        "metrics": {
            "latency_ms": round((time.perf_counter() - started_at) * 1000),
            "tool_call_count": 1,
        },
    }


async def _run_agent(
    session: Any,
    user_message: str,
    image_base64: str | None = None,
    image_mode: str | None = None,
    on_status: Callable[[str], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    message = (user_message or "").strip()
    if not message:
        raise ValueError("Message cannot be empty")
    await _emit_agent_status(on_status, "Understanding your request")
    if image_base64:
        return await _run_image_recognition_chat(
            session,
            message,
            image_base64,
            image_mode,
            on_status,
        )
    if _is_special_place_confirmation_ack(message, getattr(session, "pending_chat_action", None)):
        action = session.pending_chat_action
        role = str(action.get("special_role") or "place").title()
        answer = f"Your {role} location is ready. Use the Save or Cancel control on the confirmation card to continue."
        session.add_message("user", message)
        session.add_message("assistant", answer)
        try:
            await conversation_manager.save_conversation(session.session_id)
        except Exception as error:
            print(f"[Chat] Failed to persist confirmation reminder: {error}")
        return {
            "session_id": session.session_id, "conversation_id": session.conversation_id, "response": answer,
            "locations": session.locations, "route": session.route, "tool_calls_used": [], "tool_results": [],
            "status": "success", "partial": False, "pending_action": action,
            "presentation": session.chat_presentation, "place_cards": [],
            "metrics": {"latency_ms": 0, "tool_call_count": 0},
        }
    if not session.messages and session.title in ("", "Atlas AI chat"):
        session.title = message[:100]
    started_at = time.perf_counter()
    session.chat_presentation = None
    session.add_message("user", message)
    explicit_place_names = _explicit_save_place_names(message)
    explicit_atlas_names = _explicit_atlas_place_names(message)
    explicit_action_kind = "create_atlas" if explicit_atlas_names else "save_places"
    explicit_place_names = explicit_atlas_names or explicit_place_names
    if explicit_place_names:
        await _emit_agent_status(on_status, "Locating the requested places")
        resolved_places = await _resolve_explicit_place_names(explicit_place_names)
        resolved_names = {place["name"].casefold() for place in resolved_places}
        unresolved_names = [name for name in explicit_place_names if name.casefold() not in resolved_names]
        if resolved_places:
            action = {
                "action_id": str(uuid.uuid4()),
                "kind": explicit_action_kind,
                "title": (
                    f"Atlas: {resolved_places[0]['name']} and {len(resolved_places) - 1} more"
                    if explicit_action_kind == "create_atlas" and len(resolved_places) > 1
                    else (f"Atlas: {resolved_places[0]['name']}" if explicit_action_kind == "create_atlas" else f"Add {len(resolved_places)} place{'s' if len(resolved_places) != 1 else ''}")
                ),
                "places": resolved_places,
            }
            if explicit_action_kind == "create_atlas":
                action["planning_note"] = "Atlas created from the places you selected."
            presentation = {
                "kind": "atlas_draft" if explicit_action_kind == "create_atlas" else "places_map",
                "title": action["title"],
                # This is a result set, not a nearby or route result. Keeping
                # device GPS out avoids collapsing a Los Angeles map to a
                # cross-country overview.
                "places": resolved_places,
                "route": None,
            }
            session.locations = resolved_places
            session.route = None
            session.pending_chat_action = action
            session.chat_presentation = presentation
            unresolved_note = (
                f" I could not confidently resolve {', '.join(unresolved_names)}."
                if unresolved_names else ""
            )
            verb = "Create" if explicit_action_kind == "create_atlas" else "Add"
            destination = "your Atlas" if explicit_action_kind == "create_atlas" else "My Places"
            answer = f"I found {len(resolved_places)} place{'s' if len(resolved_places) != 1 else ''}. Review them on the map, then tap {verb} to save them to {destination}.{unresolved_note}"
            tool_results = [
                {"name": "resolve_named_places", "result": {"places": resolved_places, "unresolved": unresolved_names}},
                {"name": "propose_create_atlas" if explicit_action_kind == "create_atlas" else "propose_add_places", "result": {"proposal": action}},
                {"name": "chat_presentation", "result": {"presentation": presentation}},
            ]
            proposal_tool = "propose_create_atlas" if explicit_action_kind == "create_atlas" else "propose_add_places"
            session.add_message("assistant", answer, tool_calls=["resolve_named_places", proposal_tool], tool_results=tool_results)
            try:
                await conversation_manager.save_conversation(session.session_id)
            except Exception as error:
                print(f"[Chat] Failed to persist explicit place save: {error}")
            return {
                "session_id": session.session_id,
                "conversation_id": session.conversation_id,
                "response": answer,
                "locations": resolved_places,
                "route": None,
                "tool_calls_used": ["resolve_named_places", proposal_tool],
                "tool_results": tool_results,
                "status": "success",
                "partial": bool(unresolved_names),
                "pending_action": action,
                "presentation": presentation,
                "place_cards": [],
                "metrics": {"latency_ms": round((time.perf_counter() - started_at) * 1000), "tool_call_count": 2},
            }
    model_name = os.environ.get("OPENAI_MODEL_MANGO") or os.environ.get("OPENAI_MODEL", DEFAULT_CHAT_MODEL)
    model = get_chat_model(CHAT_PROVIDER, model_name, temperature=0.3)
    prompt: list[BaseMessage] = [SystemMessage(content=_system_prompt(session)), *_history_messages(session)]
    state: dict[str, Any] = {
        "presentation": None,
        "pending_action": None,
        "pending_actions": [],
        "nearby_groups": {},
        "user_message": message,
    }
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
                    await _emit_agent_status(on_status, "Preparing your response")
                    answer = _content_to_text(getattr(response, "content", response))
                    break
                prompt.append(response)
                for call in calls:
                    name = str(call.get("name") or "")
                    call_id = str(call.get("id") or uuid.uuid4())
                    tool_calls_used.append(name)
                    await _emit_agent_status(
                        on_status,
                        _AGENT_STATUS_LABELS.get(name, "Working on your request"),
                    )
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
    await _finalize_commute_presentation(session, state)
    # A route/itinerary may be rendered as an Atlas draft by a finder tool
    # before the model calls `propose_create_atlas`. Do not show an Atlas map
    # without its required explicit create confirmation.
    presentation = state.get("presentation")
    actions = state.get("pending_actions") or []
    if (
        isinstance(presentation, dict)
        and presentation.get("kind") == "atlas_draft"
        and presentation.get("places")
        and not any(isinstance(item, dict) and item.get("kind") == "create_atlas" for item in actions)
    ):
        atlas_action = {
            "action_id": str(uuid.uuid4()),
            "kind": "create_atlas",
            "title": str(presentation.get("title") or "Atlas draft")[:100],
            "places": _dedupe_places(presentation["places"]),
            "planning_note": presentation.get("planning_note"),
        }
        state["pending_actions"] = [*actions, atlas_action]
        state["pending_action"] = atlas_action
        session.pending_chat_action = atlas_action
        session.pending_chat_actions = [
            *[item for item in (getattr(session, "pending_chat_actions", []) or []) if item.get("kind") != "create_atlas"],
            atlas_action,
        ]
    # Persist the final, order-independent map model alongside the tool log.
    # History restoration otherwise sees whichever tool happened to run last
    # and can lose the commute destination marker and route controls.
    if isinstance(state.get("presentation"), dict):
        tool_results.append({
            "name": "chat_presentation",
            "result": {"presentation": state["presentation"]},
        })
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
        "pending_actions": state["pending_actions"],
        "presentation": state["presentation"], "place_cards": [],
        "metrics": {
            "latency_ms": round((time.perf_counter() - started_at) * 1000),
            "tool_call_count": len(tool_calls_used),
            "input_tokens": usage.get("input_tokens") or usage.get("prompt_tokens"),
            "output_tokens": usage.get("output_tokens") or usage.get("completion_tokens"),
        },
    }


async def run_chat(
    session_id: str,
    user_message: str,
    image_base64: str | None = None,
    image_mode: str | None = None,
) -> dict:
    session = conversation_manager.get_session(session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")
    return await _run_agent(session, user_message, image_base64, image_mode)


async def stream_chat(
    session_id: str,
    user_message: str,
    image_base64: str | None = None,
    image_mode: str | None = None,
) -> AsyncIterator[dict]:
    session = conversation_manager.get_session(session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")
    if image_base64:
        status_events: asyncio.Queue[dict[str, str]] = asyncio.Queue()

        async def publish_image_status(label: str) -> None:
            await status_events.put({"type": "status", "label": label})

        image_task = asyncio.create_task(
            _run_agent(session, user_message, image_base64, image_mode, publish_image_status),
        )
        try:
            while not image_task.done():
                try:
                    yield await asyncio.wait_for(status_events.get(), timeout=0.2)
                except TimeoutError:
                    continue
            result = await image_task
            while not status_events.empty():
                yield status_events.get_nowait()
            for index in range(0, len(result["response"]), 36):
                yield {"type": "token", "delta": result["response"][index:index + 36]}
            yield {"type": "complete", **result}
        finally:
            if not image_task.done():
                image_task.cancel()
                try:
                    await image_task
                except asyncio.CancelledError:
                    pass
        return
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
    status_events: asyncio.Queue[dict[str, str]] = asyncio.Queue()

    async def publish_status(label: str) -> None:
        await status_events.put({"type": "status", "label": label})

    agent_task = asyncio.create_task(
        _run_agent(session, user_message, image_base64, image_mode, publish_status),
    )
    try:
        while not agent_task.done():
            try:
                yield await asyncio.wait_for(status_events.get(), timeout=0.2)
            except TimeoutError:
                continue
        result = await agent_task
        while not status_events.empty():
            yield status_events.get_nowait()
        answer = result["response"]
        for index in range(0, len(answer), 36):
            yield {"type": "token", "delta": answer[index:index + 36]}
        yield {"type": "complete", **result}
    finally:
        if not agent_task.done():
            agent_task.cancel()
            try:
                await agent_task
            except asyncio.CancelledError:
                pass
