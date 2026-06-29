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

## Stub Services (not yet implemented)

These files are empty placeholders. Implement here when the feature is ready — **do not create new service files**:

| File | Intended purpose |
|---|---|
| `ai/aiService.ts` | Claude / DeepSeek AI client for in-app AI features |
| `import/importService.ts` | Import pipeline: parse raw text → extract places |
| `place/placeService.ts` | CRUD for user's saved places (Supabase) |
| `supabase/supabaseClient.ts` | Supabase JS client singleton |

## Constants

API base URL and map defaults live in `src/utils/constants.ts`:

```ts
export const API_BASE_URL = 'http://localhost:8000';
export const DEFAULT_MAP_CENTER: [number, number] = [-122.3321, 47.6062];
export const DEFAULT_ZOOM_LEVEL = 12;
export const ROUTE_LINE_COLOR = '#007AFF';
export const ROUTE_LINE_WIDTH = 4;
```
