import { ParseResult } from '@/types/route';
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
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);
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
  status: 'running' | 'finished' | 'failed' | 'unknown';
  events: ParseProgressEvent[];
};

export type AtlasChatResponse = {
  session_id: string;
  response: string;
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
): Promise<() => void> {
  let stopped = false;

  const tick = async () => {
    if (stopped || !onProgress) return;
    try {
      const progress = await getJson<ParseProgress>(`/parse_progress/${requestId}`);
      onProgress(progress);
      if (progress.status === 'finished' || progress.status === 'failed') {
        stopped = true;
      }
    } catch (error) {
      console.warn('[apiService] progress poll failed:', error);
    }
  };

  const intervalId = setInterval(tick, 1000);
  await tick();

  return () => {
    stopped = true;
    clearInterval(intervalId);
  };
}

async function postParseWithProgress<T>(
  path: string,
  body: Record<string, unknown>,
  onProgress?: (progress: ParseProgress) => void,
): Promise<T> {
  const requestId = createRequestId();
  const stopPolling = await pollProgress(requestId, onProgress);
  try {
    return await postJson<T>(path, { ...body, request_id: requestId });
  } finally {
    stopPolling();
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
): Promise<ParseResult> {
  return postParseWithProgress<ParseResult>('/parse_link', { url }, onProgress);
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
): Promise<ParseResult> {
  return postParseWithProgress<ParseResult>('/parse_text', { text, web_search: webSearch }, onProgress);
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

export async function chatWithAtlas(sessionId: string, message: string): Promise<AtlasChatResponse> {
  return postJson<AtlasChatResponse>('/chat', {
    session_id: sessionId,
    message,
  });
}

export async function discoverAtlasPlaces(
  query: string,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ParseResult> {
  return postParseWithProgress<ParseResult>('/atlas_ai/discover', { query }, onProgress);
}

export async function scanUrl(
  url: string,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ParseResult> {
  return postParseWithProgress<ParseResult>('/scan_url', { url }, onProgress);
}

export async function parseYoutube(
  url: string,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ParseResult> {
  return postParseWithProgress<ParseResult>('/parse_youtube', { url }, onProgress);
}

/**
 * Find image places — identify geographic location from an image.
 * Uses Google Cloud Vision landmark detection + optional DeepSeek vision fallback.
 */
export async function findImagePlace(
  imageBase64: string,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ParseResult> {
  return postParseWithProgress<ParseResult>('/find_image_places', { image: imageBase64 }, onProgress);
}

export async function fetchMemories(): Promise<MemoryRecord[]> {
  const data = await getJson<{ memories: MemoryRecord[] }>('/memories');
  return data.memories || [];
}

export async function fetchConversations(): Promise<Array<{
  id: string;
  title: string;
  source_url?: string | null;
  location_count?: number;
  message_count?: number;
  created_at?: string;
  updated_at?: string;
}>> {
  const data = await getJson<{ conversations: Array<{
    id: string;
    title: string;
    source_url?: string | null;
    location_count?: number;
    message_count?: number;
    created_at?: string;
    updated_at?: string;
  }> }>('/conversations');
  return data.conversations || [];
}

export async function fetchConversation(conversationId: string): Promise<{
  session_id: string;
  conversation_id?: string;
  title?: string;
  message_count?: number;
  summary_message_count?: number;
  conversation_summary?: string;
  messages?: Array<{ role: string; content: string }>;
}> {
  return getJson(`/conversations/${conversationId}`);
}
