"""FastAPI application entry point for the OurAtlas parse/fetch backend.

Run from project root:
    uvicorn backend.main:app --reload --reload-dir backend --port 8000

Endpoints:
  POST /parse_link          — Accept a URL, extract locations via agent pipeline, plan a route.
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
from typing import Optional

from dotenv import load_dotenv

# 加载项目根目录的 .env 文件
dotenv_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
load_dotenv(dotenv_path)

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

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.services import cache, progress
from backend.services.agent_orchestrator import agent_orchestrator
from backend.services.atlas_ai_discovery import discover_places_from_query
from backend.services.conversation_manager import conversation_manager
from backend.services.gemini_computer_use import extract_web_screenshots, extract_web_text
from backend.services.glm_ocr import ocr_images
from backend.services.image_scanner import scan_text
from backend.services.smart_text_service import analyze_smart_text

app = FastAPI(
    title="OurAtlas Parse & Fetch API",
    version="2.0.0",
    description="Agentic URL → Location extraction → Route planning → Chat",
)

# Allow CORS from any origin (for local development)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---- Pydantic models ----


class ParseRequest(BaseModel):
    url: str
    request_id: Optional[str] = None


class ParseTextRequest(BaseModel):
    text: str
    request_id: Optional[str] = None
    web_search: bool = False


class CreateSessionRequest(BaseModel):
    title: str = ""
    source_url: Optional[str] = None
    source_type: Optional[str] = None
    locations: Optional[list[dict]] = None


class AtlasDiscoverRequest(BaseModel):
    query: str
    request_id: Optional[str] = None


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
    source: Optional[str] = None


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


class MemoryRequest(BaseModel):
    session_id: str
    key: str
    value: str
    category: str = "preference"


class SessionResponse(BaseModel):
    session_id: str
    title: str = ""
    location_count: int = 0
    message_count: int = 0


class ScrapeUrlRequest(BaseModel):
    url: str
    request_id: Optional[str] = None


class ScanUrlRequest(BaseModel):
    url: str
    request_id: Optional[str] = None


class ErrorResponse(BaseModel):
    detail: str


# ---- Endpoints ----


@app.post("/scrape_url", response_model=ParseResponse,
          responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def scrape_url(req: ScrapeUrlRequest):
    """Extract a URL with Gemini computer use, then parse the extracted text."""
    url = req.url.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    session = conversation_manager.create_session()
    session.source_url = url

    try:
        progress.start(req.request_id, "Opening page.") if req.request_id else None

        scraped = await extract_web_text(url)
        if not scraped.success or not scraped.text.strip():
            raise ValueError(scraped.error or "Failed to extract readable text from this page.")

        progress.mark(req.request_id, "source_fetched", "Source fetched.", {
            "title": scraped.title or url,
            "characters": len(scraped.text),
            "source_type": "gemini_computer_use",
            "provider": scraped.provider,
        })

        result = await agent_orchestrator.run_pipeline_from_text(
            scraped.text,
            session,
            request_id=req.request_id,
            title=scraped.title or url,
            source_type="web_scrape",
        )
        result["title"] = scraped.title or result.get("title") or url
        result["source_type"] = "web_scrape"
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
    """Use Gemini computer-use screenshots, OCR them with GLM, then reuse image-scan parsing."""
    url = req.url.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    session = conversation_manager.create_session()
    session.source_url = url

    try:
        progress.start(req.request_id, "Opening page.") if req.request_id else None

        shot_result = await extract_web_screenshots(url)
        if not shot_result.success or not shot_result.screenshots:
            raise ValueError(shot_result.error or "Failed to capture page screenshots.")

        progress.mark(req.request_id, "source_fetched", "Source fetched.", {
            "title": shot_result.title or url,
            "characters": len(shot_result.screenshots),
            "source_type": "gemini_computer_use",
            "provider": shot_result.provider,
        })

        ocr_text = await ocr_images(shot_result.screenshots)
        if not ocr_text.strip():
            raise ValueError("No text could be extracted from the page screenshots.")

        progress.mark(req.request_id, "entity_linking_done", "Location fetched.", {
            "location_count": 1,
            "inferred_region": None,
        })

        result = await scan_text(ocr_text)
        result["title"] = shot_result.title or result.get("title") or url
        result["source_type"] = "any_links"
        progress.mark(req.request_id, "geocode_done", "Coordinates locked in.", {
            "query_count": len(result.get("locations", [])),
            "resolved_count": len(result.get("locations", [])),
        })
        progress.finish(req.request_id, {"location_count": len(result.get("locations", []))})
        return ParseResponse(**result)
    except ValueError as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=500, detail=f"Any Links scan failed: {e}")


@app.post("/parse_link", response_model=ParseResponse,
          responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def parse_link(req: ParseRequest) -> ParseResponse:
    """Parse a URL, extract locations via LLM, geocode, and plan a route.

    Uses the agentic pipeline (AgentOrchestrator) under the hood.
    Results are cached in-memory for subsequent requests.
    """
    # Check cache
    cached = cache.get(req.url)
    if cached is not None:
        progress.start(req.request_id, "Cache hit.") if req.request_id else None
        progress.finish(req.request_id, {"location_count": len(cached.get("locations", []))})
        return ParseResponse(**cached)

    # Create session
    session = conversation_manager.create_session()

    try:
        progress.start(req.request_id, "Fetching source content.") if req.request_id else None
        # Run agentic pipeline
        result = await agent_orchestrator.run_pipeline(req.url, session, request_id=req.request_id)

        # Build response — backward compatible with old format + new fields
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

        # Cache successful results
        cache.set(req.url, response_data)
        progress.finish(req.request_id, {"location_count": len(response_data["locations"])})

        # Server-side log
        locs = result.get("locations", [])
        print(f"\n{'='*50}")
        print(f"📌 URL: {req.url[:80]}")
        print(f"📍 Locations ({len(locs)}):")
        for i, loc in enumerate(locs):
            print(f"   {i+1}. {loc['name']:30s} ({loc['latitude']:.4f}, {loc['longitude']:.4f})")
        rh = result.get("removed_hierarchy", [])
        if rh:
            print(f"🗂️ Hierarchy removed ({len(rh)}):")
            for h in rh:
                n = h.get('name', h) if isinstance(h, dict) else h
                print(f"   - {n}")
        rn = result.get("removed_noise", [])
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
    if len(text) < 20:
        raise HTTPException(status_code=400, detail="Text too short to analyze.")

    session = conversation_manager.create_session()

    try:
        progress.start(req.request_id, "Reading pasted content.") if req.request_id else None
        result = await analyze_smart_text(text, use_web_search=req.web_search)
        session.title = result["title"]
        session.source_type = result.get("source_type")
        session.locations = result.get("locations", [])
        session.route = result.get("route")
        session.removed_noise = result.get("removed_noise", [])
        session.removed_hierarchy = result.get("removed_hierarchy", [])
        session.inferred_region = result.get("inferred_region")

        progress.mark(req.request_id, "source_fetched", "Source fetched.", {
            "title": session.title,
            "characters": len(text),
            "source_type": session.source_type,
        })
        progress.mark(req.request_id, "entity_linking_done", "Location fetched.", {
            "location_count": len(result.get("locations", [])),
            "inferred_region": result.get("inferred_region"),
        })
        progress.mark(req.request_id, "geocode_done", "Coordinates locked in.", {
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
        result = await agent_orchestrator.chat(req.session_id, req.message)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat error: {e}")


@app.post("/atlas_ai/discover", response_model=ParseResponse,
          responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def atlas_ai_discover(req: AtlasDiscoverRequest) -> ParseResponse:
    """Use DeepSeek to research exact addresses, then geocode those addresses."""
    query = (req.query or "").strip()
    if len(query) < 6:
      raise HTTPException(status_code=400, detail="Query too short.")

    try:
        progress.start(req.request_id, "Researching places from your request.") if req.request_id else None
        progress.mark(req.request_id, "source_fetched", "Source fetched.", {
            "title": query[:80],
            "characters": len(query),
            "source_type": "atlas_ai",
        })

        result = await discover_places_from_query(query)
        progress.mark(req.request_id, "entity_linking_done", "Location fetched.", {
            "location_count": len(result.get("locations", [])),
            "inferred_region": result.get("inferred_region"),
        })
        progress.mark(req.request_id, "geocode_done", "Coordinates locked in.", {
            "query_count": len(result.get("locations", [])),
            "resolved_count": len(result.get("locations", [])),
        })
        progress.finish(req.request_id, {"location_count": len(result.get("locations", []))})
        return ParseResponse(**result)
    except ValueError as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        progress.fail(req.request_id, str(e))
        raise HTTPException(status_code=500, detail=f"Atlas AI discovery failed: {e}")


@app.get("/sessions")
async def list_sessions() -> list:
    """List all active sessions."""
    return conversation_manager.list_sessions()


@app.post("/sessions", response_model=SessionResponse)
async def create_session(req: CreateSessionRequest) -> SessionResponse:
    """Create an in-memory session, optionally seeded with current map places."""
    session = conversation_manager.create_session()
    session.title = req.title or ""
    session.source_url = req.source_url
    session.source_type = req.source_type
    session.locations = req.locations or []
    return SessionResponse(
        session_id=session.session_id,
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


# ---- Image Scan ----


class ScanImagesBase64Request(BaseModel):
    images: list[str]  # base64-encoded image data


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
        print(f"📸 Image Scan ({len(req.images)} images, base64)")
        print(f"📍 Locations ({len(locs)}):")
        for i, loc in enumerate(locs):
            print(f"   {i+1}. {loc['name']:30s} ({loc['latitude']:.4f}, {loc['longitude']:.4f})")
        print(f"{'='*50}\n")

        return ParseResponse(**response_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
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
