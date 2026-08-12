"""Plain conversational chat for Atlas AI.

The chat endpoint intentionally starts from the model's native capabilities.
It keeps only the current conversation transcript and the explicit places
belonging to that conversation in context. Product persistence is still
performed by ``ConversationManager``; persistence is not treated as memory.

Tools, cross-conversation memory, rolling summaries, place-card extraction,
and map mutations belong to later, separately tested capabilities. Keeping
them out of this path makes the behaviour of the baseline easy to evaluate.
"""

from __future__ import annotations

import asyncio
import os
import re
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from backend.langchain.runtime import get_chat_model
from backend.services.conversation_manager import conversation_manager


MAX_CONTEXT_MESSAGES = 20
CHAT_TIMEOUT = 90

# Historical conversations may contain the old product protocol. Do not feed
# protocol markers back to the model or render them as part of the baseline
# chat transcript.
_ACTION_MARKER_RE = re.compile(r"\[\[(?:PLACE_ACTION_CARD|CONFIRM_ADD_PLACES):[\s\S]*?\]\]")


def _clean_history_content(content: Any) -> str:
    text = str(content or "")
    text = _ACTION_MARKER_RE.sub("", text)
    return text.strip()


def _location_context(session: Any) -> str:
    locations = getattr(session, "locations", []) or []
    if not locations:
        return "No places have been explicitly attached to this chat."

    lines = []
    for index, location in enumerate(locations[:50], start=1):
        name = str(location.get("name") or "Unknown place")
        address = str(
            location.get("full_address")
            or location.get("description")
            or location.get("subtitle")
            or ""
        ).strip()
        coordinates = ""
        latitude = location.get("latitude")
        longitude = location.get("longitude")
        if latitude is not None and longitude is not None:
            coordinates = f" ({latitude}, {longitude})"
        lines.append(f"{index}. {name}{coordinates}{f' | {address}' if address else ''}")
    return "\n".join(lines)


def _system_prompt(session: Any) -> str:
    title = str(getattr(session, "title", "") or "").strip()
    title_line = f"Chat title: {title}\n" if title else ""
    return f"""You are Atlas AI, a thoughtful travel conversation assistant.

Answer the user's question directly and clearly. Use only the current chat
transcript and the explicitly attached places below as application context.
Do not claim to have searched the web, changed a map, saved a place, or
remembered information from another chat. You cannot perform app actions in
this mode. If a question needs current or verified information, say that it
would need a live search instead of guessing. Ask a concise follow-up when
the request is genuinely ambiguous.

{title_line}Explicit places attached to this chat:
{_location_context(session)}"""


def _history_messages(session: Any) -> list[BaseMessage]:
    messages: list[BaseMessage] = []
    for message in session.get_recent_context(MAX_CONTEXT_MESSAGES):
        role = message.get("role")
        content = _clean_history_content(message.get("content"))
        if not content:
            continue

        # Old tool bookkeeping and old confirmation payloads are operational
        # records, not user-facing conversation context.
        if content.startswith("[Used tool:") or content.startswith("CONFIRM_ADD_PLACES "):
            continue
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))
    return messages


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and part.get("type") == "text":
                parts.append(str(part.get("text") or ""))
        return "".join(parts).strip()
    return str(content or "").strip()


async def run_chat(session_id: str, user_message: str) -> dict:
    """Answer one message with one ordinary chat-model invocation.

    The session transcript is saved for chat history, but no transcript is
    converted into user memory or a rolling summary. The response contract
    keeps the legacy fields so existing clients can upgrade independently.
    """
    session = conversation_manager.get_session(session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")

    message = (user_message or "").strip()
    if not message:
        raise ValueError("Message cannot be empty")

    session.add_message("user", message)
    provider = os.environ.get("CHAT_PROVIDER", "deepseek")
    model_name = os.environ.get("CHAT_MODEL", "deepseek-chat")
    model = get_chat_model(provider, model_name, temperature=0.3)
    prompt: list[BaseMessage] = [SystemMessage(content=_system_prompt(session))]
    prompt.extend(_history_messages(session))

    try:
        response = await asyncio.wait_for(model.ainvoke(prompt), timeout=CHAT_TIMEOUT)
        answer = _content_to_text(getattr(response, "content", response))
    except asyncio.TimeoutError:
        answer = "The response timed out. Please try again."
        status = "timeout"
        partial = True
    except Exception as error:
        answer = f"Sorry, I couldn't answer that right now: {error}"
        status = "error"
        partial = True
    else:
        answer = answer or "I don't have a response for that yet."
        status = "success"
        partial = False

    session.add_message("assistant", answer)
    # Persist the transcript only. In particular, do not call memory or
    # summary maintenance here.
    try:
        await conversation_manager.save_conversation(session.session_id)
    except Exception as error:
        print(f"[Chat] Failed to persist conversation: {error}")

    return {
        "session_id": session_id,
        "response": answer,
        "locations": session.locations,
        "route": session.route,
        "tool_calls_used": [],
        "status": status,
        "partial": partial,
        "pending_action": None,
        "place_cards": [],
    }
