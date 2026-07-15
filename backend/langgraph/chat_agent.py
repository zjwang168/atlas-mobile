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
from backend.services.tool_definitions import TOOLS, registry

MAX_STEPS = 8
STEP_TIMEOUT = 30  # seconds per tool execution
TOTAL_TIMEOUT = 90  # seconds per chat turn
TOOL_RESULT_CHAR_LIMIT = 4000  # keep tool payloads from blowing up context


def _system_prompt(session: Any) -> str:
    """Same persona and rules as the legacy agent loop (kept verbatim)."""
    return f"""You are a travel assistant AI that helps users plan itineraries from web content.

Current session state:
- Locations on map: {len(session.locations)}
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


async def run_chat(session_id: str, user_message: str) -> dict:
    """Continue a conversation using native LangChain tool calling."""
    # Imported here to avoid a circular import at module load time.
    from backend.services.agent_orchestrator import agent_orchestrator

    session = conversation_manager.get_session(session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")

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
            for tc in ai.tool_calls:
                name = tc.get("name", "")
                args = tc.get("args") or {}
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

                payload = json.dumps(tool_result, ensure_ascii=False, default=str)
                messages.append(
                    ToolMessage(
                        content=payload[:TOOL_RESULT_CHAR_LIMIT],
                        tool_call_id=tc.get("id", name),
                    )
                )
            continue  # feed tool results back to the model

        answer = _content_to_text(ai.content).strip()
        break
    else:
        status, partial = "max_steps", True
        answer = answer or "I reached the step limit. Here's what I have so far."

    if answer:
        session.add_message("assistant", answer)

    try:
        await agent_orchestrator._maybe_roll_conversation_summary(session)
        await agent_orchestrator._update_memory(session)
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
    }