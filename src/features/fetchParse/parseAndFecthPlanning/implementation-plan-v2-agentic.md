# Implementation Plan v2 — Multi-Agent Pipeline

> This plan defines step-by-step implementation tasks for the agentic pipeline upgrade.
> Each step is designed to be executed independently by Code mode.

---

## Phase 1: Backend Agent Infrastructure (6 steps)

### Step 1.1: Upgrade LLM Client with Tool-Calling Support

**Files:** `backend/services/llm_client.py`

**Changes:**
- Rename `extract_locations()` → `call_llm()` supporting two modes:
  - `mode="chat"` — Standard chat completion (existing flow)
  - `mode="tool_call"` — Structured output with tool definitions
- Add `parse_tool_call_response()` to extract tool calls from LLM output
- Add `MAX_RETRIES=2` for malformed JSON recovery
- Upgrade prompt to support hierarchical extraction

```python
def call_llm(
    messages: list[dict],
    tools: list[dict] | None = None,
    temperature: float = 0.3,
    max_tokens: int = 2048,
) -> dict:
    """Core LLM call with optional tool definitions."""
    
def parse_response(response: dict) -> dict:
    """Parse LLM response, handling:
    - Markdown code fences
    - Raw JSON
    - Tool calls (structured output)
    - Text-only responses
    Returns normalized dict with keys: type, content, tool_calls
    """
```

### Step 1.2: Create Tool Definitions

**New file:** `backend/services/tool_definitions.py`

- Define `TOOLS` list with all tool schemas (10 tools)
- Define `ToolRegistry` class:
  - `register(name, func)` — Register a Python function as a tool
  - `execute(name, args)` — Execute a tool by name with validation
  - `get_definitions()` — Return tool schemas for LLM prompt
- Initial tools: `scrape_url`, `geocode_location`, `batch_geocode`, `plan_route`, `compute_region_cluster`
- Wrapper functions that delegate to existing services (geocoder, route_planner, etc.)

### Step 1.3: Create Multi-Source Web Scraper

**New file:** `backend/services/web_scraper.py`

- `class WebScraper`:
  - `scrape(url: str) -> dict` — Auto-detect source type and scrape
  - `scrape_reddit(url: str) -> dict` — Delegate to existing `reddit_fetcher.py`
  - `scrape_generic(url: str) -> dict` — Use `trafilatura` for any webpage
  - `classify_source(url: str) -> str` — URL pattern matching
- Add `trafilatura` to `requirements.txt`

### Step 1.4: Create Hierarchical Extraction Pipeline

**New file:** `backend/services/extraction_pipeline.py`

- `class ExtractionPipeline`:
  - `extract(text: str, source_type: str) -> dict` — Full extraction pipeline
  - `stage1_raw_extraction(text: str) -> list[dict]` — LLM call: extract all geo entities with hierarchy levels
  - `stage2_filter_hierarchical(entities: list[dict]) -> list[dict]` — Remove high-level parents when specific children exist
  - `stage3_detect_outliers(locations: list[dict], source_context: str) -> tuple[list[dict], list[dict]]` — Cluster + remove noise
  - `stage4_enrich_context(filtered: list[dict]) -> list[dict]` — Add disambiguation context
- Output format:
  ```json
  {
    "locations": [{"name": "...", "context": "...", "hierarchy_level": 0}],
    "removed_noise": [{"name": "...", "reason": "..."}],
    "removed_hierarchy": [{"name": "...", "reason": "...", "parent_of": "..."}]
  }
  ```

### Step 1.5: Create Session & Conversation Manager

**New file:** `backend/services/conversation_manager.py`

- `class ConversationManager`:
  - `create_session(session_id: str, source_url: str) -> Session`
  - `get_session(session_id: str) -> Session | None`
  - `update_session(session_id: str, data: dict) -> None`
  - `add_message(session_id: str, role: str, content: str, tool_calls=None, tool_results=None)`
  - `get_context(session_id: str, max_messages=10) -> list[dict]` — Build context for LLM
  - `save_conversation(session_id: str) -> str` — Persist to Supabase, return conversation_id
  - `load_conversation(conversation_id: str) -> Session` — Load from Supabase
  - `list_conversations(user_id: str) -> list[dict]`
  - `delete_conversation(conversation_id: str) -> None`
- `class Session`:
  - Properties: `session_id`, `conversation_id`, `messages: list`, `locations: list`, `route: dict | None`, `source_url`, `created_at`, `updated_at`
  - Methods: `to_context()`, `add_location()`, `update_route()`, `summary()`

### Step 1.6: Create Agent Orchestrator

**New file:** `backend/services/agent_orchestrator.py`

- `class AgentOrchestrator`:
  - `run_pipeline(url: str, session_id: str) -> dict` — Full pipeline: route → scrape → extract → geocode → route
  - `chat(session_id: str, message: str) -> dict` — Continue conversation with agent
  - `_agent_loop(task: dict, context: Session, max_steps=10) -> dict` — Core agent loop
  - `_execute_tool(tool_name: str, args: dict) -> dict` — Tool execution with error handling
  - `_handle_error(error: Exception, step: int) -> dict` — Graceful degradation
- Pipeline flow:
  1. Classify URL → determine source type
  2. Scrape content → extract text
  3. Two-stage extraction → filtered location list
  4. Batch geocode → coordinates
  5. TSP route → ordered locations
  6. Create session memory → store all artifacts
  7. Return result

---

## Phase 2: API & Backend Integration (2 steps)

### Step 2.1: Add New API Endpoints

**Modify:** `backend/main.py`

Add endpoints:
- `POST /chat` — `{session_id, message}` → `{response, map_updates, locations, route}`
- `GET /sessions` — List active sessions
- `POST /sessions/{session_id}/save` — Persist session to Supabase
- `GET /conversations` — List saved conversations
- `GET /conversations/{conversation_id}` — Load full conversation
- `DELETE /conversations/{conversation_id}` — Delete conversation

Refactor `POST /parse_link`:
- Use AgentOrchestrator instead of linear pipeline
- Return `session_id` in response
- Return `removed_hierarchy` alongside `removed_noise`

### Step 2.2: Create Supabase Service

**New file:** `backend/services/supabase_service.py`

- `class SupabaseService`:
  - `save_conversation(session: Session) -> str`
  - `load_conversation(conversation_id: str) -> Session`
  - `list_conversations(user_id: str) -> list`
  - `delete_conversation(conversation_id: str) -> None`
  - `save_messages(conversation_id: str, messages: list) -> None`
  - `save_locations(conversation_id: str, locations: list) -> None`
- Retry logic (3 attempts) for Supabase availability
- Graceful fallback to in-memory only when Supabase is down

---

## Phase 3: Frontend Integration (3 steps)

### Step 3.1: Update Types

**Modify:** `src/types/route.ts`

Add:
- `Conversation` — `{id, title, source_url, created_at, updated_at, location_count}`
- `ConversationDetail` — `{messages, locations, route}`
- `ChatRequest` — `{session_id, message}`
- `ChatResponse` — `{response, map_updates, locations, route}`
- `HierarchyInfo` — `{name, level, reason, parent_of}`
- `MapUpdate` — `{action: add|remove|reorder, pin_id?, params?}`

### Step 3.2: Update API Service

**Modify:** `src/services/apiService.ts`

Add:
- `chat(sessionId: string, message: string) -> Promise<ChatResponse>`
- `getConversations() -> Promise<Conversation[]>`
- `getConversation(id: string) -> Promise<ConversationDetail>`
- `saveConversation(sessionId: string) -> Promise<{id: string}>`
- `deleteConversation(id: string) -> Promise<void>`

### Step 3.3: Update Frontend Components

**Modify:** `src/features/home/HomeScreen.tsx`
- Add session management state
- Add history list modal/panel
- Wire up `/chat` endpoint for follow-up conversation
- Handle `map_updates` from chat responses

**Modify:** `src/features/home/Sidekick.tsx`
- Show removed_hierarchy locations (dimmed, with reason)
- Show location count and breakdown by hierarchy level
- Loading messages: phase-specific ("Scraping...", "Extracting locations...", "Filtering hierarchy...", "Geocoding...", "Planning route...")
- Display tool calls as interactive elements

**Modify:** `src/features/home/SearchBar.tsx`
- Add history list button functionality
- Show conversation history on press

---

## Phase 4: Documentation (1 step)

### Step 4.1: Update All Documents

- `FETCHPARSE.md` — Add v2 feature summary
- `architecture-overview.md` — Reference v2 architecture doc
- `architecture-v2-agentic.md` — Already created
- `implementation-plan-v2-agentic.md` — This file
- `file-checklist.md` — Update with new files

---

## Execution Order

```
Phase 1: Backend Agent Infrastructure
  Step 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6

Phase 2: API & Backend Integration
  Step 2.1 → 2.2

Phase 3: Frontend Integration
  Step 3.1 → 3.2 → 3.3

Phase 4: Documentation
  Step 4.1
```

Total new files: ~7 | Total modified files: ~8
