"""Conversational Atlas agent with bounded, confirmation-first tool calling."""

from __future__ import annotations

import asyncio
import json
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
- A nearby request, including gas stations, MUST call find_nearby_places.
- For pasted notes or an itinerary that the user wants added, call
  extract_pasted_places, then propose_add_places. This is only a proposal.
- For creating an Atlas, find or extract real places first, then call
  propose_create_atlas. This is only a proposal.
- Never claim that a proposal was saved or created until the client confirms it.

{title_line}{location_line}

Explicit places attached to this chat:
{_location_context(session)}"""


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


def _normalize_place(place: dict[str, Any]) -> dict[str, Any] | None:
    try:
        name = str(place.get("name") or "").strip()
        latitude = float(place.get("latitude"))
        longitude = float(place.get("longitude"))
    except (TypeError, ValueError):
        return None
    if not name or not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
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
    async def find_nearby_places(query: str, limit: int = 5) -> dict[str, Any]:
        """Find real nearby places for a category using the device GPS location."""
        current = getattr(session, "user_location", None)
        if not current or len(current) != 2:
            return {"error": "Current device location is unavailable."}
        longitude, latitude = float(current[0]), float(current[1])
        from backend.services import place_search_service

        session_token = str(uuid.uuid4())
        suggestions = await place_search_service.suggest(
            query=query.strip(), session_token=session_token, proximity=f"{longitude},{latitude}",
            limit=max(1, min(int(limit or 5), 8)),
        )
        retrieved = await asyncio.gather(*[
            place_search_service.retrieve(item["external_id"], session_token)
            for item in suggestions[: max(1, min(int(limit or 5), 8))]
        ])
        places = _dedupe_places([place for result in retrieved for place in result], limit=max(1, min(int(limit or 5), 8)))
        if not places:
            return {"query": query, "places": [], "error": "No nearby places were found."}
        route = await _road_route([(longitude, latitude), (places[0]["longitude"], places[0]["latitude"])])
        session.locations = places
        session.route = route
        state["presentation"] = {
            "kind": "nearby_map", "title": f"Nearby {query.strip()}",
            "user_location": {"longitude": longitude, "latitude": latitude},
            "places": places, "route": route,
        }
        return {"query": query, "places": places, "route": route}

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
    async def propose_create_atlas(title: str, places: list[dict[str, Any]]) -> dict[str, Any]:
        """Propose an Atlas draft with geocoded places. This never creates an Atlas."""
        normalized = _dedupe_places(places)
        clean_title = " ".join(title.split())[:100]
        if not clean_title or not normalized:
            return {"error": "An Atlas draft needs a title and at least one geocoded place."}
        action = {"action_id": str(uuid.uuid4()), "kind": "create_atlas", "title": clean_title, "places": normalized}
        session.pending_chat_action = action
        state["pending_action"] = action
        state["presentation"] = {"kind": "atlas_draft", "title": clean_title, "places": normalized, "route": session.route}
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
    state: dict[str, Any] = {"presentation": None, "pending_action": None}
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
