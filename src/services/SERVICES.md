# Services

All backend API calls and external integrations live here. Nothing in `src/features/` should call `fetch()` directly — go through a service.

## Active Services

### `api/apiService.ts`

FastAPI backend client.

```ts
/**
 * Send a URL (e.g. Reddit post) to the backend for location extraction and route planning.
 * Base URL: Constants.expoConfig.extra.apiBaseUrl || 'http://localhost:8000'
 * Timeout: 30 seconds (AbortController)
 */
export async function parseLink(url: string): Promise<ParseResult>
```

`ParseResult` is defined in `src/types/route.ts`. See `src/features/parse-route/FETCHPARSE.md` for full backend documentation.

### `import/importService.ts`

Import parsing adapter for the four import modes.

```ts
/**
 * Parse pasted input or links into places for the import flow.
 * Smart text now always uses a qwen -> deepseek cascade.
 * Image scan keeps GLM OCR as the entry point.
 * Reddit links keep the existing DeepSeek parse pipeline.
 * Any links keep the Gemini-based vision path.
 */
export async function parseInput(input: string): Promise<ParseResult>
```

`parseInput()` routes to the appropriate backend flow and adapts the response into the import screens' `ParseResult` shape, including backend-filled `photo_url` as the place `imageUri`.

### `place/placeService.ts`

CRUD for the user's saved places, backed by Supabase and an offline-first local cache (see `local/`).
Parsed place photos are saved from the backend response; this service does not call third-party photo APIs from the device.

```ts
export async function savePlaces(places: ParsedPlace[], source?: { url?: string; region?: string }): Promise<SavedPlace[]>
export async function fetchSavedPlaces(): Promise<SavedPlace[]>
export async function deletePlace(id: string): Promise<void>
export async function updatePlaceNote(id: string, note: string): Promise<void>  // writes to local cache immediately; syncs to Supabase, queued for retry when offline
export function toPlaceDetail(row: SavedPlace): PlaceDetail
export function subscribeSavedPlaces(listener: (places: SavedPlace[]) => void): () => void
```

### `atlas/atlasService.ts`

CRUD for the user's atlases, backed by Supabase and the same offline-first local cache as `place/placeService.ts` (see `local/`).

```ts
export async function createAtlas(title: string): Promise<Atlas>
export async function deleteAtlas(id: string): Promise<void>  // local cache first, syncs to Supabase; atlas_places rows cascade server-side
export async function fetchAtlases(): Promise<Atlas[]>
export function subscribeAtlases(listener: (atlases: Atlas[]) => void): () => void
```

### `atlas/atlasPlacesService.ts`

CRUD for atlas ↔ place membership (the `atlas_places` join table), backed by Supabase and the same offline-first local cache as `place/placeService.ts` (see `local/`). The local cache holds every `atlas_places` row for the user across all atlases; callers filter by `atlas_id`.

```ts
export async function fetchAtlasPlaces(): Promise<AtlasPlace[]>
export async function addPlacesToAtlas(atlasId: string, placeIds: string[]): Promise<AtlasPlace[]>  // optimistic local insert, syncs to Supabase; skips places already in the atlas
export async function removePlaceFromAtlas(joinRowId: string): Promise<void>  // deletes the atlas_places row only (by its own id, not the place id); local cache first, syncs to Supabase
export async function removeAtlasPlacesForAtlas(atlasId: string): Promise<void>  // local-cache-only cleanup called by atlasService.deleteAtlas; no Supabase write since atlas_places is ON DELETE CASCADE
export function subscribeAtlasPlaces(listener: (rows: AtlasPlace[]) => void): () => void
```

`HomeContext` wraps `addPlacesToAtlas` / `removePlaceFromAtlas` / `deleteAtlas` (on `useHome()`) with an `Alert.alert` on failure, unlike the other `HomeContext` write wrappers (`deleteSavedPlace`, `createAtlas`), which only `console.error` — call the `useHome()` versions from feature code rather than these service functions directly.

## Planned

### `local/` — on-device cache + offline write queue

Not yet implemented — see [PLAN.md](local/PLAN.md) for the full design (AsyncStorage-backed cache-then-revalidate wrapper around `placeService`/chat history, namespaced by user id, with an offline write queue flushed on reconnect).

## Stub Services (not yet implemented)

These files are empty placeholders. Implement here when the feature is ready — **do not create new service files**:

| File | Intended purpose |
|---|---|
| `ai/aiService.ts` | Claude / DeepSeek AI client for in-app AI features |

## Constants

API base URL and map defaults live in `src/utils/constants.ts`:

```ts
export const API_BASE_URL = 'http://localhost:8000';
export const DEFAULT_MAP_CENTER: [number, number] = [-122.3321, 47.6062];
export const DEFAULT_ZOOM_LEVEL = 12;
export const ROUTE_LINE_COLOR = '#007AFF';
export const ROUTE_LINE_WIDTH = 4;
```
