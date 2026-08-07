/**
 * Place search — turns typed text into saveable places through the backend's
 * Mapbox Search Box endpoints.
 *
 * Search is two steps: suggestions carry no coordinates, and the one the user
 * picks is resolved into a full place. Both steps share a session token, which
 * is created here rather than on the server because Mapbox bills a search
 * session and only the client knows when a typing session begins and ends.
 */

import type { GeocodedLocation, PlaceSuggestion } from '@/types/route';

import { retrievePlace, searchPlaces } from '../api/apiService';
import { buildPlaceStableKey, formatSubtitle, type ParsedPlace } from '../import/importService';

/** Rows shown to the user. */
export const SEARCH_DISPLAY_LIMIT = 8;

/** Asked of the backend. Higher than the display limit because non-`poi`
    suggestions are filtered out afterwards and would otherwise eat slots. */
const SEARCH_REQUEST_LIMIT = 10;

/** Shortest query worth a round trip; the backend rejects anything shorter. */
export const MIN_QUERY_LENGTH = 2;

/**
 * Start a search session. Hold one for a whole typing session and pass it to
 * every `suggest` plus the final `resolve`, then drop it — a fresh token per
 * keystroke would bill each keystroke as its own session.
 */
export function createSearchSession(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();
  // A session token only has to be unique, not unguessable.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

/** True for the DOMException fetch throws when a request is cancelled. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Only `poi` suggestions are surfaced. The save path is one row = one place,
 * while a `brand` resolves to every branch Mapbox knows about; expanding that
 * into a picker is a different screen. Nearby branches already show up as
 * their own `poi` rows once proximity weighting is applied.
 */
function isSaveable(suggestion: PlaceSuggestion): boolean {
  return suggestion.feature_type === 'poi';
}

/** Suggest places for a partial query. Throws on abort — check `isAbortError`. */
export async function suggestPlaces(
  query: string,
  sessionToken: string,
  options: { proximity?: [number, number]; language?: string; country?: string } = {},
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const response = await searchPlaces(
    {
      query: trimmed,
      sessionToken,
      limit: SEARCH_REQUEST_LIMIT,
      proximity: options.proximity,
      language: options.language,
      country: options.country,
    },
    signal,
  );

  return response.suggestions.filter(isSaveable).slice(0, SEARCH_DISPLAY_LIMIT);
}

/** Adapt one resolved location into the shape the save path already accepts. */
function toParsedPlace(location: GeocodedLocation, index: number): ParsedPlace {
  return {
    id: `search-${index}`,
    stableKey: buildPlaceStableKey({
      name: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      category: location.category,
    }),
    name: location.name,
    subtitle: formatSubtitle(location),
    type: location.category || 'Place',
    latitude: location.latitude,
    longitude: location.longitude,
    imageUri: location.photo_url ?? undefined,
    externalId: location.external_id ?? undefined,
    externalSource: location.source ?? undefined,
    city: location.city ?? undefined,
    country: location.country ?? undefined,
    // location.region is intentionally dropped: `places.region` holds the
    // batch-level inferred region, not a state name.
  };
}

/**
 * Resolve a suggestion the user picked into a saveable place.
 *
 * Returns the first location only. Suggestions are filtered to `poi`, which
 * resolves to exactly one; the extra locations a `brand` would return are not
 * reachable from here.
 */
export async function resolvePlace(
  suggestion: PlaceSuggestion,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<ParsedPlace | null> {
  const response = await retrievePlace(suggestion.external_id, sessionToken, signal);
  const [first] = response.locations;
  return first ? toParsedPlace(first, 0) : null;
}
