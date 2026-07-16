"""LangChain tool-calling chat agent for Atlas AI.

Replaces the legacy content-JSON agent loop for /chat. Tool calls now travel
in the API's structured ``tool_calls`` field (never inside content), and the
loop is framework-driven: the model is re-invoked with tool results until it
produces a plain final answer. This structurally fixes two legacy bugs:

- raw ``{"type": "tool_call"| "final_answer", ...}`` JSON leaking into chat
  bubbles (there is no JSON-in-content protocol anymore), and
- the loop stalling after each tool call until the user manually prompted
  again (the loop continues automatically until a final answer).

Session bookkeeping (memory injection, tool side-effects via
``_apply_tool_result``, rolling summary, long-term memory update, and the
response shape) intentionally mirrors ``agent_orchestrator.chat`` so the
frontend contract is unchanged.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from backend.langchain.runtime import get_chat_model
from backend.services.conversation_manager import conversation_manager
from backend.services.place_card_extractor import extract_place_cards
from backend.services.tool_definitions import TOOLS, registry

MAX_STEPS = 8
STEP_TIMEOUT = 30  # seconds per tool execution
TOTAL_TIMEOUT = 90  # seconds per chat turn
TOOL_RESULT_CHAR_LIMIT = 4000  # keep tool payloads from blowing up context


def _system_prompt(session: Any) -> str:
    """Same persona and rules as the legacy agent loop (kept verbatim)."""
    location_lines = []
    for idx, loc in enumerate(getattr(session, "locations", []) or [], start=1):
        name = loc.get("name", "Unknown place")
        lat = loc.get("latitude", 0)
        lng = loc.get("longitude", 0)
        address = loc.get("full_address") or loc.get("description") or ""
        extra = f" | {address}" if address else ""
        location_lines.append(f"{idx}. {name} ({lat:.6f}, {lng:.6f}){extra}")
    location_block = "\n".join(location_lines) if location_lines else "None"
    action_card_example = (
        '[[PLACE_ACTION_CARD:{"places":[{"name":"...","latitude":0,"longitude":0,'
        '"subtitle":"...","category":"...","description":"..."}],'
        '"status":"pending"}]]'
    )
    return f"""You are a travel assistant AI that helps users plan itineraries from web content.

Current session state:
- Locations on map: {len(session.locations)}
- Current location list:
{location_block}
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
If the user wants to add new places to the current chat or save places to My Places, first ask for confirmation in plain language. Only call map_operation after the user confirms.
When saving places from chat, keep the chat UI open. Do not instruct the frontend to navigate away or open the My Places screen.

When the user's request is simple (e.g., just asking a question), respond directly without tools.
When you need to modify the map or route, use the appropriate tool.
When the user is asking for a list of places, prefer a compact line-by-line answer with concrete place names and city/region context so the client can turn it into map pins.
When the user asks about "these places", "the two places", or similar follow-ups, refer to the current location list above by name and coordinates. Never say you do not know which places they mean if the session already has locations.
When you discover additional nearby places but the user has not yet confirmed, do not call map_operation. Instead, explain the suggestion and append a final hidden marker in exactly this format:
{action_card_example}
Do not write any other marker format in the same answer.
The frontend will render the action card from this marker. The user can later tap Pin in Chat or Save to My Places directly inside the chat history.
Always explain what you're doing before calling a tool."""


def _history_messages(session: Any) -> list[BaseMessage]:
    """Map recent session messages to LangChain messages.

    Legacy tool bookkeeping entries ("[Used tool: x]") are kept as plain AI
    messages — they give the model context about past actions without
    re-entering tool protocol.
    """
    out: list[BaseMessage] = []
    for msg in session.get_recent_context(10):
        role = msg.get("role")
        content = msg.get("content") or ""
        if not content:
            continue
        if role != "user" and content.startswith("[Used tool:"):
            continue
        if role == "user":
            out.append(HumanMessage(content=content))
        else:
            out.append(AIMessage(content=content))
    return out


def _content_to_text(content: Any) -> str:
    """AIMessage.content can be a string or a list of content parts."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for p in content:
            if isinstance(p, str):
                parts.append(p)
            elif isinstance(p, dict) and p.get("type") == "text":
                parts.append(p.get("text", ""))
        return "".join(parts)
    return str(content or "")


def _place_action_card_marker(places: list[dict[str, Any]], status: str = "pending") -> str:
    markers = []
    for place in places:
        markers.append(
            "[[PLACE_ACTION_CARD:"
            + json.dumps(
                {
                    "places": [place],
                    "status": status,
                },
                ensure_ascii=False,
                default=str,
            )
            + "]]"
        )
    return "\n".join(markers)


def _cards_to_markers(cards: list[dict[str, Any]]) -> str:
    markers = []
    for card in cards[:3]:
        markers.append(_place_action_card_marker(card.get("places", []), status=str(card.get("status") or "pending")))
    return "\n".join(marker for marker in markers if marker)


def _extract_pending_places_from_messages(session: Any) -> dict[str, Any] | None:
    """Recover the latest pending place action from saved assistant messages."""
    for msg in reversed(getattr(session, "messages", []) or []):
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content") or ""
        match = content.rfind("[[PLACE_ACTION_CARD:")
        if match == -1:
            continue
        chunk = content[match:]
        end = chunk.find("]]")
        if end == -1:
            continue
        raw = chunk[len("[[PLACE_ACTION_CARD:"):end]
        try:
            parsed = json.loads(raw)
        except Exception:
            continue
        places = parsed.get("places") or []
        if places:
            return {
                "action": "pin_in_chat",
                "places": places,
                "status": parsed.get("status", "pending"),
            }
    return None


async def run_chat(session_id: str, user_message: str) -> dict:
    """Continue a conversation using native LangChain tool calling."""
    # Imported here to avoid a circular import at module load time.
    from backend.services.agent_orchestrator import agent_orchestrator

    session = conversation_manager.get_session(session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")

    if not getattr(session, "pending_place_action", None):
        session.pending_place_action = _extract_pending_places_from_messages(session)

    confirm_prefix = "CONFIRM_ADD_PLACES "
    if user_message.startswith(confirm_prefix):
        payload_text = user_message[len(confirm_prefix):].strip()
        payload = json.loads(payload_text) if payload_text else {}
        places = payload.get("places") or []
        action = str(payload.get("action") or "pin_in_chat")
        if not places and getattr(session, "pending_place_action", None):
            places = session.pending_place_action.get("places") or []
            action = str(session.pending_place_action.get("action") or action)
        if not places:
            session.add_message("user", user_message)
            assistant_text = "I need the specific place card first."
            session.add_message("assistant", assistant_text)
            await conversation_manager.save_conversation(session.session_id)
            return {
                "session_id": session.session_id,
                "response": assistant_text,
                "locations": session.locations,
                "route": session.route,
                "tool_calls_used": [],
                "status": "error",
                "partial": False,
            }

        add_result = await registry.execute(
            "map_operation",
            {"action": "add_pin", "params": {"session_id": session.session_id, "places": places}},
        )
        final_locations = add_result.get("locations", session.locations) if isinstance(add_result, dict) else session.locations
        if action == "save_to_my_places" and places:
            save_result = await registry.execute(
                "map_operation",
                {
                    "action": "save_to_my_places",
                    "params": {
                        "session_id": session.session_id,
                        "places": places,
                        "source_url": session.source_url,
                        "region": session.inferred_region,
                    },
                },
            )
            if isinstance(save_result, dict) and save_result.get("success"):
                final_locations = add_result.get("locations", session.locations) if isinstance(add_result, dict) else session.locations
                if not final_locations and places:
                    final_locations = places

        session.add_message("user", user_message)
        assistant_text = "Done. I added the suggested places to this chat."
        if action == "save_to_my_places":
            assistant_text += " They were also saved to My Places."
        if places:
            status = "pin_done" if action == "pin_in_chat" else "save_done"
            assistant_text = f"{assistant_text}\n{_place_action_card_marker(places, status=status)}"
        session.add_message("assistant", assistant_text)
        session.pending_place_action = None
        await conversation_manager.save_conversation(session.session_id)
        return {
            "session_id": session.session_id,
            "response": assistant_text,
            "locations": final_locations,
            "route": session.route,
            "tool_calls_used": ["map_operation"],
            "status": "success",
            "partial": False,
        }

    session.add_message("user", user_message)

    # Long-term memory injection (same as legacy chat).
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

    provider = os.environ.get("CHAT_PROVIDER", "deepseek")
    model_name = os.environ.get("CHAT_MODEL", "deepseek-chat")
    llm = get_chat_model(provider, model_name, temperature=0.3).bind_tools(TOOLS)

    messages: list[BaseMessage] = [SystemMessage(content=_system_prompt(session))]
    messages.extend(_history_messages(session))

    total_tool_calls: list[str] = []
    start_time = time.time()
    answer: str | None = None
    status = "success"
    partial = False
    pending_action: dict[str, Any] | None = None
    extracted_cards: list[dict[str, Any]] = []

    for _step in range(MAX_STEPS):
        if time.time() - start_time > TOTAL_TIMEOUT:
            status, partial = "timeout", True
            answer = "The operation timed out. Here's what I have so far."
            break

        try:
            ai: AIMessage = await llm.ainvoke(messages)
        except Exception as e:
            status, partial = "error", True
            answer = f"Sorry, I encountered an error: {e}"
            break

        messages.append(ai)

        if getattr(ai, "tool_calls", None):
            saw_map_operation = False
            for tc in ai.tool_calls:
                name = tc.get("name", "")
                args = tc.get("args") or {}
                if name == "map_operation":
                    args = {**args, "session_id": session.session_id}
                    saw_map_operation = True
                try:
                    tool_result = await asyncio.wait_for(
                        registry.execute(name, args), timeout=STEP_TIMEOUT
                    )
                except asyncio.TimeoutError:
                    tool_result = {"error": f"Tool {name} timed out"}
                except Exception as e:
                    tool_result = {"error": str(e)}

                # Legacy bookkeeping: record the call on the session and let
                # the orchestrator apply map/route side-effects.
                session.add_message(
                    "assistant",
                    f"[Used tool: {name}]",
                    tool_calls=[{"name": name, "arguments": args}],
                    tool_results=[tool_result],
                )
                try:
                    agent_orchestrator._apply_tool_result(session, name, args, tool_result)
                except Exception:
                    pass
                total_tool_calls.append(name)

                if name == "map_operation" and isinstance(tool_result, dict) and tool_result.get("success"):
                    result = tool_result.get("result") or {}
                    params = args.get("params") or {}
                    if args.get("action") == "add_pin":
                        pending_action = {
                            "action": "pin_in_chat",
                            "places": result.get("locations", params.get("places", [])),
                        }
                    elif args.get("action") == "save_to_my_places":
                        pending_action = {
                            "action": "save_to_my_places",
                            "places": params.get("places", []),
                        }

                payload = json.dumps(tool_result, ensure_ascii=False, default=str)
                messages.append(
                    ToolMessage(
                        content=payload[:TOOL_RESULT_CHAR_LIMIT],
                        tool_call_id=tc.get("id", name),
                    )
                )
            if saw_map_operation:
                if pending_action and pending_action.get("places"):
                    answer = (
                        "Done. I added those places to this chat."
                        if pending_action.get("action") == "pin_in_chat"
                        else "Done. I saved those places to My Places."
                    )
                else:
                    answer = "Done."
                break
            continue  # feed tool results back to the model

        answer = _content_to_text(ai.content).strip()
        break
    else:
        status, partial = "max_steps", True
        answer = answer or "I reached the step limit. Here's what I have so far."

    if answer:
        if pending_action and pending_action.get("places"):
            session.pending_place_action = pending_action
            answer = f"{answer}\n{_place_action_card_marker(pending_action['places'], status='pending')}"
        else:
            try:
                extracted_cards = await extract_place_cards(answer, request_id=session.session_id)
            except Exception:
                extracted_cards = []
            if extracted_cards:
                answer = f"{answer}\n{_cards_to_markers(extracted_cards)}"
        session.add_message("assistant", answer)

    try:
        await agent_orchestrator._maybe_roll_conversation_summary(session)
        await agent_orchestrator._update_memory(session)
        await conversation_manager.save_conversation(session.session_id)
    except Exception:
        pass

    return {
        "session_id": session_id,
        "response": answer or "",
        "locations": session.locations,
        "route": session.route,
        "tool_calls_used": total_tool_calls,
        "status": status,
        "partial": partial,
        "pending_action": pending_action,
        "place_cards": extracted_cards,
    }
