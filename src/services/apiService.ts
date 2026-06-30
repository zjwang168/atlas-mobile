import Constants from 'expo-constants';
import {
  ChatRequest,
  ChatResponse,
  Conversation,
  ConversationDetail,
  ParseResult,
} from '../types/route';

/**
 * Base URL for the FastAPI backend.
 * In development: http://localhost:8000
 * Can be overridden via app.config.js extra.apiBaseUrl
 */
const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string) ||
  'http://localhost:8000';

/** Request timeout in milliseconds (30s — LLM calls can be slow) */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Fetch with timeout helper
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Send a Reddit URL to the backend for location extraction and route planning.
 *
 * @param url - A Reddit post URL
 * @returns Parsed result with locations and route
 */
export async function parseLink(url: string): Promise<ParseResult> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/parse_link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `API error (${response.status}): ${errorBody || response.statusText}`,
    );
  }

  return response.json();
}

/**
 * Send a chat message to an active agent session.
 */
export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Chat error (${response.status}): ${errorBody || response.statusText}`);
  }

  return response.json();
}

/**
 * List all saved conversations.
 */
export async function getConversations(): Promise<Conversation[]> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/conversations`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch conversations (${response.status})`);
  }

  const data = await response.json();
  return data.conversations || [];
}

/**
 * Load a full conversation by ID.
 */
export async function getConversation(id: string): Promise<ConversationDetail> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/conversations/${id}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to load conversation (${response.status})`);
  }

  return response.json();
}

/**
 * Save current session to Supabase.
 */
export async function saveSession(sessionId: string): Promise<{ conversation_id: string; status: string }> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/sessions/${sessionId}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to save session (${response.status})`);
  }

  return response.json();
}

/**
 * Delete a conversation.
 */
export async function deleteConversation(id: string): Promise<boolean> {
  const response = await fetchWithTimeout(`${API_BASE_URL}/conversations/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to delete conversation (${response.status})`);
  }

  const data = await response.json();
  return data.deleted;
}
