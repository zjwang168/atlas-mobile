# Services

All backend API calls and external integrations live here. Nothing in `src/features/` should call `fetch()` directly — go through a service.

Every module here is a plain async API except one: `place/usePlaceSearch.ts` is a React hook. See that section for why the search session cannot be expressed as a stateless function.

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

/** Typeahead place search. `sessionToken` must be the same one later passed to
 *  retrievePlace() — Mapbox bills the session, not the keystrokes.
 *  Pass `signal` to cancel a request the user has already typed past. */
export async function searchPlaces(params: { query: string; sessionToken: string; proximity?: [number, number]; limit?: number; language?: string; country?: string }, signal?: AbortSignal): Promise<PlaceSuggestResponse>

/** Resolve one suggestion into saveable places; a `brand` resolves to several. */
export async function retrievePlace(externalId: string, sessionToken: string, signal?: AbortSignal): Promise<PlaceRetrieveResponse>
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

### `events/eventsService.ts`

Local events near a coordinate, from the backend's `GET /events`.

Coverage is the DMV only, so an empty result is far more likely to mean "you are not in that area" than "nothing is on" — `isEmptyAwayFromCoverage()` distinguishes the two so a caller can say which. A source that fails while others succeed does not fail the request; `failedSources()` names them for a "may be incomplete" note.

```ts
export const DEFAULT_RADIUS_KM: number
export const DEFAULT_WINDOW_DAYS: number

export type EventsQuery = {
  coordinate: [number, number];   // [lng, lat], matching HomeContext.userLocation
  radiusKm?: number;
  windowDays?: number;            // how far ahead to look for dated events
  categories?: EventCategory[];
  sort?: 'distance' | 'soonest';
  limit?: number;
};

/** Throws on transport failure or a non-2xx; aborts on either the caller's signal or its own timeout. */
export async function fetchEvents(query: EventsQuery, signal?: AbortSignal): Promise<EventsResult>
export function isAbortError(error: unknown): boolean
export function isEmptyAwayFromCoverage(result: EventsResult): boolean  // succeeded, but found nothing
export function failedSources(result: EventsResult): string[]           // sources that errored
```

`EventsResult` and `LocalEvent` are defined in `src/types/event.ts`. See `backend/services/events_service/EVENTS-SERVICE.md` for the source behaviour behind them.

### `events/eventPlaceAdapter.ts`

Adapts a `LocalEvent` into the `ParsedPlace` shape `savePlaces()` accepts, so an event can be saved with no new table and no new sync path.

Writes `externalId`/`externalSource`, which is what makes saving idempotent: `isSamePlace()` matches on the provider id alone, so saving the same event twice reports a duplicate instead of creating a second row. A stock category image is deliberately dropped rather than carried onto the saved place — see `EVENT-DETAIL.md`.

```ts
export const EVENT_PLACE_SOURCE: string   // stored in places.external_source
export function eventToParsedPlace(event: LocalEvent): ParsedPlace
```

### `location/locationService.ts`

Device location via `expo-location`. Every call resolves to a usable coordinate, falling back to `DEFAULT_MAP_CENTER` when permission is refused, location services are off, or the fix fails — it never throws and never returns null, so callers don't each reimplement the fallback.

```ts
export type LocationPermissionStatus = 'undetermined' | 'granted' | 'denied'
export type UserLocationResult = { coordinate: [number, number]; status: LocationPermissionStatus; isFallback: boolean }

export async function getLocationPermissionStatus(): Promise<LocationPermissionStatus>  // does not prompt
export async function requestUserLocation(): Promise<UserLocationResult>  // prompts on first call; safe to call repeatedly since iOS only asks once
```

### `place/placeSearchService.ts`

Turns typed text into saveable places via the backend's Mapbox Search Box endpoints. Search is two steps — suggestions carry no coordinates, and the one the user picks is resolved into a full place. Both steps share a session token created here, not on the server, because Mapbox bills a search session and only the client knows when a typing session starts and ends.

**A token is spent by `resolvePlace()` and must not be used again.** Mapbox ends a session at the `/retrieve`, and warns that reusing a token across sessions bills unpredictably — so every caller rotates immediately after resolving, whether or not the resolve succeeded. Creating a token is free: it is a locally generated UUID that costs nothing until it reaches Mapbox, so rotating early is always the safe side. `usePlaceSearch` handles this for its own consumers; a caller driving `suggestPlaces`/`resolvePlace` directly owns it (see `AtlasBuilder`, which keeps one token across the keystrokes of a search and pairs a fresh one with each retrieve in its seeding loop).

Only `poi` suggestions are surfaced. A `brand` resolves to every branch Mapbox knows about, which the one-row-one-place save path cannot represent; nearby branches already appear as their own `poi` rows under proximity weighting. Because filtering happens after the request, more suggestions are asked for than are displayed.

```ts
export const SEARCH_DISPLAY_LIMIT: number
export const MIN_QUERY_LENGTH: number

export function createSearchSession(): string   // hold one per typing session, then discard
export function isAbortError(error: unknown): boolean

export async function suggestPlaces(query: string, sessionToken: string, options?: { proximity?: [number, number]; language?: string; country?: string }, signal?: AbortSignal): Promise<PlaceSuggestion[]>
export async function resolvePlace(suggestion: PlaceSuggestion, sessionToken: string, signal?: AbortSignal): Promise<ParsedPlace | null>  // ready for savePlaces(); `imageUri` carries the backend's photo backfill, so a place saved from search keeps its photo like an imported one
```

### `place/placeService.ts`

CRUD for the user's saved places, backed by Supabase and an offline-first local cache (see `local/`).
Parsed place photos are saved from the backend response; this service does not call third-party photo APIs from the device.

`savePlaces()` skips places `isSamePlace()` matches against something already saved, so a caller must read `inserted` rather than assume the call created anything. Identity prefers the provider id both sides carry; without one it needs the names to contain each other *and* the coordinates to be within ~100m, which is deliberately strict — a duplicate row is recoverable, a place silently dropped on save is not.

```ts
export type SavePlacesResult = { inserted: SavedPlace[]; duplicates: SavedPlace[] }  // `inserted` is what this call created (optimistic local rows when queued offline); `duplicates` is the existing row each skipped place matched

export async function savePlaces(places: ParsedPlace[], source?: { url?: string; region?: string; type?: string }): Promise<SavePlacesResult>  // per-place: description/address/externalId/externalSource/city/country when set. `region` and `type` are batch-level — they come from `source`, not from any one place, so callers passing no source (place search) leave them null
export function isSamePlace(a: PlaceIdentity, b: PlaceIdentity): boolean  // place identity, shared by the save dedup and the "Saved" badges; accepts either a ParsedPlace or a SavedPlace on each side
export function isSameProviderPlace(a: ProviderIdentity, b: ProviderIdentity): boolean  // the provider-id half of isSamePlace(), the only half that needs no coordinates — a false means "not known to be the same", not "different"
export type ProviderIdentity = { externalId?, externalSource?, external_place_id?, external_source? }  // a provider id in either the camelCase or the DB-row shape
export async function fetchSavedPlaces(): Promise<SavedPlace[]>
export async function deletePlace(id: string): Promise<void>
export async function updatePlaceNote(id: string, note: string): Promise<void>  // writes to local cache immediately; syncs to Supabase, queued for retry when offline
export function toPlaceDetail(row: SavedPlace): PlaceDetail  // `category` comes through both as a tag and on its own field, which is what PlaceCover buckets on
export type PlaceSource = { id: string; source_type: string | null; source_url: string | null; ai_extracted_summary: string | null; created_at: string }
export async function fetchPlaceSources(placeId: string): Promise<PlaceSource[]>  // every recorded origin for a place, newest first; [] rather than throwing, since a place imported before provenance was recorded simply has none
export function resolvePlaceThumbnail(place: Pick<SavedPlace, 'photo_url' | 'latitude' | 'longitude'>, options?: { fallback?: 'staticMap' | 'none' }): string  // real photo if saved; `fallback` picks what stands in when there isn't one — default 'staticMap' generates a Mapbox pin, 'none' returns '' so the caller can render PlaceCover instead
export function subscribeSavedPlaces(listener: (places: SavedPlace[]) => void): () => void
```

### `place/usePlaceSearch.ts`

A **React hook**, not a plain async API — the one such module here. It owns a search *session*: the functions in `placeSearchService` are stateless, but Mapbox bills a session rather than the keystrokes, so one token must span every request in a typing burst and be dropped when that burst ends. Only a component knows those boundaries, and more than one feature needs the same discipline — copying it is how one copy quietly starts billing per keystroke.

Wraps `suggestPlaces` (debounced, each settled query cancelling whatever the previous one started) and, on pick, `resolvePlace` + `savePlaces()`, reporting whether the pick created a place or matched one already saved. Takes `proximity` and `onSaved` as arguments rather than reading `HomeContext` itself — a service importing a feature would invert the dependency the rest of `services/` keeps.

```ts
export type PlaceSearchStatus = 'idle' | 'searching' | 'ready' | 'error'
// PlaceSaveOutcome ('saved' | 'duplicate') is a shared type — see @/types/place

export function usePlaceSearch(options?: {
  proximity?: [number, number];          // biases suggestions toward the user
  onSaved?: () => void | Promise<void>;  // awaited after a save or dedup match, before the suggestion settles
  savedPlaces?: SavedPlace[];            // pre-marks suggestions already in My Places
}): {
  query: string;
  setQuery: (query: string) => void;
  suggestions: PlaceSuggestion[];
  status: PlaceSearchStatus;
  savingId: string | null;               // external_id currently being resolved and saved
  outcomeFor: (suggestion: PlaceSuggestion) => PlaceSaveOutcome | null;  // what a tap did, or the pre-mark before any tap
  pick: (suggestion: PlaceSuggestion) => Promise<void>;
  reset: () => void;                     // clears query/results/outcomes and starts a new billed session
}
```

Passing `savedPlaces` marks results the user already has before they tap. It goes through `isSameProviderPlace`, not `isSamePlace`, because a suggestion has no coordinates until it is resolved — so it only catches saved places that carry a provider id, which today means places saved through search rather than through a link import. It is a hint layered on top of the authoritative answer, which still comes from `savePlaces()` on tap.

`reset()` exists for a consumer that stays mounted after the user leaves it. `SearchPanel` unmounts and does not need it; Discover's pane is only hidden, so nothing else would end its typing session or rotate the billed token.

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

### `plan/planService.ts`

CRUD for the user's plans, backed by Supabase and a read-through local cache (see `local/`). Unlike `place/placeService.ts` / `atlas/atlasService.ts`, writes are online-first for now — no offline write-queue integration yet.

```ts
export async function fetchPlans(): Promise<PlanRow[]>
export async function findPlan(id: string): Promise<PlanRow | undefined>
export async function createPlan(input: CreatePlanInput): Promise<PlanRow>  // optimistic local row; rolls back and rethrows on failure (no retry queue yet)
export async function deletePlan(id: string): Promise<void>  // plan_itinerary_place_flexible/plan_itinerary_days cascade server-side
export function subscribePlans(listener: (plans: PlanRow[]) => void): () => void
```

### `plan/planItineraryService.ts`

Reads/writes for a plan's places — `plan_itinerary_place_flexible` (flexible, unscheduled) and `plan_itinerary_days` + `plan_itinerary_places` (scheduled onto a day + visit slot). Same v1 online-first scope as `planService.ts`. A place lands in exactly one of `plan_itinerary_place_flexible` or `plan_itinerary_places` — there's no row-level link between the two, so "flexible" vs. "scheduled" is which table wrote it, not a derived join.

```ts
export async function fetchFlexiblePlaces(planId: string): Promise<PlanItineraryPlaceFlexibleRow[]>
export async function addFlexiblePlaces(planId: string, placeIds: string[]): Promise<PlanItineraryPlaceFlexibleRow[]>  // the same place id may be added more than once
export async function removeFlexiblePlace(joinRowId: string): Promise<void>
export async function fetchPlanItinerary(planId: string): Promise<{ day: PlanItineraryDayRow; items: PlanItineraryPlaceRow[] }[]>
export async function ensurePlanItineraryDay(planId: string, date: string, sortOrder: number): Promise<PlanItineraryDayRow>  // finds or creates the day row; call once per date, not once per place
export async function addScheduledPlaceToDay(dayId: string, placeId: string, visitSlot: VisitSlot, sortOrder: number): Promise<PlanItineraryPlaceRow>
export async function removeScheduledPlace(itemId: string): Promise<void>
export async function fetchPlanSummaries(planIds: string[]): Promise<Record<string, PlanSummary>>  // batch place-count + cover-candidate lookup for the MyPlan grid, 3 queries total regardless of plan count
```

`src/features/my-plan/create-plan/savePlan.ts` adapts between these two services' DB-row shapes and the `my-plan` wizard's `PlacesState`/`SavedPlan` shape — see `CREATE-PLAN.md`.

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
