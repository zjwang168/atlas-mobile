"""Conversational Atlas agent with bounded, confirmation-first tool calling."""

from __future__ import annotations

import asyncio
import base64
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
CONSTRAINED_PLACE_MAX_CANDIDATES = 5
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
    "评分", "评价", "价格", "菜单", "素食", "纯素", "早餐", "早午餐", "外带", "打包", "顺路", "通勤",
)


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
- For a place request with rating, price, menu, dietary, availability, or
  route/commute constraints, call find_verified_places instead. It uses live
  web research to find named venues and Mapbox only to resolve those venues to
  map points. Never pass the whole descriptive phrase to Mapbox or claim that
  an unverified constraint is true.
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
- Home, Office, and School are sensitive system places. Treat their values in
  the Saved special places section as trusted. For a request involving one of
  those roles, use it directly when available. If it is missing, ask the user
  for an address, place name, or map point; never guess it. When they provide
  a candidate, call resolve_special_place, then propose_special_place_change.
  That proposal is required for every create, replacement, and deletion. Never
  persist, replace, or delete a special place directly.
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
{_special_places_context(session)}"""


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
    @tool
    async def resolve_special_place(query: str, role: str) -> dict[str, Any]:
        """Resolve a user-supplied Home, Office, or School address into one map place. Never writes data."""
        clean_role = str(role).strip().lower()
        if clean_role not in {"home", "office", "school"}:
            return {"error": "role must be home, office, or school."}
        clean_query = " ".join(str(query).split())[:500]
        if len(clean_query) < 3:
            return {"error": "A more specific address or place name is needed."}
        from backend.services import place_search_service
        token = str(uuid.uuid4())
        try:
            suggestions = await place_search_service.suggest(clean_query, token, limit=1)
            if not suggestions:
                return {"error": "No matching place was found."}
            places = _dedupe_places(await place_search_service.retrieve(suggestions[0]["external_id"], token), limit=1)
        except Exception as error:
            return {"error": f"Could not resolve this place: {type(error).__name__}"}
        if not places:
            return {"error": "The matching place did not include a mappable coordinate."}
        return {"role": clean_role, "place": places[0]}

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
        session.pending_chat_action = action
        state["pending_action"] = action
        state["presentation"] = {
            "kind": "places_map", "title": action["title"], "places": normalized,
            "special_places": [item for item in [current] if item] if clean_operation == "delete" else [{
                "role": clean_role, "name": normalized[0]["name"], "latitude": normalized[0]["latitude"],
                "longitude": normalized[0]["longitude"], "full_address": normalized[0].get("full_address"),
            }],
            "route": None,
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
        origin_tuple = (float(origin[0]), float(origin[1])) if origin and len(origin) == 2 else None
        researched = await _research_precise_places(requirements, area, candidate_limit)
        resolved = await asyncio.gather(*[
            _mapbox_resolve_researched_place(candidate, origin_tuple)
            for candidate in researched
        ])
        places = [place for place in resolved if place]
        if origin_tuple:
            places.sort(key=lambda place: _nearby_distance_km(origin_tuple, place))
        unverified: list[str] = []
        commute_requested = bool(re.search(r"\b(?:on my way|on the way|along (?:my |the )?route|commute)\b|顺路|通勤", requirements, re.IGNORECASE))
        commute_route = None
        anchors: list[dict[str, Any]] = []
        if commute_requested:
            commute = _commute_anchors(session)
            if not commute:
                unverified.append("Route fit is not verified until Home and Office are saved or an origin and destination are provided.")
            else:
                home, office = commute
                places, commute_route = await _rank_by_commute_detour(home, office, places)
                anchors = [
                    {"role": "home", "name": home.get("name") or "Home", "longitude": home["longitude"], "latitude": home["latitude"], "full_address": home.get("full_address")},
                    {"role": "office", "name": office.get("name") or "Office", "longitude": office["longitude"], "latitude": office["latitude"], "full_address": office.get("full_address")},
                ]
        if not places:
            return {
                "places": [],
                "researched_candidates": researched,
                "unverified_constraints": unverified,
                "error": "Live research found no venue that Mapbox could resolve to a reliable map point.",
            }
        route = commute_route or (await _road_route([(origin_tuple[0], origin_tuple[1]), (places[0]["longitude"], places[0]["latitude"])]) if origin_tuple else None)
        session.locations = places
        session.route = route
        state["presentation"] = {
            "kind": "nearby_map",
            "title": "Live-verified nearby places",
            "user_location": {"longitude": origin_tuple[0], "latitude": origin_tuple[1]} if origin_tuple else None,
            "places": places,
            "special_places": anchors,
            "route": route,
        }
        return {
            "places": places,
            "researched_candidates": researched,
            "route": route,
            "special_places": anchors,
            "unverified_constraints": unverified,
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

    return [resolve_special_place, propose_special_place_change, find_places_between_special_places, find_nearby_places, find_verified_places, extract_pasted_places, propose_add_places, propose_create_atlas]


def _image_data_url(image_base64: str | None) -> str | None:
    """Normalize a mobile image payload for the OpenAI-compatible vision input."""
    value = (image_base64 or "").strip()
    if not value:
        return None
    if value.startswith("data:image/") and ";base64," in value:
        return value
    # Expo ImagePicker returns bare base64. Preserve common library image types
    # rather than assuming every selected asset is JPEG.
    header = value[:24]
    media_type = "image/jpeg"
    if header.startswith("iVBOR"):
        media_type = "image/png"
    elif header.startswith("R0lGOD"):
        media_type = "image/gif"
    elif header.startswith("UklGR"):
        media_type = "image/webp"
    elif not header.startswith("/9j/"):
        # A data URL is still valid for less common picker output. Image vision
        # will reject unsupported formats without exposing it to chat history.
        try:
            decoded = base64.b64decode(value[:128], validate=False)
            if decoded.startswith(b"\x89PNG"):
                media_type = "image/png"
        except ValueError:
            pass
    return f"data:{media_type};base64,{value}"


async def _run_agent(session: Any, user_message: str, image_base64: str | None = None) -> dict[str, Any]:
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
    image_url = _image_data_url(image_base64)
    if image_url:
        # The text-only copy above is deliberately kept in session history.
        # Replace only this first-turn prompt message with its multimodal form.
        if prompt and isinstance(prompt[-1], HumanMessage):
            prompt.pop()
        prompt.append(HumanMessage(content=[
            {"type": "text", "text": message},
            {"type": "image_url", "image_url": {"url": image_url}},
        ]))
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


async def run_chat(session_id: str, user_message: str, image_base64: str | None = None) -> dict:
    session = conversation_manager.get_session(session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")
    return await _run_agent(session, user_message, image_base64)


async def stream_chat(session_id: str, user_message: str, image_base64: str | None = None) -> AsyncIterator[dict]:
    session = conversation_manager.get_session(session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")
    model_name = os.environ.get("OPENAI_MODEL_MANGO") or os.environ.get("OPENAI_MODEL", DEFAULT_CHAT_MODEL)
    model = get_chat_model(CHAT_PROVIDER, model_name, temperature=0.3)
    # Keep the old streaming contract for lightweight test doubles and any
    # provider that only implements native text streaming.
    if not hasattr(model, "ainvoke"):
        if _image_data_url(image_base64):
            raise ValueError("This chat model does not support image attachments.")
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
    result = await _run_agent(session, user_message, image_base64)
    answer = result["response"]
    for index in range(0, len(answer), 36):
        yield {"type": "token", "delta": answer[index:index + 36]}
    yield {"type": "complete", **result}
