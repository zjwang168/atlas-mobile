"""FastAPI application entry point for the OurAtlas parse/fetch backend.

Run from project root:
    uvicorn backend.main:app --reload --reload-dir backend --port 8000

Endpoints:
  POST /parse_link          — Accept a URL, extract locations via agent pipeline, plan a route.
  GET  /places/search       — Typeahead place suggestions (no coordinates) via Mapbox Search Box.
  GET  /places/retrieve/{id}— Resolve one suggestion into saveable places.
  GET  /events              — Local events near a point, distance-sorted.
  POST /chat                — Continue conversation with the AI agent.
  GET  /sessions            — List all active sessions.
  POST /sessions/{id}/save  — Persist a session to Supabase.
  GET  /conversations       — List saved conversations from Supabase.
  GET  /conversations/{id}  — Load a full conversation from Supabase.
  DELETE /conversations/{id}— Delete a conversation from Supabase.
  GET  /health              — Health check.
"""

import logging
import os
import sys
import base64
import json
import asyncio
import time
from collections import OrderedDict
from typing import Optional
import httpx

from dotenv import load_dotenv

# 加载项目根目录的 .env 文件
dotenv_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
load_dotenv(dotenv_path)

from backend.services.observability import configure_langsmith

LANGSMITH_ENABLED = configure_langsmith()

# 配置 logging（确保 performance_logger 等的 logger.info() 调用可见）
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),        # 输出到 terminal
        logging.FileHandler("atlas-backend.log"),  # 输出到文件
    ],
)

# 设置 atlas 系列 logger 都使用 INFO 级别
logging.getLogger("atlas").setLevel(logging.INFO)

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.services import progress
from backend.services.conversation_manager import conversation_manager
from backend.services.gemini_computer_use import extract_web_text
from backend.services.place_image_service.place_image_service import (
    enrich_locations_with_photos,
    enrich_response_with_photos,
    fetch_photos_for_places,
    get_or_build_response,
)
from backend.services import events_service
from backend.services import place_search_service
from backend.services import landmark_service
from backend.services.link_preview import build_link_preview
from backend.services.translation import translate_to_english
from backend.langgraph.atlas_graph import app as atlas_graph_app

NO_PLACE_INFO = "No Place Information that can be extracted"

# Atlas discovery is intentionally ephemeral: a session lasts for one mounted
# Edit Atlas screen, while this bounded cache provides the next request with
# the prior turns needed to avoid repeating recommendations.
ATLAS_DISCOVERY_CONVERSATIONS: OrderedDict[str, list[dict[str, object]]] = OrderedDict()
ATLAS_DISCOVERY_CONVERSATION_LIMIT = 64


def atlas_discovery_context(session_id: Optional[str]) -> str:
    if not session_id:
        return ""
    turns = ATLAS_DISCOVERY_CONVERSATIONS.get(session_id, [])
    if not turns:
        return ""
    ATLAS_DISCOVERY_CONVERSATIONS.move_to_end(session_id)
    history = []
    for turn in turns[-12:]:
        names = "; ".join(turn["places"])
        history.append(f"User: {turn['query']}\nAtlas AI recommended: {names}")
    return "\n\nPrevious turns in this Atlas editing conversation:\n" + "\n\n".join(history)


def remember_atlas_discovery(session_id: Optional[str], query: str, locations: list[dict]) -> None:
    if not session_id:
        return
    places = [str(location.get("name") or "").strip() for location in locations]
    turns = ATLAS_DISCOVERY_CONVERSATIONS.setdefault(session_id, [])
    turns.append({"query": query[:800], "places": [name for name in places if name]})
    ATLAS_DISCOVERY_CONVERSATIONS.move_to_end(session_id)
    while len(ATLAS_DISCOVERY_CONVERSATIONS) > ATLAS_DISCOVERY_CONVERSATION_LIMIT:
        ATLAS_DISCOVERY_CONVERSATIONS.popitem(last=False)

app = FastAPI(
    title="OurAtlas Parse & Fetch API",
    version="2.0.0",
    description="Agentic URL → Location extraction → Route planning → Chat",
)

# ---------------------------------------------------------------------------
# User-identity pass-through: the mobile app sends the user's Supabase JWT in
# the Authorization header; we stash it per-request so supabase_service can
# write/read AS that user (RLS: auth.uid() resolves correctly).
# ---------------------------------------------------------------------------
from backend.services.request_context import set_user_token

@app.middleware("http")
async def user_token_middleware(request, call_next):
    auth = request.headers.get("authorization") or ""
    token = auth[7:] if auth.lower().startswith("bearer ") else None
    set_user_token(token)
    try:
        return await call_next(request)
    finally:
        set_user_token(None)

# Store LangSmith state so health endpoints / middleware can inspect it
app.state.langsmith_enabled = LANGSMITH_ENABLED

# Allow CORS from any origin (for local development)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----Pydantic 模型 ----


class ParseRequest(BaseModel):
    url: str
    request_id: Optional[str] = None


class ParseTextRequest(BaseModel):
    text: str
    request_id: Optional[str] = None
    web_search: bool = False


class AtlasRouteRequest(BaseModel):
    coordinates: list[tuple[float, float]]


class CreateSessionRequest(BaseModel):
    title: str = ""
    source_url: Optional[str] = None
    source_type: Optional[str] = None
    locations: Optional[list[dict]] = None
    user_location: Optional[tuple[float, float]] = None


class ImportWelcomeRequest(BaseModel):
    deselected_locations: list[dict] = []
    welcome_text: Optional[str] = None


class AtlasWelcomeRequest(BaseModel):
    locations: list[dict] = []


class AtlasDiscoverRequest(BaseModel):
    query: str
    request_id: Optional[str] = None
    session_id: Optional[str] = None
    exclude_place_names: list[str] = []


class LocationItem(BaseModel):
    name: str
    latitude: float
    longitude: float
    full_address: str
    sentiment: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    is_exact: Optional[bool] = None
    confidence: Optional[float] = None
    provisional: Optional[bool] = None
    geocode_verified: Optional[bool] = None
    source: Optional[str] = None
    photo_url: Optional[str] = None
    # Provider's own id for this place, paired with `source`. Populated by
    # /places/retrieve so a saved place can be matched back to the provider;
    # the parse pipelines leave it unset.
    external_id: Optional[str] = None
    city: Optional[str] = None
    region: Optional[str] = None
    country: Optional[str] = None


class LandmarkSeedItem(BaseModel):
    id: str
    name: str
    longitude: float
    latitude: float
    category: str
    source: str
    wikidata_id: str
    distance_km: float
    importance_score: float


class LandmarkSeedResponse(BaseModel):
    landmarks: list[LandmarkSeedItem]


class RouteSegment(BaseModel):
    from_name: str
    to_name: str
    distance_km: float


class RouteResult(BaseModel):
    ordered_locations: list[LocationItem]
    total_distance_km: float
    segments: list[RouteSegment]


class HierarchyInfo(BaseModel):
    name: str
    reason: str = ""
    parent_of: Optional[str] = None


class NoiseInfo(BaseModel):
    name: str
    reason: str = ""


class ParseResponse(BaseModel):
    title: str
    source_thumbnail: Optional[str] = None
    locations: list[LocationItem]
    route: RouteResult
    removed_noise: Optional[list[NoiseInfo | str]] = None
    session_id: Optional[str] = None
    removed_hierarchy: Optional[list[HierarchyInfo | str]] = None
    inferred_region: Optional[str] = None
    source_type: Optional[str] = None


class ChatRequest(BaseModel):
    session_id: str
    message: str
    conversation_id: Optional[str] = None
    # The app supplies the foreground GPS coordinate as [longitude, latitude]
    # only for this request. It is never inferred by the model.
    user_location: Optional[tuple[float, float]] = None
    special_places: list[dict] = []
    # Request-scoped image attachment. Chat routes it through the same Add
    # Place image tools; it is never included in the chat model prompt.
    image_base64: Optional[str] = None
    image_mode: Optional[str] = None


class ChatActionConfirmationRequest(BaseModel):
    session_id: str
    action_id: str
    accepted: bool
    outcome: Optional[dict] = None


class MemoryRequest(BaseModel):
    session_id: str
    key: str
    value: str
    category: str = "preference"


class SessionResponse(BaseModel):
    session_id: str
    conversation_id: Optional[str] = None
    title: str = ""
    location_count: int = 0
    message_count: int = 0


class ScrapeUrlRequest(BaseModel):
    url: str
    request_id: Optional[str] = None


class ScanUrlRequest(BaseModel):
    url: str
    request_id: Optional[str] = None


class YouTubeParseRequest(BaseModel):
    url: str
    request_id: Optional[str] = None


class TikTokParseRequest(BaseModel):
    url: str
    request_id: Optional[str] = None


class InstagramReelParseRequest(BaseModel):
    url: str
    request_id: Optional[str] = None


class FacebookReelParseRequest(BaseModel):
    url: str
    request_id: Optional[str] = None


class LinkPreviewRequest(BaseModel):
    url: str


class ErrorResponse(BaseModel):
    detail: str


class PlaceSuggestion(BaseModel):
    """One search candidate. Deliberately has no coordinates — /suggest does not
    return any, and asking for them is what /places/retrieve is for."""
    external_id: str
    name: str
    feature_type: str  # 'poi' is one place; 'brand' expands to several on retrieve
    place_formatted: Optional[str] = None
    full_address: Optional[str] = None
    category: Optional[str] = None
    distance_m: Optional[int] = None
    source: str = "mapbox"


class PlaceSuggestResponse(BaseModel):
    query: str
    session_token: str
    suggestions: list[PlaceSuggestion]
    attribution: str


class PlaceRetrieveResponse(BaseModel):
    # Reuses LocationItem so the client adapts these exactly like parse results.
    locations: list[LocationItem]
    attribution: str


class EventItem(BaseModel):
    id: str
    source: str                          # "usda" | "nps" | "curated"
    title: str
    category: str                        # one of events_service.CATEGORIES
    # A dated event fills starts_at; a recurring one (a market, a season-long
    # festival) leaves it null and fills schedule_text instead. Clients branch
    # on which is present, not on `source`.
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None
    schedule_text: Optional[str] = None
    location_name: Optional[str] = None
    address: Optional[str] = None
    # Never null: a row a source could not place is dropped upstream.
    latitude: float
    longitude: float
    distance_km: float
    url: Optional[str] = None
    image_url: Optional[str] = None
    image_attribution: Optional[str] = None   # e.g. "NPS"; null for stock imagery
    image_is_stock: bool = False              # generic category photo, not of this event
    blurb: Optional[str] = None
    is_free: Optional[bool] = None
    featured: bool = False               # signature event; protected from `limit`


class EventSourceStatus(BaseModel):
    id: str
    status: str                          # "ok" | "unavailable" | "not_configured"
    count: int
    detail: Optional[str] = None


class EventsResponse(BaseModel):
    events: list[EventItem]
    # Per-source outcome, so a client can say which feed is missing rather than
    # showing a short list as if it were complete.
    sources: list[EventSourceStatus]
    attribution: str
    radius_km: float
    window_days: int


# ---- Endpoints ----


@app.post("/scrape_url", response_model=ParseResponse,responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def scrape_url(req: ScrapeUrlRequest):
    """Extract a URL with Gemini computer use, then parse the extracted text."""
    url = req.url.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    session = conversation_manager.create_session()
    session.source_url = url

    try:
        progress.start(req.request_id, "Opening page.") if req.request_id else None
        progress.stream_note(req.request_id, "Fetching source", {"detail": "Opening the page and preparing to read the source."})

        scraped = await extract_web_text(url)
        if not scraped.success or not scraped.text.strip():
            raise ValueError(NO_PLACE_INFO)

        progress.mark(req.request_id, "source_fetched", "Source prepared.", {
            "title": scraped.title or url,
            "characters": len(scraped.text),
            "source_type": "gemini_computer_use",
            "provider": scraped.provider,
        })
        scraped_title = await translate_to_english(scraped.title or url, request_id=req.request_id)
        english_text = await translate_to_english(scraped.text, request_id=req.request_id)
        progress.stream_note(req.request_id, "Analyzing source", {"detail": "Source content is ready; extracting place clues next."})

        result = await agent_orchestrator.run_pipeline_from_text(
            english_text,
            session,
            request_id=req.request_id,
            title=scraped_title or url,
            source_type="web_scrape",
        )
        result["title"] = scraped_title or result.get("title") or url
        result["source_type"] = "web_scrape"
        # Non-URL-cache endpoints enrich immediately before serialization so
        # clients receive `photo_url` without doing device-side Wikipedia calls.
        await enrich_response_with_photos(result)
        return ParseResponse(**result)
    except ValueError as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=500, detail=f"Scrape failed: {e}")


@app.post("/scan_url", response_model=ParseResponse,
          responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def scan_url(req: ScanUrlRequest):
    """Legacy Any Links endpoint, now backed by the Universal Web Agent.

    Kept for installed clients; new clients call /parse_link directly. Both
    routes use the same HTTP reader -> Playwright -> place extraction pipeline.
    """
    url = req.url.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    session = conversation_manager.create_session()
    session.source_url = url

    try:
        progress.start(req.request_id, "Opening page.") if req.request_id else None
        progress.stream_note(req.request_id, "Fetching source", {"detail": "Reading the webpage and its travel details."})
        state = await atlas_graph_app.ainvoke(
            {
                "task_type": "parse_link",
                "url": url,
                "request_id": req.request_id,
                "session": session,
            },
            config={
                "configurable": {"thread_id": req.request_id or session.session_id},
                "run_name": "AtlasApp:universal_web",
            },
        )
        result = state.get("result", {})
        progress.mark(req.request_id, "geocode_done", "Coordinates resolved.", {
            "query_count": len(result.get("locations", [])),
            "resolved_count": len(result.get("locations", [])),
        })
        progress.finish(req.request_id, {"location_count": len(result.get("locations", []))})
        await enrich_response_with_photos(result)
        return ParseResponse(**result)
    except ValueError as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=500, detail=f"Any Links import failed: {e}")


@app.post("/parse_youtube", response_model=ParseResponse,
          responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def parse_youtube(req: YouTubeParseRequest):
    """Identify places from a YouTube video's transcript and chapters."""
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="No YouTube URL provided.")

    session = conversation_manager.create_session()
    session.source_url = url

    try:
        progress.start(req.request_id, "Opening video.") if req.request_id else None
        progress.stream_note(req.request_id, "youtube:fetch", {"detail": "Fetching transcript and chapters."})
        state = await atlas_graph_app.ainvoke(
            {
                "task_type": "parse_youtube",
                "url": url,
                "request_id": req.request_id,
                "session": session,
            },
            config={
                "configurable": {"thread_id": req.request_id or session.session_id},
                "run_name": "AtlasApp:parse_youtube",
            },
        )
        result = state.get("result", {})
        result["source_type"] = "youtube_links"

        progress.mark(req.request_id, "geocode_done", "Coordinates resolved.", {
            "query_count": len(result.get("locations", [])),
            "resolved_count": len(result.get("locations", [])),
        })
        progress.finish(req.request_id, {"location_count": len(result.get("locations", []))})

        locs = result.get("locations", [])
        print(f"\n{'='*50}")
        print(f"📺 YouTube URL: {url[:80]}")
        print(f"📍 Locations ({len(locs)}):")
        for i, loc in enumerate(locs):
            print(f"   {i+1}. {loc['name']:30s} ({loc['latitude']:.4f}, {loc['longitude']:.4f})")
        print(f"{'='*50}\n")

        # YouTube parsing has its own builder, so enrich the final response
        # here instead of relying on the parse_link cache wrapper.
        await enrich_response_with_photos(result)
        return ParseResponse(**result)
    except ValueError as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=500, detail=f"YouTube parse failed: {e}")


@app.post("/parse_tiktok", response_model=ParseResponse,
          responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def parse_tiktok(req: TikTokParseRequest):
    """Identify places from a public TikTok video's caption and metadata."""
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="No TikTok URL provided.")

    session = conversation_manager.create_session()
    session.source_url = url
    try:
        progress.start(req.request_id, "Opening TikTok video.") if req.request_id else None
        state = await atlas_graph_app.ainvoke(
            {
                "task_type": "parse_tiktok",
                "url": url,
                "request_id": req.request_id,
                "session": session,
            },
            config={
                "configurable": {"thread_id": req.request_id or session.session_id},
                "run_name": "AtlasApp:parse_tiktok",
            },
        )
        result = state.get("result", {})
        result["source_type"] = "tiktok_links"
        progress.mark(req.request_id, "geocode_done", "Coordinates resolved.", {
            "query_count": len(result.get("locations", [])),
            "resolved_count": len(result.get("locations", [])),
        })
        progress.finish(req.request_id, {"location_count": len(result.get("locations", []))})
        await enrich_response_with_photos(result)
        return ParseResponse(**result)
    except ValueError as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=500, detail=f"TikTok parse failed: {e}")


@app.post("/parse_instagram_reel", response_model=ParseResponse,
          responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def parse_instagram_reel(req: InstagramReelParseRequest):
    """Identify places from a public Instagram Reel and optional transcript."""
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="No Instagram Reel URL provided.")

    session = conversation_manager.create_session()
    session.source_url = url
    try:
        progress.start(req.request_id, "Opening Instagram Reel.") if req.request_id else None
        state = await atlas_graph_app.ainvoke(
            {
                "task_type": "parse_instagram_reel",
                "url": url,
                "request_id": req.request_id,
                "session": session,
            },
            config={
                "configurable": {"thread_id": req.request_id or session.session_id},
                "run_name": "AtlasApp:parse_instagram_reel",
            },
        )
        result = state.get("result", {})
        result["source_type"] = "instagram_reels"
        progress.mark(req.request_id, "geocode_done", "Coordinates resolved.", {
            "query_count": len(result.get("locations", [])),
            "resolved_count": len(result.get("locations", [])),
        })
        progress.finish(req.request_id, {"location_count": len(result.get("locations", []))})
        await enrich_response_with_photos(result)
        return ParseResponse(**result)
    except ValueError as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=500, detail=f"Instagram Reel parse failed: {e}")


@app.post("/parse_facebook_reel", response_model=ParseResponse,
          responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def parse_facebook_reel(req: FacebookReelParseRequest):
    """Identify places from a public Facebook Reel or share video."""
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="No Facebook Reel URL provided.")

    session = conversation_manager.create_session()
    session.source_url = url
    try:
        progress.start(req.request_id, "Opening Facebook Reel.") if req.request_id else None
        state = await atlas_graph_app.ainvoke(
            {
                "task_type": "parse_facebook_reel",
                "url": url,
                "request_id": req.request_id,
                "session": session,
            },
            config={
                "configurable": {"thread_id": req.request_id or session.session_id},
                "run_name": "AtlasApp:parse_facebook_reel",
            },
        )
        result = state.get("result", {})
        result["source_type"] = "facebook_reels"
        progress.mark(req.request_id, "geocode_done", "Coordinates resolved.", {
            "query_count": len(result.get("locations", [])),
            "resolved_count": len(result.get("locations", [])),
        })
        progress.finish(req.request_id, {"location_count": len(result.get("locations", []))})
        await enrich_response_with_photos(result)
        return ParseResponse(**result)
    except ValueError as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=500, detail=f"Facebook Reel parse failed: {e}")


@app.post("/parse_link", response_model=ParseResponse,
          responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def parse_link(req: ParseRequest) -> ParseResponse:
    """Parse a URL, extract locations via LLM, geocode, and plan a route.

    Uses the agentic pipeline (AgentOrchestrator) under the hood.
    Results are cached in-memory for subsequent requests.
    """
    # Create session
    session = conversation_manager.create_session()

    try:
        async def build_response() -> dict:
            progress.start(req.request_id, "Fetching source content.") if req.request_id else None
            progress.stream_note(req.request_id, "Fetching source", {"detail": "Fetching and routing the link before parsing."})
            result_state = await atlas_graph_app.ainvoke(
                {
                    "task_type": "parse_link",
                    "url": req.url,
                    "request_id": req.request_id,
                    "session": session,
                },
                config={
                    "configurable": {"thread_id": req.request_id or session.session_id},
                    "run_name": "AtlasApp:parse_link",
                },
            )
            result = result_state.get("result", {})
            return {
                "title": result["title"],
                "locations": result["locations"],
                "route": result["route"],
                "removed_noise": result.get("removed_noise", []),
                "session_id": result.get("session_id", session.session_id),
                "removed_hierarchy": result.get("removed_hierarchy", []),
                "inferred_region": result.get("inferred_region"),
                "source_type": result.get("source_type"),
            }

        # Photo enrichment entry point 1: normal FastAPI response bundling.
        # This wrapper runs the photo service immediately before ParseResponse
        # serialization, including old URL-cache hits that were saved before
        # photo_url existed.
        response_data = await get_or_build_response(req.url, build_response)
        progress.finish(req.request_id, {"location_count": len(response_data["locations"])})

        # Server-side log
        locs = response_data.get("locations", [])
        print(f"\n{'='*50}")
        print(f"📌 URL: {req.url[:80]}")
        print(f"📍 Locations ({len(locs)}):")
        for i, loc in enumerate(locs):
            print(f"   {i+1}. {loc['name']:30s} ({loc['latitude']:.4f}, {loc['longitude']:.4f})")
        rh = response_data.get("removed_hierarchy", [])
        if rh:
            print(f"🗂️ Hierarchy removed ({len(rh)}):")
            for h in rh:
                n = h.get('name', h) if isinstance(h, dict) else h
                print(f"   - {n}")
        rn = response_data.get("removed_noise", [])
        if rn:
            print(f"🔇 Noise removed ({len(rn)}):")
            for n in rn:
                nm = n.get('name', n) if isinstance(n, dict) else n
                r = n.get('reason', '') if isinstance(n, dict) else ''
                print(f"   - {nm}: {r[:60]}")
        print(f"{'='*50}\n")

        return ParseResponse(**response_data)

    except ValueError as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")


@app.post("/link_preview")
async def link_preview(req: LinkPreviewRequest) -> dict:
    """Return lightweight display metadata before a user imports a link."""
    try:
        return await build_link_preview(req.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# --- Chat & Conversation Endpoints ---


@app.post("/parse_text", response_model=ParseResponse,
          responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def parse_text(req: ParseTextRequest) -> ParseResponse:
    """Parse user-pasted text, extract locations via LLM, geocode, plan a route.

    Same pipeline as /parse_link but skips scraping — for sources we can't
    scrape (Xiaohongshu, WeChat articles, copied text). No caching: pasted
    text has no stable key.
    """
    text = (req.text or "").strip()

    session = conversation_manager.create_session()

    try:
        progress.start(req.request_id, "Reading pasted content.") if req.request_id else None
        progress.stream_note(req.request_id, "Analyzing text", {"detail": "Reading pasted text and extracting place references."})
        result_state = await atlas_graph_app.ainvoke(
            {
                "task_type": "parse_text",
                "text": text,
                "web_search": req.web_search,
                "request_id": req.request_id,
                "session": session,
            },
            config={
                "configurable": {"thread_id": req.request_id or session.session_id},
                "run_name": "AtlasApp:parse_text",
            },
        )
        result = result_state.get("result", {})
        session.title = result["title"]
        session.source_type = result.get("source_type")
        session.locations = result.get("locations", [])
        session.route = result.get("route")
        session.removed_noise = result.get("removed_noise", [])
        session.removed_hierarchy = result.get("removed_hierarchy", [])
        session.inferred_region = result.get("inferred_region")

        progress.mark(req.request_id, "source_fetched", "Source prepared.", {
            "title": session.title,
            "characters": len(text),
            "source_type": session.source_type,
        })
        progress.mark(req.request_id, "entity_linking_done", "Places identified.", {
            "location_count": len(result.get("locations", [])),
            "inferred_region": result.get("inferred_region"),
        })
        progress.mark(req.request_id, "geocode_done", "Coordinates resolved.", {
            "query_count": len(result.get("locations", [])),
            "resolved_count": len(result.get("locations", [])),
        })

        response_data = {
            "title": result["title"],
            "locations": result["locations"],
            "route": result["route"],
            "removed_noise": result.get("removed_noise", []),
            "session_id": result.get("session_id", session.session_id),
            "removed_hierarchy": result.get("removed_hierarchy", []),
            "inferred_region": result.get("inferred_region"),
            "source_type": result.get("source_type"),
        }

        locs = result.get("locations", [])
        print(f"\n{'='*50}")
        print(f"📋 TEXT ({len(text)} chars): {result['title'][:60]}")
        print(f"📍 Locations ({len(locs)}):")
        for i, loc in enumerate(locs):
            print(f"   {i+1}. {loc['name']:30s} ({loc['latitude']:.4f}, {loc['longitude']:.4f})")

        progress.finish(req.request_id, {"location_count": len(response_data["locations"])})
        # Pasted text has no stable URL cache key, so enrich only the response
        # being returned for this request.
        await enrich_response_with_photos(response_data)
        return ParseResponse(**response_data)

    except ValueError as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import traceback
        traceback.print_exc()
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=500, detail=f"Internal error: {e}")


@app.post("/chat")
async def chat(req: ChatRequest) -> dict:
    """Continue conversation with the AI agent."""
    try:
        from backend.services.conversation_manager import conversation_manager

        async def _recover_session(session_key: str, conversation_key: str | None = None):
            session = conversation_manager.get_session(session_key)
            if session:
                return session

            # Try exact conversation/session id restore first.
            session = await conversation_manager.load_conversation(session_key)
            if session:
                return session

            if conversation_key:
                session = await conversation_manager.load_conversation(conversation_key)
                if session:
                    return session
            return None

        session = await _recover_session(req.session_id, req.conversation_id)
        if session:
            req_session_id = session.session_id
            if req.user_location:
                session.user_location = req.user_location
            session.special_places = req.special_places
        else:
            raise ValueError(f"Session {req.session_id} not found")

        state = await atlas_graph_app.ainvoke(
            {
                "task_type": "chat",
                "session_id": req_session_id,
                "text": req.message,
                "image_base64": req.image_base64,
                "image_mode": req.image_mode,
            },
            config={
                "configurable": {"thread_id": req_session_id},
                "run_name": "AtlasApp:chat",
            },
        )
        return state.get("result", {})
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat error: {e}")


@app.post("/chat/stream")
async def stream_chat(req: ChatRequest) -> StreamingResponse:
    """Stream display-safe chat deltas as newline-delimited JSON."""
    try:
        from backend.langgraph.chat_agent import stream_chat as run_stream_chat

        async def _recover_session(session_key: str, conversation_key: str | None = None):
            session = conversation_manager.get_session(session_key)
            if session:
                return session
            session = await conversation_manager.load_conversation(session_key)
            if session:
                return session
            if conversation_key:
                return await conversation_manager.load_conversation(conversation_key)
            return None

        session = await _recover_session(req.session_id, req.conversation_id)
        if not session:
            raise ValueError(f"Session {req.session_id} not found")
        if req.user_location:
            session.user_location = req.user_location
        session.special_places = req.special_places

        async def event_stream():
            try:
                async for event in run_stream_chat(
                    session.session_id,
                    req.message,
                    req.image_base64,
                    req.image_mode,
                ):
                    yield json.dumps(event, ensure_ascii=False) + "\n"
            except ValueError as error:
                yield json.dumps({"type": "error", "message": str(error)}) + "\n"
            except Exception:
                yield json.dumps({"type": "error", "message": "Chat streaming failed. Please try again."}) + "\n"

        return StreamingResponse(
            event_stream(),
            media_type="application/x-ndjson",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/chat/actions/confirm")
async def confirm_chat_action(req: ChatActionConfirmationRequest) -> dict:
    """Record a client-confirmed Atlas proposal without performing a write.

    Atlas and place writes stay in the authenticated mobile domain layer. This
    endpoint only gives the next agent turn an auditable fact about the user's
    decision, preventing a proposal from being treated as already applied.
    """
    session = conversation_manager.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {req.session_id} not found")
    actions = getattr(session, "pending_chat_actions", []) or []
    action = next((item for item in actions if item.get("action_id") == req.action_id), None)
    if not action and session.pending_chat_action and session.pending_chat_action.get("action_id") == req.action_id:
        action = session.pending_chat_action
    # This endpoint only records an audit event; the client has already used
    # authenticated domain services for the actual write. Accept a replay
    # after a backend restart instead of reporting a false user-facing error.
    if (actions or session.pending_chat_action) and not action:
        raise HTTPException(status_code=409, detail="This chat action is no longer pending")

    outcome = req.outcome or {}
    event = {
        "action_id": req.action_id,
        "kind": action.get("kind") if action else "unknown",
        "accepted": req.accepted,
        "outcome": outcome,
    }
    session.add_message("tool", "chat_action_confirmation", tool_results=event)
    session.pending_chat_actions = [item for item in actions if item.get("action_id") != req.action_id]
    if session.pending_chat_action and session.pending_chat_action.get("action_id") == req.action_id:
        session.pending_chat_action = session.pending_chat_actions[-1] if session.pending_chat_actions else None
    try:
        await conversation_manager.save_conversation(session.session_id)
    except Exception:
        pass
    return {"status": "recorded", "event": event}


@app.post("/atlas_ai/discover", response_model=ParseResponse,
          responses={400: {"model": ErrorResponse}, 502: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def atlas_ai_discover(req: AtlasDiscoverRequest) -> ParseResponse:
    """Use DeepSeek to research exact addresses, then geocode those addresses."""
    query = (req.query or "").strip()
    if len(query) < 6:
        raise HTTPException(status_code=400, detail=NO_PLACE_INFO)

    try:
        progress.start(req.request_id, "Researching places from your request.") if req.request_id else None
        progress.stream_note(req.request_id, "Researching places", {"detail": "Researching the request and collecting candidate places."})
        query = await translate_to_english(query, request_id=req.request_id)
        progress.mark(req.request_id, "source_fetched", "Source prepared.", {
            "title": query[:80],
            "characters": len(query),
            "source_type": "atlas_ai",
        })
        original_query = query
        query += atlas_discovery_context(req.session_id)
        excluded_names = [name.strip() for name in req.exclude_place_names if name and name.strip()]
        if excluded_names:
            query += "\n\nThis is a follow-up in the same Atlas editing conversation. Do not repeat any of these places already recommended in this session: " + "; ".join(excluded_names[:120]) + ". Return different real places only."
        result_state = await atlas_graph_app.ainvoke(
            {
                "task_type": "atlas_ai_discover",
                "query": query,
                "request_id": req.request_id,
            },
            config={
                "configurable": {"thread_id": req.session_id or req.request_id or query[:32]},
                "run_name": "AtlasApp:atlas_ai_discover",
            },
        )
        result = result_state.get("result", {})
        remember_atlas_discovery(req.session_id, original_query, result.get("locations", []))
        progress.mark(req.request_id, "entity_linking_done", "Places identified.", {
            "location_count": len(result.get("locations", [])),
            "inferred_region": result.get("inferred_region"),
        })
        progress.mark(req.request_id, "geocode_done", "Coordinates resolved.", {
            "query_count": len(result.get("locations", [])),
            "resolved_count": len(result.get("locations", [])),
        })
        progress.finish(req.request_id, {"location_count": len(result.get("locations", []))})
        # Discovery responses are built outside the parse_link cache path but
        # still share the name-keyed photo cache inside the enrichment service.
        await enrich_response_with_photos(result)
        return ParseResponse(**result)
    except Exception as e:
        from backend.services.atlas_ai_discovery import AtlasDiscoveryUnavailable
        if isinstance(e, AtlasDiscoveryUnavailable):
            logging.getLogger("atlas.atlas_ai_discovery").warning(
                "Atlas discovery unavailable | candidates=%s provisional=%s geocoded=%s reason=%s",
                e.candidate_count, e.provisional_count, e.geocoded_count, e,
            )
            progress.fail(req.request_id, str(e))
            raise HTTPException(status_code=502, detail=str(e)) from e
        if isinstance(e, ValueError):
            # This endpoint's only client-input validation is above. Any
            # ValueError here comes from model/output processing, not a bad
            # request payload, so it must not be reported as HTTP 400.
            logging.getLogger("atlas.atlas_ai_discovery").exception("Atlas discovery processing failed")
            progress.fail(req.request_id, str(e))
            raise HTTPException(status_code=502, detail="Atlas AI could not process the place response.") from e
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=500, detail=f"Atlas AI discovery failed: {e}") from e


def _place_search_http_error(exc: Exception) -> HTTPException:
    """Map a search-service failure onto the response contract."""
    if isinstance(exc, place_search_service.RateLimited):
        headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
        return HTTPException(status_code=429, detail="Place search is rate limited", headers=headers)
    return HTTPException(status_code=502, detail=f"Place search upstream failed: {exc}")


@app.post("/atlas/route")
async def atlas_route(req: AtlasRouteRequest) -> dict:
    """Return a walking-network route for Atlas points, without exposing the key."""
    if len(req.coordinates) < 2:
        raise HTTPException(status_code=422, detail="At least two coordinates are required")
    if len(req.coordinates) > 25:
        raise HTTPException(status_code=422, detail="An Atlas route supports up to 25 places")
    token = os.getenv("MAPBOX_ACCESS_TOKEN")
    if not token:
        raise HTTPException(status_code=503, detail="Map routing is not configured")
    coordinate_string = ";".join(f"{longitude},{latitude}" for longitude, latitude in req.coordinates)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"https://api.mapbox.com/directions/v5/mapbox/walking/{coordinate_string}",
                params={"access_token": token, "geometries": "geojson", "overview": "full"},
            )
            response.raise_for_status()
        route = (response.json().get("routes") or [None])[0]
        if not route or not route.get("geometry"):
            raise ValueError("No route returned")
        return {
            "route": {"type": "Feature", "properties": {}, "geometry": route["geometry"]},
            "distance_km": round(float(route.get("distance", 0)) / 1000, 2),
            "duration_minutes": round(float(route.get("duration", 0)) / 60),
        }
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Map routing failed: {exc}")
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/speech/transcribe")
async def speech_transcribe(file: UploadFile = File(...)) -> dict:
    """Transcribe a short voice note with Groq Whisper Large V3 Turbo."""
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Speech recognition is not configured")

    audio = await file.read()
    if not audio:
        raise HTTPException(status_code=422, detail="No audio received")
    if len(audio) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Voice note is too large")

    # Groq accepts m4a and the other audio types emitted by supported clients.
    filename = file.filename or "atlas-note.m4a"
    content_type = file.content_type or "audio/m4a"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                data={
                    "model": "whisper-large-v3-turbo",
                    "response_format": "json",
                },
                files={"file": (filename, audio, content_type)},
            )
        if response.status_code == 429:
            retry_after = response.headers.get("retry-after")
            headers = {"Retry-After": retry_after} if retry_after else None
            raise HTTPException(status_code=429, detail="Speech recognition is rate limited", headers=headers)
        response.raise_for_status()
        payload = response.json()
        text = payload.get("text", "") if isinstance(payload, dict) else ""
        return {"text": text if isinstance(text, str) else ""}
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        logging.getLogger("atlas").warning(
            "Groq speech recognition failed with status %s", exc.response.status_code
        )
        raise HTTPException(status_code=502, detail="Speech recognition failed") from exc
    except (httpx.HTTPError, ValueError) as exc:
        logging.getLogger("atlas").exception("Groq speech recognition failed")
        raise HTTPException(status_code=502, detail="Speech recognition failed") from exc


@app.post("/atlas/notes/transcribe")
async def atlas_note_transcribe(file: UploadFile = File(...)) -> dict:
    """Transcribe a short recording made from an Edit Atlas place note."""
    logging.getLogger("atlas.notes").info("Atlas note transcription requested: %s", file.filename or "unnamed audio")
    return await speech_transcribe(file)


@app.get("/landmarks/seed", response_model=LandmarkSeedResponse,
         responses={422: {"model": ErrorResponse}, 502: {"model": ErrorResponse}})
async def landmark_seed(
    lng: float = Query(..., ge=-180, le=180),
    lat: float = Query(..., ge=-90, le=90),
    radius_km: float = Query(12, gt=0, le=12),
) -> LandmarkSeedResponse:
    """Return structured Wikidata landmarks ranked for a new Atlas seed."""
    try:
        landmarks = await landmark_service.landmarks_near(lng, lat, radius_km)
    except httpx.HTTPError as exc:
        logging.getLogger("atlas.landmarks").warning(
            "Wikidata landmark lookup failed for %s,%s: %s", lng, lat, type(exc).__name__
        )
        raise HTTPException(status_code=502, detail="Landmark index is unavailable") from exc
    return LandmarkSeedResponse(landmarks=[LandmarkSeedItem(**item) for item in landmarks])


@app.get("/places/search", response_model=PlaceSuggestResponse,
         responses={422: {"model": ErrorResponse}, 429: {"model": ErrorResponse},
                    502: {"model": ErrorResponse}})
async def places_search(
    q: str = Query(..., min_length=1, description="Search text, as typed"),
    session_token: str = Query(
        ...,
        min_length=1,
        max_length=128,
        description=(
            "Client-generated search session id (UUID v4). Mapbox bills one session "
            "rather than each keystroke, so the client owns its lifetime: keep one "
            "token for a whole typing session and pass the same one to "
            "/places/retrieve. The server never generates or rotates it."
        ),
    ),
    proximity: Optional[str] = Query(None, description='"lng,lat" to bias results toward the user'),
    limit: int = Query(10, ge=1, le=10),
    language: str = Query("en"),
    country: Optional[str] = Query(None, description="ISO 3166-1 alpha-2 filter"),
    types: Optional[str] = Query(None, description="Comma-separated Mapbox feature types"),
    bbox: Optional[str] = Query(None, description="west,south,east,north bounds restricting results"),
) -> PlaceSuggestResponse:
    """Suggest places for a partial query. Results carry no coordinates."""
    logging.getLogger("atlas.place_search").info(
        "Place suggest request | q=%r proximity=%s bbox=%s types=%s",
        q, proximity, bbox, types,
    )
    try:
        suggestions = await place_search_service.suggest(
            q, session_token,
            proximity=proximity, limit=limit, language=language, country=country,
            types=types, bbox=bbox,
        )
    except Exception as e:
        raise _place_search_http_error(e)

    logging.getLogger("atlas.place_search").info(
        "Place suggest response | q=%r count=%s bbox=%s",
        q, len(suggestions), bbox,
    )
    return PlaceSuggestResponse(
        query=q,
        session_token=session_token,
        suggestions=[PlaceSuggestion(**item) for item in suggestions],
        attribution=place_search_service.ATTRIBUTION,
    )


@app.get("/places/retrieve/{mapbox_id}", response_model=PlaceRetrieveResponse,
         responses={404: {"model": ErrorResponse}, 422: {"model": ErrorResponse},
                    429: {"model": ErrorResponse}, 502: {"model": ErrorResponse}})
async def places_retrieve(
    mapbox_id: str,
    session_token: str = Query(..., min_length=1, max_length=128,
                               description="The same token used for /places/search"),
) -> PlaceRetrieveResponse:
    """Resolve one suggestion into saveable places.

    Returns a list because a `brand` suggestion resolves to every branch Mapbox
    knows about, not to a single location.
    """
    try:
        locations = await place_search_service.retrieve(mapbox_id, session_token)
    except Exception as e:
        raise _place_search_http_error(e)

    if not locations:
        raise HTTPException(status_code=404, detail="No place found for that id")

    # Photo enrichment entry point 3: place search. Mapbox carries no imagery,
    # so without this a place saved from search is the only one that lands with
    # a null photo_url — every parse path already enriches before returning.
    # Best-effort like the others: a photo failure must not fail the retrieve
    # the user is waiting on to save.
    try:
        await enrich_locations_with_photos(locations)
    except Exception as e:
        print(f"[places_retrieve] photo enrichment failed, returning without photos: {e}")

    return PlaceRetrieveResponse(
        locations=[LocationItem(**item) for item in locations],
        attribution=place_search_service.ATTRIBUTION,
    )


@app.get("/events", response_model=EventsResponse,
         responses={422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}})
async def list_events(
    lat: float = Query(..., ge=-90, le=90, description="Latitude to search around"),
    lng: float = Query(..., ge=-180, le=180, description="Longitude to search around"),
    radius_km: float = Query(
        events_service.DEFAULT_RADIUS_KM, gt=0, le=events_service.MAX_RADIUS_KM
    ),
    window_days: int = Query(
        events_service.DEFAULT_WINDOW_DAYS, ge=1, le=events_service.MAX_WINDOW_DAYS,
        description="How far ahead to look for dated events",
    ),
    categories: Optional[str] = Query(
        None,
        description=f"Comma-separated subset of: {', '.join(events_service.CATEGORIES)}",
    ),
    sort: str = Query("distance", description='"distance" or "soonest"'),
    limit: int = Query(events_service.DEFAULT_LIMIT, ge=1, le=events_service.MAX_LIMIT),
) -> EventsResponse:
    """Local events near a point, distance-sorted.

    Every returned event carries coordinates — rows a source could not place
    are dropped rather than shown at an invented location. A source that fails
    is reported in `sources` with the others still served, so a partial answer
    is normal and is not an error.
    """
    try:
        result = await events_service.get_events(
            lat, lng,
            radius_km=radius_km,
            window_days=window_days,
            categories=categories.split(",") if categories else None,
            sort=sort,
            limit=limit,
        )
    except events_service.EventsUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))

    return EventsResponse(
        events=[EventItem(**item) for item in result["events"]],
        sources=[EventSourceStatus(**item) for item in result["sources"]],
        attribution=result["attribution"],
        radius_km=result["radius_km"],
        window_days=result["window_days"],
    )


@app.get("/sessions")
async def list_sessions() -> list:
    """List all active sessions."""
    return conversation_manager.list_sessions()


@app.post("/sessions", response_model=SessionResponse)
async def create_session(req: CreateSessionRequest) -> SessionResponse:
    """Create an in-memory session and persist it without delaying the app."""
    session = conversation_manager.create_session()
    session.title = req.title or ""
    session.source_url = req.source_url
    session.source_type = req.source_type
    session.locations = req.locations or []
    session.user_location = req.user_location
    # The session is ready for chat immediately. Supabase persistence is history
    # bookkeeping and must not make the Save and Ask AI transition wait.
    async def persist() -> None:
        try:
            await conversation_manager.save_conversation(session.session_id)
        except Exception:
            pass
    asyncio.create_task(persist())
    return SessionResponse(
        session_id=session.session_id,
        conversation_id=session.conversation_id,
        title=session.title,
        location_count=len(session.locations),
        message_count=len(session.messages),
    )


@app.post("/sessions/{session_id}/save")
async def save_session(session_id: str) -> dict:
    """Save session to Supabase."""
    try:
        conv_id = await conversation_manager.save_conversation(session_id)
        return {"conversation_id": conv_id, "status": "saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sessions/{session_id}/import-welcome")
async def create_import_welcome(session_id: str, req: ImportWelcomeRequest) -> dict:
    """Create the assistant-first opening message for a saved import chat."""
    try:
        session = conversation_manager.get_session(session_id)
        if not session:
            session = await conversation_manager.load_conversation(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")
        from backend.langgraph.chat_agent import generate_import_welcome
        return await generate_import_welcome(session.session_id, req.deselected_locations, req.welcome_text)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Import welcome error: {error}") from error


@app.post("/sessions/{session_id}/atlas-welcome")
async def create_atlas_welcome(session_id: str, req: AtlasWelcomeRequest) -> dict:
    """Create the assistant-first opening message for a saved Atlas edit."""
    try:
        session = conversation_manager.get_session(session_id)
        if not session:
            session = await conversation_manager.load_conversation(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")
        if req.locations:
            session.locations = req.locations
        from backend.langgraph.chat_agent import generate_atlas_welcome
        return await generate_atlas_welcome(session.session_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Atlas welcome error: {error}") from error


@app.get("/conversations")
async def list_conversations():
    """List saved conversations from Supabase."""
    try:
        convs = await conversation_manager.list_conversations()
        return {"conversations": convs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str) -> dict:
    """Load a full conversation."""
    try:
        # Fresh chats are available in memory before their background history
        # write completes, so opening Save and Ask AI never has to wait for DB.
        session = conversation_manager.get_session(conversation_id)
        if not session:
            session = await conversation_manager.load_conversation(conversation_id)
        if not session:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return {
            "status": "success",
            "session": session.to_dict(),
            "messages": session.messages,
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str) -> dict:
    """Delete a conversation."""
    try:
        success = await conversation_manager.delete_conversation(conversation_id)
        return {"deleted": success}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/memories")
async def get_memories():
    """Get long-term memories."""
    memories = await conversation_manager.get_all_memories()
    return {"memories": memories}


@app.post("/memories")
async def add_memory(req: MemoryRequest):
    """Add a memory item."""
    success = await conversation_manager.add_memory(req.session_id, req.key, req.value, req.category)
    return {"success": success}


@app.get("/health")
async def health():
    """Health-check endpoint."""
    return {"status": "ok"}


@app.get("/parse_progress/{request_id}")
async def parse_progress(request_id: str) -> dict:
    """Return progress events for an in-flight or recent parse request."""
    return progress.get(request_id)


@app.post("/parse_progress/{request_id}/cancel")
async def cancel_parse_progress(request_id: str) -> dict:
    """Cancel an active parse, or reserve a just-created request ID as cancelled."""
    return {"cancelled": progress.cancel(request_id)}


@app.get("/region_photo")
async def region_photo(query: str = Query(..., min_length=1, max_length=160)) -> dict:
    """Return several representative Wikipedia images for an inferred region."""
    region = query.strip()
    photos = await fetch_photos_for_places([
        f"{region} skyline",
        f"{region} waterfront",
        f"{region} landmark",
        region,
    ])
    unique_photos: list[str] = []
    for photo in photos:
        if photo and photo not in unique_photos:
            unique_photos.append(photo)
    return {
        "region": region,
        "photo_url": unique_photos[0] if unique_photos else None,
        "photo_urls": unique_photos[:3],
    }


@app.get("/place_photo")
async def place_photo(name: str = Query(..., min_length=1, max_length=200)) -> dict:
    """Return one cached, best-effort thumbnail for a saved place."""
    place_name = name.strip()
    photo_url = (await fetch_photos_for_places([place_name]))[0]
    return {"name": place_name, "photo_url": photo_url}


# ---- Find Image Places ----

class FindImagePlaceRequest(BaseModel):
    image: str  # base64-encoded image data
    request_id: Optional[str] = None


@app.post("/find_image_places", response_model=ParseResponse,
          responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def find_image_place_endpoint(req: FindImagePlaceRequest):
    """Identify a geographic place from an image using Google Cloud Vision + optional DeepSeek vision fallback.

    Accepts a single base64-encoded image.
    Returns the identified landmark name, coordinates, and a confidence-based subtitle.
    """
    if not req.image:
        raise HTTPException(status_code=400, detail="No image provided.")

    started_at = time.perf_counter()
    image_bytes = len(req.image) * 3 // 4
    if image_bytes > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image is too large. Choose a photo under 8 MB.")

    try:
        progress.start(req.request_id, "Inspecting image.") if req.request_id else None
        progress.stream_note(req.request_id, "image:upload", {"bytes": image_bytes})
        result_state = await atlas_graph_app.ainvoke(
            {
                "task_type": "find_image_places",
                "image": req.image,
                "request_id": req.request_id,
            },
            config={
                "configurable": {"thread_id": f"find_image_{id(req)}"},
                "run_name": "AtlasApp:find_image_places",
            },
        )
        result = result_state.get("result", {})
        loc = (result.get("locations") or [{}])[0]
        print(
            f"\n{'='*50}\n"
            f"🖼️ Find Image Place: {result.get('title', '?')}\n"
            f"📍 ({loc.get('latitude', 0):.4f}, {loc.get('longitude', 0):.4f})\n"
            f"🔍 Source: {loc.get('source', '?')}\n"
            f"{'='*50}\n"
        )
        # Photo lookup can be slow or rate-limited. The result screen already
        # has a map-thumbnail fallback, so it must not block place recognition.
        total_ms = round((time.perf_counter() - started_at) * 1000)
        logging.getLogger("atlas.find_image_places").info(
            "[FindImagePlaces] completed in %sms (uploaded image: %s bytes)", total_ms, image_bytes
        )
        progress.finish(req.request_id, {"location_count": len(result.get("locations", [])), "latency_ms": total_ms})
        return ParseResponse(**result)
    except ValueError as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=500, detail=f"Find image place failed: {e}")


# ---- Image Scan ----


class ScanImagesBase64Request(BaseModel):
    images: list[str]  # base64-encoded image data
    request_id: Optional[str] = None


@app.post("/scan_images_base64", response_model=ParseResponse,
          responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def scan_images_base64_endpoint(req: ScanImagesBase64Request):
    """Scan images from base64-encoded data (React Native compatible)."""
    if not req.images:
        raise HTTPException(status_code=400, detail="No images provided.")
    if len(req.images) > 3:
        raise HTTPException(status_code=400, detail="Maximum 3 images allowed.")

    import base64
    image_bytes: list[bytes] = []
    for b64_str in req.images:
        try:
            data = base64.b64decode(b64_str)
            image_bytes.append(data)
        except Exception:
            print("[scan_images] Failed to decode base64 image, skipping")

    if not image_bytes:
        raise HTTPException(status_code=400, detail="No valid image data decoded.")

    from backend.services.image_scanner import scan_images as run_scan
    try:
        progress.start(req.request_id, "Inspecting image text.") if req.request_id else None
        result = await run_scan(image_bytes, request_id=req.request_id)
        response_data = {
            "title": result.get("title", "Scanned places from image"),
            "locations": result.get("locations", []),
            "route": result.get("route", {"ordered_locations": [], "total_distance_km": 0.0, "segments": []}),
            "removed_noise": result.get("removed_noise", []),
            "session_id": result.get("session_id"),
            "removed_hierarchy": result.get("removed_hierarchy", []),
            "inferred_region": result.get("inferred_region"),
            "source_type": "image_scan",
        }

        locs = result.get("locations", [])
        print(f"\n{'='*50}")
        print(f"📸 Image Scan ({len(req.images)} images, base64)")
        print(f"📍 Locations ({len(locs)}):")
        for i, loc in enumerate(locs):
            print(f"   {i+1}. {loc['name']:30s} ({loc['latitude']:.4f}, {loc['longitude']:.4f})")
        print(f"{'='*50}\n")

        # Image scans bypass atlas_graph parse_link caching; enrich the
        # normalized response payload directly.
        await enrich_response_with_photos(response_data)
        progress.finish(req.request_id, {"location_count": len(response_data["locations"])})
        return ParseResponse(**response_data)
    except ValueError as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=500, detail=f"Image scan failed: {e}")


@app.post("/scan_images", response_model=ParseResponse,
          responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def scan_images_endpoint(files: list[UploadFile] = File(...)):
    """Scan images with GLM-OCR, extract text, classify, and route to pipeline.

    Accepts up to 3 image files (JPEG/PNG).
    Returns parsed locations same as /parse_link.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No images provided.")
    if len(files) > 3:
        raise HTTPException(status_code=400, detail="Maximum 3 images allowed.")

    # Read all file bytes
    image_bytes: list[bytes] = []
    for f in files:
        data = await f.read()
        if not data:
            continue
        image_bytes.append(data)

    if not image_bytes:
        raise HTTPException(status_code=400, detail="No valid image data read.")

    from backend.services.image_scanner import scan_images as run_scan
    try:
        result = await run_scan(image_bytes)
        response_data = {
            "title": result.get("title", "Scanned places from image"),
            "locations": result.get("locations", []),
            "route": result.get("route", {"ordered_locations": [], "total_distance_km": 0.0, "segments": []}),
            "removed_noise": result.get("removed_noise", []),
            "session_id": result.get("session_id"),
            "removed_hierarchy": result.get("removed_hierarchy", []),
            "inferred_region": result.get("inferred_region"),
            "source_type": "image_scan",
        }

        locs = result.get("locations", [])
        print(f"\n{'='*50}")
        print(f"📸 Image Scan ({len(files)} images)")
        print(f"📍 Locations ({len(locs)}):")
        for i, loc in enumerate(locs):
            print(f"   {i+1}. {loc['name']:30s} ({loc['latitude']:.4f}, {loc['longitude']:.4f})")
        print(f"{'='*50}\n")

        # Multipart image scans share the same response normalization as the
        # base64 endpoint, including server-side photo enrichment.
        await enrich_response_with_photos(response_data)
        return ParseResponse(**response_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image scan failed: {e}")


# ---- Cache Invalidation ----


class CacheInvalidateRequest(BaseModel):
    url: str


@app.post("/cache/invalidate")
async def cache_invalidate(req: CacheInvalidateRequest):
    """Invalidate the cached parse result for a specific URL.
    When a chat history item is deleted, its cached URL result should also
    be removed so that re-importing re-parses the source.
    """
    from backend.services.cache import invalidate as invalidate_cache
    removed = invalidate_cache(req.url)
    return {"invalidated": removed}


# ---- Cache Debug Endpoint ----


@app.get("/cache/status")
async def cache_status():
    """Return cache statistics (hits, misses, size, hit rate).

    Useful for debugging and monitoring cache effectiveness.
    """
    from backend.services.cache import get_cache_stats
    return get_cache_stats()


# ---- Performance Metrics Endpoint ----


@app.get("/api/performance")
async def get_performance(limit: int = 10):
    """返回最近的 pipeline 性能指标（耗时、token 用量等）。

    Query parameters:
        limit (int): 返回的最近运行记录数量，默认 10。
    """
    from backend.services.performance_logger import get_recent_metrics
    return {"metrics": get_recent_metrics(limit=limit)}
