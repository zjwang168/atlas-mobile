/**
 * Import / link-parsing service.
 *
 * This is the single seam between the UI and the parser backend. It calls the
 * real FastAPI backend via apiService and adapts responses to the UI contract
 * below. parseInput() auto-detects whether the pasted content is a URL
 * (scrape + parse via /parse_link) or plain text (parse directly via
 * /parse_text — covers Xiaohongshu, WeChat, copied notes).
 */

import {
  discoverAtlasPlaces as apiDiscoverAtlasPlaces,
  findImagePlace as apiFindImagePlace,
  parseLink as apiParseLink,
  parseText as apiParseText,
  parseYoutube as apiParseYoutube,
  scanUrl as apiScanUrl,
  type ParseProgress,
} from '../api/apiService';

export type ParsedPlace = {
  id: string;
  stableKey?: string;
  name: string;
  subtitle: string;
  type: string;
  latitude: number;
  longitude: number;
  /** Optional thumbnail for the place row. */
  imageUri?: string;
  sentiment?: 'positive' | 'neutral' | 'negative' | null;
  /**
   * Provider's own id for this place and which provider it is, persisted to
   * `places.external_place_id` / `external_source`. Set by place search;
   * the parse pipelines leave both unset.
   */
  externalId?: string;
  externalSource?: string;
};

export type ParseResult = {
  /** Caption/title extracted from the source, shown in the top pill. */
  sourceTitle: string;
  /** Optional thumbnail of the source link. */
  sourceThumbnail?: string;
  /** Map center to frame the extracted places. */
  centerCoordinate: [number, number];
  /** Region/city the places were grouped under, if any. */
  region?: string;
  places: ParsedPlace[];
};

/** Shape of one location item returned by the backend. */
type BackendLocation = {
  name: string;
  latitude: number;
  longitude: number;
  full_address?: string;
  description?: string | null;
  category?: string | null;
  sentiment?: 'positive' | 'neutral' | 'negative' | null;
  photo_url?: string | null;
};

/** Fields of the backend parse response that we consume. */
type BackendParseResponse = {
  title: string;
  locations: BackendLocation[];
  inferred_region?: string | null;
};

/** True for strings that look like a pasteable URL. */
function looksLikeUrl(value: string): boolean {
  return /^(https?:\/\/|www\.)\S+$/i.test(value.trim());
}

/** Median center of the extracted places — robust to a stray bad geocode. */
function medianCenter(places: BackendLocation[]): [number, number] {
  if (places.length === 0) return [0, 0];
  const mid = (values: number[]) => {
    const s = [...values].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return [mid(places.map((p) => p.longitude)), mid(places.map((p) => p.latitude))];
}

/** Adapt the backend response to the UI contract. */
function adaptResponse(backend: BackendParseResponse): ParseResult {
  const places: ParsedPlace[] = (backend.locations ?? []).map((loc, index) => ({
    id: String(index + 1),
    stableKey: buildPlaceStableKey({
      name: loc.name,
      latitude: loc.latitude,
      longitude: loc.longitude,
      category: loc.category,
    }),
    name: loc.name,
    subtitle: formatSubtitle(loc),
    type: loc.category || 'Place',
    latitude: loc.latitude,
    longitude: loc.longitude,
    // Backend photo enrichment uses `photo_url`; import screens already carry
    // thumbnails as `imageUri`, and placeService persists that value on save.
    imageUri: loc.photo_url ?? undefined,
    sentiment: loc.sentiment ?? null,
  }));

  return {
    sourceTitle: backend.title || 'Imported content',
    centerCoordinate: medianCenter(backend.locations ?? []),
    region: backend.inferred_region ?? undefined,
    places,
  };
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function looksLikeAddress(value: string): boolean {
  return /\d/.test(value) && /\b(st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|ln|lane|way|pkwy|parkway|hwy|highway|ct|court|pl|place|sq|square)\b/i.test(value);
}

function normalizeStableCategory(value?: string | null): string {
  const normalized = normalizeLabel(value || '');
  return normalized === 'place' ? '' : normalized;
}

export function buildPlaceStableKey(loc: {
  name: string;
  latitude: number;
  longitude: number;
  category?: string | null;
}): string {
  const parts = [
    normalizeLabel(loc.name || ''),
    normalizeStableCategory(loc.category || ''),
    loc.latitude.toFixed(5),
    loc.longitude.toFixed(5),
  ].filter(Boolean);
  return parts.join('|');
}

export function shouldShowAddress(loc: BackendLocation): boolean {
  const name = normalizeLabel(loc.name || '');
  const address = normalizeLabel(loc.full_address || '');
  if (!address) return false;
  if (!name) return true;
  if (looksLikeAddress(loc.name || '')) return true;
  return false;
}

export function formatSubtitle(loc: BackendLocation): string {
  const description = (loc.description || '').trim();
  const address = (loc.full_address || '').trim();
  if (description && address && description !== address) {
    return `${description}${description.endsWith('.') ? '' : '.'} ${address}`;
  }
  return description || address || '';
}

export function formatParsedPlaceSubtitle(loc: BackendLocation): string {
  return formatSubtitle(loc);
}

/**
 * Parse a pasted URL into places by calling the backend parser.
 */
export type ParseProgressHandler = (progress: ParseProgress) => void;

export async function parseLink(
  input: string,
  onProgress?: ParseProgressHandler,
): Promise<ParseResult> {
  const backend = (await apiParseLink(input.trim(), onProgress)) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}

/**
 * Parse pasted plain text (travel notes, Xiaohongshu content, etc.).
 */
export async function parseText(
  input: string,
  options?: { webSearch?: boolean },
  onProgress?: ParseProgressHandler,
): Promise<ParseResult> {
  const backend = (await apiParseText(input.trim(), options?.webSearch ?? false, onProgress)) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}

/**
 * Parse anything the user pastes: URLs are scraped server-side; everything
 * else is treated as raw text and parsed directly.
 */
export async function parseInput(
  input: string,
  onProgress?: ParseProgressHandler,
): Promise<ParseResult> {
  return looksLikeUrl(input) ? parseLink(input, onProgress) : parseText(input, undefined, onProgress);
}

export async function discoverFromAtlasQuery(
  input: string,
  onProgress?: ParseProgressHandler,
): Promise<ParseResult> {
  const backend = (await apiDiscoverAtlasPlaces(input.trim(), onProgress)) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}

export async function scanAnyLink(
  input: string,
  onProgress?: ParseProgressHandler,
): Promise<ParseResult> {
  const backend = (await apiScanUrl(input.trim(), onProgress)) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}

export async function parseYoutubeLink(
  input: string,
  onProgress?: ParseProgressHandler,
): Promise<ParseResult> {
  const backend = (await apiParseYoutube(input.trim(), onProgress)) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}

/**
 * Identify a geographic place from a single image using Google Cloud Vision
 * landmark detection + optional DeepSeek vision fallback.
 */
export async function findImagePlace(
  imageBase64: string,
  onProgress?: ParseProgressHandler,
): Promise<ParseResult> {
  const backend = (await apiFindImagePlace(imageBase64, onProgress)) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}
