# FETCHPARSE — Reddit Link Parsing & Route Planning Feature

This document tracks all changes made to the Reddit link parsing & route planning feature since the last push to the `integrate mapbox` branch.

---

## Overview

The feature allows users to paste a Reddit post URL into the app's search bar, which triggers a backend pipeline that:

1. Fetches the Reddit post content (title + body + top comments)
2. Extracts geographic location names via a DeepSeek V4 Flash LLM call
3. Filters out noise (locations far from the main region)
4. Geocodes each location name to coordinates via the Mapbox Geocoding API
5. Plans the shortest route using a TSP approximation (Haversine + Greedy + 2-opt)
6. Returns the ordered locations and route to the frontend for map rendering

---

## Backend (FastAPI)

All backend files are located under [`backend/`](backend/).

### [`backend/main.py`](backend/main.py)

FastAPI application entry point. Runs on port 8000.

- **`POST /parse_link`** — Accepts a JSON body `{ "url": "<reddit-url>" }`. Orchestrates the full pipeline: cache check → fetch Reddit post → LLM extraction → geocoding → route planning → cache store. Returns a `ParseResponse` with title, locations, route, and removed_noise.
- **`GET /health`** — Simple health-check endpoint returning `{ "status": "ok" }`.
- CORS middleware enabled for local development (`allow_origins=["*"]`).

### [`backend/services/reddit_fetcher.py`](backend/services/reddit_fetcher.py)

Reddit post content fetcher.

- **Primary**: Uses the official Reddit JSON API (`reddit.com/r/{sub}/comments/{id}/.json`) — free, no authentication required.
- **Fallback**: If the JSON API returns 403 (blocked), uses `old.reddit.com` HTML scraping with `BeautifulSoup` via HTTP/1.1 (to bypass WAF blocks). Extracts title, post body, and top 30 comments.
- URL pattern matching to extract subreddit and post ID.

### [`backend/services/llm_client.py`](backend/services/llm_client.py)

DeepSeek V4 Flash LLM client for location extraction + noise filtering.

- Sends Reddit post text to `https://api.deepseek.com/chat/completions` with a strict system prompt.
- The system prompt instructs the model to:
  - Output only JSON: `{ "locations": [...], "removed_noise": [...|null] }`
  - Extract real geographic places only
  - Infer the main region from context and remove far-away "noise" addresses
  - Include clarifying context for ambiguous names (e.g. "Chaoyang, Beijing")
- Temperature: 0.3 (low creativity for structured output). Max tokens: 2048.
- Parses the response, stripping markdown code fences if present.

### [`backend/services/geocoder.py`](backend/services/geocoder.py)

Mapbox Geocoding API client.

- Uses the **same public token** (`MAPBOX_ACCESS_TOKEN`) as the frontend via `.env`.
- `geocode()` — Single location name → coordinates via `mapbox.places` endpoint.
- `batch_geocode()` — Concurrent geocoding of multiple location names using `asyncio.gather`. Failed items are silently skipped with a warning log.
- Returns dicts with keys: `name`, `latitude`, `longitude`, `full_address`.

### [`backend/services/route_planner.py`](backend/services/route_planner.py)

Route planning engine using purely geometric computations.

- **Haversine formula** — Great-circle distance between two WGS84 coordinates (no external API cost).
- **Greedy TSP** — Nearest-neighbor heuristic to build an initial route order.
- **2-opt improvement** — Local search to refine the greedy solution (up to 100 iterations).
- Returns ordered locations, total distance (km), and segment list with per-segment distances.

### [`backend/services/cache.py`](backend/services/cache.py)

Simple in-memory cache with TTL support.

- Uses a Python `dict` keyed by MD5 hash of the URL.
- Default TTL: 1 hour (3600 seconds).
- Replaces Redis/Supabase for the MVP — no external storage dependency.
- Cache is lost on process restart.

### [`backend/requirements.txt`](backend/requirements.txt)

Python dependencies:

| Package | Version |
|---------|---------|
| `fastapi` | 0.115.0 |
| `uvicorn` | 0.30.6 |
| `httpx` | 0.27.2 |
| `pydantic` | 2.9.2 |
| `beautifulsoup4` | 4.12.3 |
| `lxml` | 5.3.0 |
| `python-dotenv` | 1.0.1 |

---

## Frontend (React Native)

### New Files

#### [`src/types/route.ts`](src/types/route.ts)

TypeScript type definitions for the parse/fetch feature:

- `GeocodedLocation` — `{ name, latitude, longitude, full_address }`
- `RouteSegment` — `{ from_name, to_name, distance_km }`
- `RouteResult` — `{ ordered_locations, total_distance_km, segments }`
- `ParseResult` — Top-level response type matching the backend's response
- `ChatMessage` — `{ id, role ('user'|'assistant'|'system'), text, timestamp }` for the Sidekick chat

#### [`src/services/apiService.ts`](src/services/apiService.ts)

API client for the FastAPI backend.

- `parseLink(url)` — Sends a POST request to `http://localhost:8000/parse_link` with 30-second timeout using `AbortController`.
- Returns a `ParseResult` on success; throws on non-OK responses.

#### [`src/features/home/SearchBar.tsx`](src/features/home/SearchBar.tsx)

Reusable search bar component with Reddit link detection.

- Floating at the top of the map screen.
- **Clipboard detection**: On focus, checks the device clipboard via `expo-clipboard` for Reddit URLs. If found, shows an `Alert.alert` prompt to paste.
- Send button (→ arrow) submits the URL to the parent via `onSend` callback.
- Loading state: shows an `ActivityIndicator` while the backend processes the request.
- History button (☰) placeholder for future use.

#### [`src/features/home/Sidekick.tsx`](src/features/home/Sidekick.tsx)

Bottom sheet panel using `@gorhom/bottom-sheet` (the "Sidekick").

- **Snap points**: 40% (collapsed) and 100% (full screen).
- **Idle state**: Shows "Paste a Reddit link to explore" with instructions.
- **Loading state**: Shows an `ActivityIndicator` with a cycling message (Fetching → AI analyzing → Geocoding → Planning).
- **Result state**: Chat interface with:
  - System message introducing the result summary
  - Assistant message with extracted places and route
  - Chat input for follow-up questions (MVP: auto-reply only)
- **Error state**: Error banner with the error message.
- Auto-expands to 40% when data arrives.
- Route and location details displayed with markers and distance info.

### Modified Files

#### [`src/features/home/HomeScreen.tsx`](src/features/home/HomeScreen.tsx)

Main screen — **modified** to integrate the parse/fetch feature.

- Added state management for: `parseResult`, `isLoading`, `loadingMessage`, `error`, `messages`.
- `handleSend()` — Orchestrates the flow: calls `parseLink()`, creates system/assistant chat messages, cycles through loading messages.
- `handleSendMessage()` — Handles follow-up chat messages in the Sidekick (MVP auto-reply only).
- Renders `SearchBar` (floating) + `MapboxMap` (full screen) + `Sidekick` (bottom sheet).
- Converts route data to `MapMarker[]` and `GeoJSON.LineString` for map rendering.
- Computes route center for camera re-centering.

#### [`src/features/map/MapboxMap.tsx`](src/features/map/MapboxMap.tsx)

Mapbox map component — **modified** to support route rendering.

- New props: `routeGeoJSON?: GeoJSON.Feature<GeoJSON.LineString>` and `routeMarkers?: MapMarker[]`.
- When `routeGeoJSON` is provided, renders a blue polyline via `MapboxGL.ShapeSource` + `LineLayer`.
- When `routeMarkers` is provided, uses them instead of the default `markers` prop.
- Camera recenters when `centerCoordinate` changes.

#### [`src/utils/constants.ts`](src/utils/constants.ts)

**Modified** — Added:

- `API_BASE_URL` — `http://localhost:8000` (FastAPI backend URL)
- `DEFAULT_MAP_CENTER` — Seattle coordinates `[-122.3321, 47.6062]`
- `DEFAULT_ZOOM_LEVEL` — 12
- `ROUTE_LINE_COLOR` — `#007AFF`
- `ROUTE_LINE_WIDTH` — 4

---

## Bug Fixes

| Bug | Fix |
|-----|-----|
| Reddit JSON API returning 403 (blocked) | Added HTML scraping fallback via `old.reddit.com` with HTTP/1.1 and full browser headers to bypass WAF |
| LLM response wrapped in markdown code fences | Added code fence stripping in `llm_client.py` before JSON parsing |
| Empty geocoding results crashing the pipeline | `batch_geocode()` now skips failed items with `return_exceptions=True` and a warning log |
| Single-location routes showing impossible segments | `plan_route()` returns early with zero-distance result when `len(coords) <= 1` |
| Map showing blank area on route load | Added `useWindowDimensions` to set explicit width/height on the MapView |
| Caching empty/error results | Cache is only set on successful responses; 400/500 errors are never cached |

---

## Key Architectural Decisions

### No External Storage (No Redis / Supabase)

- Cache is implemented as an **in-memory Python dict** in [`backend/services/cache.py`](backend/services/cache.py).
- **TTL**: 1 hour. Cache is **lost on process restart** — acceptable for MVP.
- Rationale: Avoids infrastructure overhead and API costs. The feature is read-heavy for a small number of URLs.

### Route Planning: Haversine + Greedy TSP + 2-opt

- All calculations use **great-circle distance** on the WGS84 ellipsoid.
- No external API calls → **zero cost** for route computation.
- `greedy_tsp()` provides a reasonable initial route; `two_opt_improve()` refines it.
- Sufficient for MVP route ordering of up to ~30 locations.

### DeepSeek V4 Flash for Location Extraction

- Used for natural language understanding of Reddit posts.
- System prompt includes **noise filtering**: the LLM identifies and removes addresses that are geographically far from the main region.
- Temperature 0.3 ensures structured, predictable JSON output.
- Model: `deepseek-chat` (DeepSeek V4 Flash).

### Mapbox Geocoding for Name → Coordinates

- Uses the **same public token** (`MAPBOX_ACCESS_TOKEN`) as the frontend.
- `mapbox.places` endpoint — sufficient for MVP geocoding needs.
- Concurrent async requests via `asyncio.gather` for batch geocoding.
- Failed geocoding results are skipped (not fatal).

### `@rnmapbox/maps` v10.3.1

- Uses Mapbox native SDK v11.
- **No download token required** in v10 — the public access token (`pk.`) is sufficient.
- Configured via `app.config.js` with the `@rnmapbox/maps` plugin.
- Route polylines rendered via `MapboxGL.ShapeSource` + `LineLayer` using GeoJSON.

---

## File Inventory

### Created Files

| File | Purpose |
|------|---------|
| `backend/main.py` | FastAPI app entry point with `/parse_link` and `/health` endpoints |
| `backend/requirements.txt` | Python dependencies |
| `backend/services/__init__.py` | Package initializer |
| `backend/services/cache.py` | In-memory TTL cache |
| `backend/services/reddit_fetcher.py` | Reddit post fetcher (JSON API + HTML fallback) |
| `backend/services/llm_client.py` | DeepSeek V4 Flash LLM client |
| `backend/services/geocoder.py` | Mapbox Geocoding API client |
| `backend/services/route_planner.py` | TSP route planner (Haversine + Greedy + 2-opt) |
| `src/types/route.ts` | TypeScript types for parse/fetch feature |
| `src/services/apiService.ts` | Backend API client |
| `src/features/home/SearchBar.tsx` | Search bar with clipboard Reddit detection |
| `src/features/home/Sidekick.tsx` | Bottom sheet panel with chat interface |
| `src/features/fetchParse/FETCHPARSE.md` | This documentation file |

### Modified Files

| File | Changes |
|------|---------|
| `src/features/home/HomeScreen.tsx` | Added parse/fetch state management, SearchBar + Sidekick integration, route-to-map conversion |
| `src/features/map/MapboxMap.tsx` | Added `routeGeoJSON` and `routeMarkers` props, route polyline rendering, camera recentering |
| `src/utils/constants.ts` | Added `API_BASE_URL`, map defaults, route styling constants |
