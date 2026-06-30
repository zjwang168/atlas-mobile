"""FastAPI application entry point for the OurAtlas parse/fetch backend.

Run from project root:
    uvicorn backend.main:app --reload --port 8000

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

import os
from typing import Optional

from dotenv import load_dotenv

# 加载项目根目录的 .env 文件
dotenv_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
load_dotenv(dotenv_path)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.services import cache
from backend.services.agent_orchestrator import agent_orchestrator
from backend.services.conversation_manager import conversation_manager

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


class LocationItem(BaseModel):
    name: str
    latitude: float
    longitude: float
    full_address: str


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


class SessionResponse(BaseModel):
    session_id: str
    title: str = ""
    location_count: int = 0
    message_count: int = 0


class ErrorResponse(BaseModel):
    detail: str


# ---- Endpoints ----


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
        return ParseResponse(**cached)

    # Create session
    session = conversation_manager.create_session()

    try:
        # Run agentic pipeline
        result = await agent_orchestrator.run_pipeline(req.url, session)

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
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")


# --- Chat & Conversation Endpoints ---


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


@app.get("/sessions")
async def list_sessions() -> list:
    """List all active sessions."""
    return conversation_manager.list_sessions()


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


@app.get("/health")
async def health():
    """Health-check endpoint."""
    return {"status": "ok"}
