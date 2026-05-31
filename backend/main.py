"""FastAPI application entry point for the OurAtlas parse/fetch backend.

Run from project root:
    uvicorn backend.main:app --reload --port 8000

Endpoints:
  POST /parse_link — Accept a Reddit URL, extract locations, plan a route.
"""

import os
from dotenv import load_dotenv
from typing import Optional

# 加载项目根目录的 .env 文件
dotenv_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
load_dotenv(dotenv_path)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.services import cache
from backend.services.reddit_fetcher import fetch_reddit_post
from backend.services.llm_client import extract_locations
from backend.services.geocoder import batch_geocode
from backend.services.route_planner import plan_route

app = FastAPI(
    title="OurAtlas Parse & Fetch API",
    version="1.0.0",
    description="Reddit URL → Location extraction → Route planning",
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


class ParseResponse(BaseModel):
    title: str
    locations: list[LocationItem]
    route: RouteResult
    removed_noise: Optional[list[str]] = None


class ErrorResponse(BaseModel):
    detail: str


# ---- Endpoints ----


@app.post("/parse_link", response_model=ParseResponse, responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
async def parse_link(req: ParseRequest) -> ParseResponse:
    """Parse a Reddit URL, extract locations via LLM, geocode, and plan a route.

    Steps:
      1. Check in-memory cache.
      2. Fetch the Reddit post via the public JSON API.
      3. Call DeepSeek V4 Flash to extract location names.
      4. Geocode each location via Mapbox.
      5. Compute the shortest route (TSP approximation).
      6. Cache and return the result.
    """
    # 1. Cache check
    cached = cache.get(req.url)
    if cached is not None:
        return ParseResponse(**cached)

    try:
        # 2. Fetch Reddit post
        post = fetch_reddit_post(req.url)
        text = f"{post['title']}\n\n{post['selftext']}"

        # 3. LLM location extraction
        llm_result = extract_locations(text)
        location_names = llm_result["locations"]
        removed_noise = llm_result.get("removed_noise")

        if not location_names:
            # No locations found — discard cache (don't cache empty results)
            raise HTTPException(
                status_code=400,
                detail="No geographic locations could be extracted from this post. "
                       "The post may not contain place references.",
            )

        # 4. Geocode
        coords = await batch_geocode(location_names)
        if not coords:
            raise HTTPException(
                status_code=400,
                detail="Could not geocode any of the extracted location names.",
            )

        # 5. Plan route
        route = plan_route(coords)

        # 6. Build response
        result = {
            "title": post["title"],
            "locations": coords,
            "route": route,
            "removed_noise": removed_noise,
        }

        # Cache successful results
        cache.set(req.url, result)

        return ParseResponse(**result)

    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {exc}",
        )


@app.get("/health")
async def health():
    """Health-check endpoint."""
    return {"status": "ok"}
