/**
 * Local events near a coordinate, from the backend's `GET /events`.
 *
 * Coverage is the DMV only — the backend's sources are a DMV park list, a
 * radius query against the USDA market directory, and a curated DMV set. A
 * caller somewhere else gets an empty list and no error, which is why
 * `isEmptyAwayFromCoverage` exists: an empty result is far more likely to mean
 * "you are not in the DMV" than "nothing is on".
 */

import type { EventCategory, EventsResult } from '@/types/event';
import Constants from 'expo-constants';

const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string) || 'http://localhost:8000';

/** Long enough for a cold cache to fan out to every upstream source. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Matches the backend default: wide enough to reach the signature festivals,
    several of which sit just past an hour's drive from the centre. */
export const DEFAULT_RADIUS_KM = 60;
export const DEFAULT_WINDOW_DAYS = 30;

export type EventsQuery = {
  /** `[lng, lat]`, matching `HomeContext.userLocation`. */
  coordinate: [number, number];
  radiusKm?: number;
  windowDays?: number;
  categories?: EventCategory[];
  sort?: 'distance' | 'soonest';
  limit?: number;
};

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * The same image at the width the caller actually draws it.
 *
 * The stock imagery arrives sized for the largest use — the detail hero — so a
 * list row would otherwise decode a 250KB, 800px JPEG into a 72pt box, once per
 * visible row. Asking the CDN for the real width cuts that by an order of
 * magnitude. Only Unsplash URLs carry a `w` parameter; anything else (NPS
 * photos, which have no resizing endpoint) is returned untouched.
 */
export function sizedEventImage(url: string | null, width: number): string | null {
  if (!url || !url.includes('images.unsplash.com')) return url;
  return url.replace(/([?&])w=\d+/, `$1w=${Math.round(width)}`);
}

export async function fetchEvents(
  query: EventsQuery,
  signal?: AbortSignal,
): Promise<EventsResult> {
  const [lng, lat] = query.coordinate;

  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius_km: String(query.radiusKm ?? DEFAULT_RADIUS_KM),
    window_days: String(query.windowDays ?? DEFAULT_WINDOW_DAYS),
  });
  if (query.categories?.length) params.set('categories', query.categories.join(','));
  if (query.sort) params.set('sort', query.sort);
  if (query.limit) params.set('limit', String(query.limit));

  // The caller's own signal and the timeout both have to be able to abort the
  // request, and `AbortSignal.any` is not available in this runtime.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort);

  try {
    const response = await fetch(`${API_BASE_URL}/events?${params}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Events unavailable (${response.status})`);
    }
    return (await response.json()) as EventsResult;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

/**
 * True when the request succeeded but found nothing, which outside the DMV is
 * the expected outcome rather than a failure worth reporting as one.
 */
export function isEmptyAwayFromCoverage(result: EventsResult): boolean {
  return (
    result.events.length === 0 &&
    result.sources.some((source) => source.status === 'ok')
  );
}

/** Sources that failed outright, for a "some feeds are down" note. */
export function failedSources(result: EventsResult): string[] {
  return result.sources
    .filter((source) => source.status === 'unavailable')
    .map((source) => source.id);
}
