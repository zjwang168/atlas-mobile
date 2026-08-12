"""Atlas LangGraph app.

This module exposes a Studio-friendly graph that routes all import / discovery
tasks through graph nodes while keeping the existing FastAPI routes stable.
"""

from __future__ import annotations

from typing import TypedDict, Literal, Optional, Any

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

TaskType = Literal[
    "parse_link",
    "parse_text",
    "scan_url",
    "parse_youtube",
    "parse_tiktok",
    "parse_instagram_reel",
    "parse_facebook_reel",
    "find_image_places",
    "atlas_ai_discover",
    "chat",
]


class AtlasState(TypedDict, total=False):
    task_type: TaskType
    request_id: str | None
    url: str | None
    text: str | None
    image: str | None
    image_base64: str | None
    image_mode: str | None
    title: str | None
    web_search: bool
    query: str | None
    session_id: str | None
    session: Any
    result: dict


def build_atlas_graph():
    graph = StateGraph(AtlasState)

    graph.add_node("dispatch", _dispatch)
    graph.add_node("parse_link", _parse_link)
    graph.add_node("parse_text", _parse_text)
    graph.add_node("scan_url", _scan_url)
    graph.add_node("parse_youtube", _parse_youtube)
    graph.add_node("parse_tiktok", _parse_tiktok)
    graph.add_node("parse_instagram_reel", _parse_instagram_reel)
    graph.add_node("parse_facebook_reel", _parse_facebook_reel)
    graph.add_node("find_image_places", _find_image_places)
    graph.add_node("atlas_ai_discover", _atlas_ai_discover)
    graph.add_node("chat", _chat)

    graph.set_entry_point("dispatch")
    graph.add_conditional_edges(
        "dispatch",
        _route_task,
        {
            "parse_link": "parse_link",
            "parse_text": "parse_text",
            "scan_url": "scan_url",
            "parse_youtube": "parse_youtube",
            "parse_tiktok": "parse_tiktok",
            "parse_instagram_reel": "parse_instagram_reel",
            "parse_facebook_reel": "parse_facebook_reel",
            "find_image_places": "find_image_places",
            "atlas_ai_discover": "atlas_ai_discover",
            "chat": "chat",
        },
    )

    for node in [
        "parse_link",
        "parse_text",
        "scan_url",
        "parse_youtube",
        "parse_tiktok",
        "parse_instagram_reel",
        "parse_facebook_reel",
        "find_image_places",
        "atlas_ai_discover",
        "chat",
    ]:
        graph.add_edge(node, END)

    return graph.compile(name="AtlasApp") 


async def _dispatch(state: AtlasState) -> AtlasState:
    return state


def _route_task(state: AtlasState) -> str:
    return state.get("task_type", "parse_text")


async def _parse_link(state: AtlasState) -> AtlasState:
    from backend.services.agent_orchestrator import agent_orchestrator
    from backend.services.conversation_manager import conversation_manager

    session = state.get("session") or conversation_manager.create_session()
    result = await agent_orchestrator.run_pipeline(state.get("url", "") or "", session, request_id=state.get("request_id"))
    state["session"] = session
    state["result"] = result
    return state


async def _parse_text(state: AtlasState) -> AtlasState:
    from backend.services.smart_text_service import analyze_smart_text

    result = await analyze_smart_text(
        state.get("text", "") or "",
        use_web_search=bool(state.get("web_search")),
        request_id=state.get("request_id"),
    )
    state["result"] = result
    return state


async def _scan_url(state: AtlasState) -> AtlasState:
    from backend.services.image_scanner import scan_text
    from backend.services.gemini_computer_use import extract_web_screenshots
    from backend.services.glm_ocr import ocr_images
    from backend.services.translation import translate_to_english

    shot_result = await extract_web_screenshots(state.get("url", "") or "")
    ocr_text = await ocr_images(shot_result.screenshots)
    ocr_text = await translate_to_english(ocr_text, request_id=state.get("request_id"))
    result = await scan_text(ocr_text)
    result["title"] = await translate_to_english(shot_result.title or state.get("url", "") or "", request_id=state.get("request_id"))
    state["result"] = result
    return state


async def _parse_youtube(state: AtlasState) -> AtlasState:
    from backend.services.youtube_places_service import parse_youtube_url

    state["result"] = await parse_youtube_url(state.get("url", "") or "", request_id=state.get("request_id"))
    return state


async def _parse_tiktok(state: AtlasState) -> AtlasState:
    from backend.services.tiktok_places_service import parse_tiktok_url

    state["result"] = await parse_tiktok_url(state.get("url", "") or "", request_id=state.get("request_id"))
    return state


async def _parse_instagram_reel(state: AtlasState) -> AtlasState:
    from backend.services.instagram_reels_service import parse_instagram_reel_url

    state["result"] = await parse_instagram_reel_url(state.get("url", "") or "", request_id=state.get("request_id"))
    return state


async def _parse_facebook_reel(state: AtlasState) -> AtlasState:
    from backend.services.facebook_reels_service import parse_facebook_reel_url

    state["result"] = await parse_facebook_reel_url(state.get("url", "") or "", request_id=state.get("request_id"))
    return state


async def _find_image_places(state: AtlasState) -> AtlasState:
    from backend.services.find_image_places_service import find_image_place

    state["result"] = await find_image_place(
        state.get("image", "") or "",
        request_id=state.get("request_id"),
    )
    return state


async def _atlas_ai_discover(state: AtlasState) -> AtlasState:
    from backend.services.atlas_ai_discovery import discover_places_from_query

    state["result"] = await discover_places_from_query(state.get("query", "") or "", request_id=state.get("request_id"))
    return state


async def _chat(state: AtlasState) -> AtlasState:
    from backend.langgraph.chat_agent import run_chat
    result = await run_chat(
        state.get("session_id", "") or "",
        state.get("text", "") or "",
        state.get("image_base64"),
        state.get("image_mode"),
    )
    state["result"] = result
    return state


app = build_atlas_graph()
