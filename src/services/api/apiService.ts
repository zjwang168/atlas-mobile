import { GeocodedLocation, ParseResult, PlaceSuggestion } from '@/types/route';
import { supabase } from '../supabase/supabaseClient';
import Constants from 'expo-constants';

/**
 * Base URL for the FastAPI backend.
 * In development: http://localhost:8000
 * Can be overridden via app.config.js extra.apiBaseUrl
 */
const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string) ||
  'http://localhost:8000';

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

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: await authHeaders(),
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
  kind: 'youtube' | 'reddit' | 'web' | 'unknown';
  title: string;
  image_url: string | null;
  hostname: string;
};

export type AtlasChatResponse = {
  session_id: string;
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
    action: 'pin_in_chat' | 'save_to_my_places' | 'both';
    places: Array<{
      name: string;
      latitude: number;
      longitude: number;
      subtitle?: string;
      category?: string;
      description?: string;
      confidence?: number;
    }>;
  } | null;
  locations: Array<{
    name: string;
    latitude: number;
    longitude: number;
    full_address?: string;
    sentiment?: 'positive' | 'neutral' | 'negative' | null;
    description?: string | null;
    category?: string | null;
  }>;
  route?: unknown;
  tool_calls_used: string[];
  status: string;
  partial: boolean;
};

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
  messages: Array<{ role: string; content: string }>;
};

export type CreateSessionResponse = {
  session_id: string;
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
}): Promise<CreateSessionResponse> {
  return postJson<CreateSessionResponse>('/sessions', payload ?? {});
}

export async function chatWithAtlas(
  sessionId: string,
  message: string,
  conversationId?: string | null,
): Promise<AtlasChatResponse> {
  return postJson<AtlasChatResponse>('/chat', {
    session_id: sessionId,
    message,
    conversation_id: conversationId ?? undefined,
  });
}

export async function discoverAtlasPlaces(
  query: string,
  onProgress?: (progress: ParseProgress) => void,
  onRequestId?: ParseRequestIdHandler,
): Promise<ParseResult> {
  return postParseWithProgress<ParseResult>('/atlas_ai/discover', { query }, onProgress, onRequestId);
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

export async function getRegionPhoto(region: string): Promise<RegionPhotoResponse> {
  const query = encodeURIComponent(region.trim());
  return getJson<RegionPhotoResponse>(`/region_photo?query=${query}`);
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

  return getJson<PlaceSuggestResponse>(`/places/search?${search.toString()}`, signal);
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
