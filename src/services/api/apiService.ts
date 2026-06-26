import Constants from 'expo-constants';
import { ParseResult } from '../types/route';

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
 * Send a Reddit URL to the backend for location extraction and route planning.
 *
 * @param url - A Reddit post URL
 * @returns Parsed result with locations and route
 */
export async function parseLink(url: string): Promise<ParseResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}/parse_link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `API error (${response.status}): ${errorBody || response.statusText}`,
      );
    }

    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}
