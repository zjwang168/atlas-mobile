import { GeocodedLocation, ParseResult, PlaceSuggestion } from '@/types/route';
import { supabase } from '../supabase/supabaseClient';
import Constants from 'expo-constants';
import { File } from 'expo-file-system';
import type { AtlasTransportMode } from '../atlas/atlasPlaceMetadata';
export type { AtlasTransportMode } from '../atlas/atlasPlaceMetadata';

/**
 * Base URL for the FastAPI backend.
 * In development: http://localhost:8000
 * Can be overridden via app.config.js extra.apiBaseUrl
 */
const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string) ||
  'http://localhost:8000';
const MAPBOX_ACCESS_TOKEN = (Constants.expoConfig?.extra?.mapboxAccessToken as string) || process.env.MAPBOX_ACCESS_TOKEN || '';

/** Request timeout in milliseconds (180s — backend Pipeline 含 LLM + 批量地理编码需 40-110s) */
const REQUEST_TIMEOUT_MS = 180_000;

/** Shared POST helper with timeout + error normalization. */
/** Authorization header carrying the user's Supabase JWT, so the backend
    can act on the user's behalf under RLS. */
async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `API error (${response.status}): ${errorBody || response.statusText}`,
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(
        `请求超时：后端处理超过 ${REQUEST_TIMEOUT_MS / 1000}s，请稍后再试`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getJson<T>(path: string, signal?: AbortSignal, includeAuth = true): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: includeAuth ? await authHeaders() : undefined,
    signal,
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API error (${response.status}): ${errorBody || response.statusText}`);
  }
  return response.json();
}

export type ParseProgressEvent = {
  key: string;
  label: string;
  elapsed_s: number;
  data?: Record<string, unknown>;
};

export type ParseProgress = {
  request_id: string;
  status: 'running' | 'finished' | 'failed' | 'cancelled' | 'unknown';
  events: ParseProgressEvent[];
};

export type ParseRequestIdHandler = (requestId: string) => void;

export type LinkPreview = {
  kind: 'youtube' | 'reddit' | 'tiktok' | 'instagram' | 'facebook' | 'web' | 'unknown';
  title: string;
  image_url: string | null;
  hostname: string;
};

export type AtlasChatResponse = {
  session_id: string;
  conversation_id?: string | null;
  response: string;
  place_cards?: Array<{
    places: Array<{
      name: string;
      latitude: number;
      longitude: number;
      subtitle?: string;
      category?: string;
      description?: string;
    }>;
    status: 'pending' | 'pin_done' | 'save_done' | 'done';
  }>;
  pending_action?: {
    action_id: string;
    kind: 'save_places' | 'create_atlas' | 'save_special_place' | 'delete_special_place';
    title: string;
    places: Array<{
      name: string;
      latitude: number;
      longitude: number;
      subtitle?: string;
      category?: string;
      description?: string;
      external_id?: string | null;
      photo_url?: string | null;
      city?: string | null;
      region?: string | null;
      country?: string | null;
      timeline_day?: number | null;
      timeline_time?: string | null;
      transport?: AtlasTransportMode | null;
      visit_duration_minutes?: number | null;
      travel_duration_minutes?: number | null;
    }>;
    planning_note?: string | null;
    special_role?: 'home' | 'office' | 'school' | null;
    operation?: 'create' | 'update' | 'delete' | null;
  } | null;
  presentation?: AtlasChatPresentation | null;
  locations: Array<{
    name: string;
    latitude: number;
    longitude: number;
    full_address?: string;
    sentiment?: 'positive' | 'neutral' | 'negative' | null;
    description?: string | null;
    category?: string | null;
    photo_url?: string | null;
    city?: string | null;
    region?: string | null;
    country?: string | null;
    timeline_day?: number | null;
    timeline_time?: string | null;
    transport?: AtlasTransportMode | null;
  }>;
  route?: unknown;
  tool_calls_used: string[];
  status: string;
  partial: boolean;
  metrics?: {
    latency_ms: number;
    tool_call_count: number;
    input_tokens?: number | null;
    output_tokens?: number | null;
  };
};

export type AtlasSpecialPlace = {
  role: 'home' | 'office' | 'school';
  name: string;
  latitude: number;
  longitude: number;
  full_address?: string;
};

export type AtlasChatPresentation = {
  kind: 'nearby_map' | 'places_map' | 'atlas_draft';
  title: string;
  user_location?: { longitude: number; latitude: number };
  places: Array<{
    name: string;
    latitude: number;
    longitude: number;
    full_address?: string;
    description?: string | null;
    category?: string;
    external_id?: string | null;
    photo_url?: string | null;
    city?: string | null;
    region?: string | null;
    country?: string | null;
    timeline_day?: number | null;
    timeline_time?: string | null;
    transport?: AtlasTransportMode | null;
    visit_duration_minutes?: number | null;
    travel_duration_minutes?: number | null;
  }>;
  planning_note?: string | null;
  special_places?: Array<{
    role: 'home' | 'office' | 'school';
    name: string;
    latitude: number;
    longitude: number;
    full_address?: string;
  }>;
  /** The explicitly requested end point of a commute, even while its route loads. */
  commute_destination?: {
    role: 'home' | 'office' | 'school';
    name: string;
    latitude: number;
    longitude: number;
    full_address?: string;
  } | null;
  route?: {
    route?: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>;
    distance_km?: number;
    duration_minutes?: number;
  } | null;
  commute_route?: {
    route?: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>;
    distance_km?: number;
    duration_minutes?: number;
  } | null;
};

type AtlasChatStreamEvent =
  | { type: 'token'; delta: string }
  | { type: 'status'; label: string }
  | { type: 'complete' } & AtlasChatResponse
  | { type: 'error'; message: string };

type AtlasChatStreamHandlers = {
  onToken: (delta: string) => void;
  onStatus?: (label: string) => void;
};

export type AtlasRouteResponse = {
  route: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>;
  distance_km: number;
  duration_minutes: number;
};

/** Road-network route for an ordered Atlas. The backend retains the token. */
export function requestAtlasRoute(coordinates: Array<[number, number]>): Promise<AtlasRouteResponse> {
  return postJson<AtlasRouteResponse>('/atlas/route', { coordinates });
}

type MapboxRouteResponse = { routes?: Array<{ geometry: GeoJSON.Geometry; distance: number; duration: number }>; code?: string };
type MapboxOptimizationResponse = { routes?: Array<{ geometry: GeoJSON.Geometry; distance: number; duration: number }>; waypoints?: Array<{ waypoint_index: number; trips_index: number; location: [number, number] }>; code?: string };
type MapboxGeocodingResponse = { features?: Array<{ center?: [number, number]; bbox?: [number, number, number, number]; text?: string; place_name?: string; place_type?: string[] }> };
export type AtlasAreaGeocode = { center: [number, number]; bounds?: { ne: [number, number]; sw: [number, number] }; label?: string; subtitle?: string; featureType?: string };

async function mapboxRequest<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!MAPBOX_ACCESS_TOKEN) throw new Error('Mapbox access token is not configured');
  const response = await fetch(
    `https://api.mapbox.com${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(MAPBOX_ACCESS_TOKEN)}`,
    { signal },
  );
  if (!response.ok) throw new Error(`Mapbox request failed (${response.status})`);
  return response.json() as Promise<T>;
}

/** Resolves a named Focus area before the Atlas editor builds its camera. */
export async function geocodeAtlasArea(query: string, signal?: AbortSignal): Promise<AtlasAreaGeocode | null> {
  if (!query.trim()) return null;
  try {
    const result = await mapboxRequest<MapboxGeocodingResponse>(
      `/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?types=place,region,country&limit=1`,
      signal,
    );
    const feature = result.features?.[0];
    const center = feature?.center;
    if (!center || !Number.isFinite(center[0]) || !Number.isFinite(center[1])) return null;
    const bbox = feature?.bbox;
    const bounds = bbox && bbox.every(Number.isFinite)
      ? { ne: [bbox[2], bbox[3]] as [number, number], sw: [bbox[0], bbox[1]] as [number, number] }
      : undefined;
    return {
      center,
      bounds,
      label: feature.text ?? feature.place_name,
      subtitle: feature.place_name,
      featureType: feature.place_type?.[0],
    };
  } catch (error) {
    if (signal?.aborted) return null;
    console.warn('[apiService] Focus-area geocoding failed', error);
    return null;
  }
}

/** Fast, ordered road route used immediately by the Atlas map. */
export async function requestMapboxDirections(coordinates: Array<[number, number]>): Promise<AtlasRouteResponse> {
  const encoded = coordinates.map(([longitude, latitude]) => `${longitude},${latitude}`).join(';');
  const result = await mapboxRequest<MapboxRouteResponse>(`/directions/v5/mapbox/driving/${encoded}?geometries=geojson&overview=full`);
  const route = result.routes?.[0];
  if (!route || route.geometry.type !== 'LineString') throw new Error('Mapbox returned no driving route');
  return { route: { type: 'Feature', properties: {}, geometry: route.geometry }, distance_km: route.distance / 1000, duration_minutes: route.duration / 60000 };
}

/** Background route-order suggestion. The returned waypoint indexes preserve the optimization result. */
export async function requestMapboxOptimization(coordinates: Array<[number, number]>): Promise<{ route: AtlasRouteResponse; order: number[] }> {
  const encoded = coordinates.map(([longitude, latitude]) => `${longitude},${latitude}`).join(';');
  const result = await mapboxRequest<MapboxOptimizationResponse>(`/optimized-trips/v1/mapbox/driving/${encoded}?geometries=geojson&overview=full&source=any&destination=any&roundtrip=false`);
  const route = result.routes?.[0];
  const order = (result.waypoints ?? [])
    .map((waypoint, originalIndex) => ({ originalIndex, visitIndex: waypoint.waypoint_index }))
    .sort((a, b) => a.visitIndex - b.visitIndex)
    .map(({ originalIndex }) => originalIndex);
  if (!route || route.geometry.type !== 'LineString' || order.length < 2) throw new Error('Mapbox returned no optimized route');
  return { route: { route: { type: 'Feature', properties: {}, geometry: route.geometry }, distance_km: route.distance / 1000, duration_minutes: route.duration / 60000 }, order };
}

export async function transcribeAudio(uri: string): Promise<{ text: string }> {
  const form = new FormData();
  // Expo File is a native Blob backed by the recorder's file URI. This avoids
  // the legacy URI-object FormData path rejected by the current fetch bridge.
  const audioFile = new File(uri);
  form.append('file', audioFile, 'atlas-note.m4a');
  const response = await fetch(`${API_BASE_URL}/speech/transcribe`, {
    method: 'POST',
    headers: await authHeaders(),
    body: form,
  });
  if (!response.ok) throw new Error(`Speech API error (${response.status})`);
  return response.json() as Promise<{ text: string }>;
}

export type MemoryRecord = {
  id: string;
  key: string;
  value: string;
  category: string;
  updated_at?: string;
};

export type ConversationSummaryRecord = {
  id: string;
  conversation_id: string;
  summary: string;
  start_message_index: number;
  end_message_index: number;
  created_at?: string;
  updated_at?: string;
};

export type ConversationSummary = {
  id: string;
  title: string;
  source_url?: string | null;
  location_count?: number;
  message_count?: number;
  created_at?: string;
  updated_at?: string;
};

export type ConversationDetailResponse = {
  status: string;
  session: {
    session_id: string;
    conversation_id?: string | null;
    source_url?: string | null;
    source_type?: string | null;
    title?: string;
    locations?: Array<{
      name: string;
      latitude: number;
      longitude: number;
      full_address?: string;
      sentiment?: 'positive' | 'neutral' | 'negative' | null;
      description?: string | null;
      category?: string | null;
    }>;
    route?: unknown;
    removed_noise?: unknown;
    removed_hierarchy?: unknown;
    inferred_region?: string | null;
    is_multi_region?: boolean;
    message_count?: number;
    created_at?: number;
    updated_at?: number;
  };
  messages: Array<{
    role: string;
    content: string;
    tool_results?: unknown;
  }>;
};

export type CreateSessionResponse = {
  session_id: string;
  conversation_id?: string | null;
  title: string;
  location_count: number;
  message_count: number;
};

function createRequestId(): string {
  return `parse_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function pollProgress(
  requestId: string,
  onProgress?: (progress: ParseProgress) => void,
): Promise<{ stop: () => void; refresh: () => Promise<void> }> {
  let stopped = false;

  const tick = async () => {
    if (stopped || !onProgress) return;
    try {
      const progress = await getJson<ParseProgress>(`/parse_progress/${requestId}`);
      onProgress(progress);
      if (progress.status === 'finished' || progress.status === 'failed' || progress.status === 'cancelled') {
        stopped = true;
      }
    } catch (error) {
      console.warn('[apiService] progress poll failed:', error);
    }
  };

  const intervalId = setInterval(tick, 1000);
  await tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(intervalId);
    },
    // The response is only returned after the backend finishes, so one final
    // refresh captures the terminal user-facing stage before the UI advances.
    refresh: tick,
  };
}

async function postParseWithProgress<T>(
  path: string,
  body: Record<string, unknown>,
  onProgress?: (progress: ParseProgress) => void,
  onRequestId?: ParseRequestIdHandler,
): Promise<T> {
  const requestId = createRequestId();
  onRequestId?.(requestId);
  const progressPolling = await pollProgress(requestId, onProgress);
  try {
    const result = await postJson<T>(path, { ...body, request_id: requestId });
    await progressPolling.refresh();
    return result;
  } finally {
    progressPolling.stop();
  }
}

/**
 * Send a URL to the backend for location extraction and route planning.
 *
 * @param url - A Reddit (or any web) post URL
 * @returns Parsed result with locations and route
 */
export async function parseLink(
  url: string,
  onProgress?: (progress: ParseProgress) => void,
  onRequestId?: ParseRequestIdHandler,
): Promise<ParseResult> {
  return postParseWithProgress<ParseResult>('/parse_link', { url }, onProgress, onRequestId);
}

/**
 * Send user-pasted text to the backend for location extraction.
 *
 * For sources we can't scrape (Xiaohongshu notes, WeChat articles, text a
 * friend sent) — the user copies the content and pastes it in.
 *
 * @param text - Pasted content (travel notes, itinerary text, etc.)
 * @returns Parsed result with locations and route
 */
export async function parseText(
  text: string,
  webSearch = false,
  onProgress?: (progress: ParseProgress) => void,
  onRequestId?: ParseRequestIdHandler,
): Promise<ParseResult> {
  return postParseWithProgress<ParseResult>('/parse_text', { text, web_search: webSearch }, onProgress, onRequestId);
}

export async function createChatSession(payload?: {
  title?: string;
  source_url?: string;
  source_type?: string;
  locations?: Array<{
    name: string;
    latitude: number;
    longitude: number;
    full_address?: string;
    sentiment?: 'positive' | 'neutral' | 'negative' | null;
    description?: string | null;
    category?: string | null;
  }>;
  user_location?: [number, number];
}): Promise<CreateSessionResponse> {
  return postJson<CreateSessionResponse>('/sessions', payload ?? {});
}

/**
 * Creates the assistant-first opening for an import after the user has saved
 * their selected places. The excluded places are context only; they are never
 * attached to the chat map or persisted as active conversation locations.
 */
export async function createImportChatWelcome(
  sessionId: string,
  deselectedLocations: Array<{
    name: string;
    latitude: number;
    longitude: number;
    full_address?: string;
    category?: string;
  }>,
  welcomeText?: string,
): Promise<AtlasChatResponse> {
  return postJson<AtlasChatResponse>(`/sessions/${encodeURIComponent(sessionId)}/import-welcome`, {
    deselected_locations: deselectedLocations,
    welcome_text: welcomeText,
  });
}

/** Creates the assistant-first opening message for a saved Atlas edit. */
export async function createAtlasChatWelcome(
  sessionId: string,
  places: AtlasChatPresentation['places'],
): Promise<AtlasChatResponse> {
  return postJson<AtlasChatResponse>(`/sessions/${encodeURIComponent(sessionId)}/atlas-welcome`, { locations: places });
}

export async function chatWithAtlas(
  sessionId: string,
  message: string,
  conversationId?: string | null,
  userLocation?: [number, number],
  specialPlaces?: AtlasSpecialPlace[],
  imageBase64?: string | null,
): Promise<AtlasChatResponse> {
  return postJson<AtlasChatResponse>('/chat', {
    session_id: sessionId,
    message,
    conversation_id: conversationId ?? undefined,
    user_location: userLocation,
    special_places: specialPlaces,
    image_base64: imageBase64 ?? undefined,
  });
}

/**
 * Read the chat response as NDJSON so native clients can render model output
 * immediately instead of waiting for the final assistant message.
 */
export async function chatWithAtlasStream(
  sessionId: string,
  message: string,
  handlers: AtlasChatStreamHandlers,
  conversationId?: string | null,
  userLocation?: [number, number],
  specialPlaces?: AtlasSpecialPlace[],
  imageBase64?: string | null,
  signal?: AbortSignal,
): Promise<AtlasChatResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(`${API_BASE_URL}/chat/stream`, {
      method: 'POST',
      headers: {
        Accept: 'application/x-ndjson',
        'Content-Type': 'application/json',
        ...(await authHeaders()),
      },
      body: JSON.stringify({
        session_id: sessionId,
        message,
        conversation_id: conversationId ?? undefined,
        user_location: userLocation,
        special_places: specialPlaces,
        image_base64: imageBase64 ?? undefined,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`API error (${response.status}): ${errorBody || response.statusText}`);
    }
    if (!response.body) throw new Error('Streaming is not available on this device.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed: AtlasChatResponse | null = null;

    const consumeLine = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as AtlasChatStreamEvent;
      if (event.type === 'token') {
        handlers.onToken(event.delta);
      } else if (event.type === 'status') {
        handlers.onStatus?.(event.label);
      } else if (event.type === 'complete') {
        completed = event;
      } else {
        throw new Error(event.message);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(consumeLine);
      if (done) break;
    }
    buffer += decoder.decode();
    consumeLine(buffer);

    if (!completed) throw new Error('The chat stream ended before completing.');
    return completed;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`请求超时：后端处理超过 ${REQUEST_TIMEOUT_MS / 1000}s，请稍后再试`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abort);
  }
}

export async function confirmAtlasChatAction(
  sessionId: string,
  actionId: string,
  accepted: boolean,
  outcome?: Record<string, unknown>,
): Promise<void> {
  await postJson('/chat/actions/confirm', {
    session_id: sessionId,
    action_id: actionId,
    accepted,
    outcome,
  });
}

export async function discoverAtlasPlaces(
  query: string,
  onProgress?: (progress: ParseProgress) => void,
  onRequestId?: ParseRequestIdHandler,
  options?: { sessionId?: string; excludedPlaceNames?: string[] },
): Promise<ParseResult> {
  return postParseWithProgress<ParseResult>('/atlas_ai/discover', {
    query,
    session_id: options?.sessionId,
    exclude_place_names: options?.excludedPlaceNames,
  }, onProgress, onRequestId);
}

export async function scanUrl(
  url: string,
  onProgress?: (progress: ParseProgress) => void,
  onRequestId?: ParseRequestIdHandler,
): Promise<ParseResult> {
  // Compatibility route for older clients. New Any Links imports use parseLink
  // so every generic URL shares the Universal Web Agent pipeline.
  return postParseWithProgress<ParseResult>('/scan_url', { url }, onProgress, onRequestId);
}

export async function getLinkPreview(url: string, signal?: AbortSignal): Promise<LinkPreview> {
  const response = await fetch(`${API_BASE_URL}/link_preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ url }),
    signal,
  });
  if (!response.ok) throw new Error('Unable to load link preview');
  return response.json() as Promise<LinkPreview>;
}

export async function parseYoutube(
  url: string,
  onProgress?: (progress: ParseProgress) => void,
  onRequestId?: ParseRequestIdHandler,
): Promise<ParseResult> {
  return postParseWithProgress<ParseResult>('/parse_youtube', { url }, onProgress, onRequestId);
}

export async function parseTikTok(
  url: string,
  onProgress?: (progress: ParseProgress) => void,
  onRequestId?: ParseRequestIdHandler,
): Promise<ParseResult> {
  return postParseWithProgress<ParseResult>('/parse_tiktok', { url }, onProgress, onRequestId);
}

export async function parseInstagramReel(
  url: string,
  onProgress?: (progress: ParseProgress) => void,
  onRequestId?: ParseRequestIdHandler,
): Promise<ParseResult> {
  return postParseWithProgress<ParseResult>('/parse_instagram_reel', { url }, onProgress, onRequestId);
}

export async function parseFacebookReel(
  url: string,
  onProgress?: (progress: ParseProgress) => void,
  onRequestId?: ParseRequestIdHandler,
): Promise<ParseResult> {
  return postParseWithProgress<ParseResult>('/parse_facebook_reel', { url }, onProgress, onRequestId);
}

/**
 * Find image places — identify geographic location from an image.
 * Uses Google Cloud Vision landmark detection + optional DeepSeek vision fallback.
 */
export async function findImagePlace(
  imageBase64: string,
  onProgress?: (progress: ParseProgress) => void,
  onRequestId?: ParseRequestIdHandler,
): Promise<ParseResult> {
  return postParseWithProgress<ParseResult>('/find_image_places', { image: imageBase64 }, onProgress, onRequestId);
}

export async function scanImagesBase64(
  images: string[],
  onProgress?: (progress: ParseProgress) => void,
  onRequestId?: ParseRequestIdHandler,
): Promise<ParseResult> {
  return postParseWithProgress<ParseResult>('/scan_images_base64', { images }, onProgress, onRequestId);
}

export async function cancelParseRequest(requestId: string): Promise<{ cancelled: boolean }> {
  return postJson<{ cancelled: boolean }>(`/parse_progress/${encodeURIComponent(requestId)}/cancel`, {});
}

export type RegionPhotoResponse = { region: string; photo_url: string | null; photo_urls?: string[] };
export type PlacePhotoResponse = { name: string; photo_url: string | null };

export async function getRegionPhoto(region: string): Promise<RegionPhotoResponse> {
  const query = encodeURIComponent(region.trim());
  return getJson<RegionPhotoResponse>(`/region_photo?query=${query}`);
}

export async function getPlacePhoto(name: string): Promise<PlacePhotoResponse> {
  const query = encodeURIComponent(name.trim());
  return getJson<PlacePhotoResponse>(`/place_photo?name=${query}`);
}

export type PlaceSuggestResponse = {
  query: string;
  session_token: string;
  suggestions: PlaceSuggestion[];
  attribution: string;
};

export type PlaceRetrieveResponse = {
  locations: GeocodedLocation[];
  attribution: string;
};

/**
 * Typeahead place search. `sessionToken` is generated by the caller and must be
 * the same one passed to `retrievePlace()` for the place the user picks —
 * Mapbox bills the session, not the keystrokes.
 *
 * Pass `signal` to cancel a request the user has already typed past.
 */
export async function searchPlaces(
  params: {
    query: string;
    sessionToken: string;
    proximity?: [number, number];
    limit?: number;
    language?: string;
    country?: string;
    types?: string;
  },
  signal?: AbortSignal,
): Promise<PlaceSuggestResponse> {
  const search = new URLSearchParams({
    q: params.query,
    session_token: params.sessionToken,
  });
  if (params.proximity) search.set('proximity', `${params.proximity[0]},${params.proximity[1]}`);
  if (params.limit) search.set('limit', String(params.limit));
  if (params.language) search.set('language', params.language);
  if (params.country) search.set('country', params.country);
  if (params.types) search.set('types', params.types);

  // Mapbox search endpoints are public application queries. Avoid waiting for
  // Supabase session hydration before every keystroke.
  return getJson<PlaceSuggestResponse>(`/places/search?${search.toString()}`, signal, false);
}

/** Resolve one suggestion into saveable places. Returns a list: a `brand`
    suggestion resolves to every branch, not to a single location. */
export async function retrievePlace(
  externalId: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<PlaceRetrieveResponse> {
  const search = new URLSearchParams({ session_token: sessionToken });
  return getJson<PlaceRetrieveResponse>(
    `/places/retrieve/${encodeURIComponent(externalId)}?${search.toString()}`,
    signal,
    false,
  );
}

export async function fetchMemories(): Promise<MemoryRecord[]> {
  const data = await getJson<{ memories: MemoryRecord[] }>('/memories');
  return data.memories || [];
}

export async function fetchConversations(): Promise<ConversationSummary[]> {
  const data = await getJson<{ conversations: ConversationSummary[] }>('/conversations');
  return data.conversations || [];
}

export async function fetchConversation(conversationId: string): Promise<ConversationDetailResponse> {
  return getJson(`/conversations/${conversationId}`);
}
