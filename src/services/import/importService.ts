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
  parseTikTok as apiParseTikTok,
  parseInstagramReel as apiParseInstagramReel,
  parseFacebookReel as apiParseFacebookReel,
  parseYoutube as apiParseYoutube,
  scanImagesBase64 as apiScanImagesBase64,
  type ParseRequestIdHandler,
  type ParseProgress,
} from '../api/apiService';
import { buildPlaceStableKey } from '../place/placeIdentity';
import { staticMapThumbnail } from '../place/staticMapThumbnail';

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
  confidence?: number | null;
  /**
   * Provider's own id for this place and which provider it is, persisted to
   * `places.external_place_id` / `external_source`. Set by place search;
   * the parse pipelines leave both unset.
   */
  externalId?: string;
  externalSource?: string;
  /**
   * The place's own administrative context, persisted to `places.city` /
   * `country`. Set by place search; the parse pipelines leave both unset.
   *
   * There is deliberately no `region` here. That column means "the region this
   * batch of places was inferred to be in" and is written from savePlaces()'s
   * `source` argument, not from any one place — see savePlaces().
   */
  city?: string;
  country?: string;
  /**
   * The AI's own words about this place, extracted from the source content,
   * persisted to `places.description`. Kept separate from `subtitle`, which
   * concatenates this with the address for the import screens' single line.
   */
  description?: string;
  /** The place's own street address, persisted to `places.address`. */
  address?: string;
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
  /** Which kind of source this came from — 'youtube', 'tiktok', and so on.
      Recorded on `place_sources.source_type` when the places are saved. */
  sourceType?: string;
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
  confidence?: number | null;
  photo_url?: string | null;
};

/** Fields of the backend parse response that we consume. */
type BackendParseResponse = {
  title: string;
  source_thumbnail?: string | null;
  locations: BackendLocation[];
  inferred_region?: string | null;
  source_type?: string | null;
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
    description: (loc.description || '').trim() || undefined,
    address: (loc.full_address || '').trim() || undefined,
    type: loc.category || 'Place',
    latitude: loc.latitude,
    longitude: loc.longitude,
    // Backend photo enrichment uses `photo_url`; import screens already carry
    // thumbnails as `imageUri`, and placeService persists that value on save.
    imageUri: loc.photo_url || staticMapThumbnail(loc.latitude, loc.longitude) || undefined,
    sentiment: loc.sentiment ?? null,
    confidence: loc.confidence ?? null,
  }));

  return {
    sourceTitle: backend.title || 'Imported content',
    sourceThumbnail: backend.source_thumbnail || undefined,
    centerCoordinate: medianCenter(backend.locations ?? []),
    region: backend.inferred_region ?? undefined,
    sourceType: backend.source_type ?? undefined,
    places,
  };
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function looksLikeAddress(value: string): boolean {
  return /\d/.test(value) && /\b(st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|ln|lane|way|pkwy|parkway|hwy|highway|ct|court|pl|place|sq|square)\b/i.test(value);
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
export type ParseRequestHandler = ParseRequestIdHandler;

export async function parseLink(
  input: string,
  onProgress?: ParseProgressHandler,
  onRequestId?: ParseRequestHandler,
): Promise<ParseResult> {
  const backend = (await apiParseLink(input.trim(), onProgress, onRequestId)) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}

/**
 * Parse pasted plain text (travel notes, Xiaohongshu content, etc.).
 */
export async function parseText(
  input: string,
  options?: { webSearch?: boolean },
  onProgress?: ParseProgressHandler,
  onRequestId?: ParseRequestHandler,
): Promise<ParseResult> {
  const backend = (await apiParseText(input.trim(), options?.webSearch ?? false, onProgress, onRequestId)) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}

/**
 * Parse anything the user pastes: URLs are scraped server-side; everything
 * else is treated as raw text and parsed directly.
 */
export async function parseInput(
  input: string,
  onProgress?: ParseProgressHandler,
  onRequestId?: ParseRequestHandler,
): Promise<ParseResult> {
  return looksLikeUrl(input) ? parseLink(input, onProgress, onRequestId) : parseText(input, undefined, onProgress, onRequestId);
}

export async function discoverFromAtlasQuery(
  input: string,
  onProgress?: ParseProgressHandler,
  onRequestId?: ParseRequestHandler,
): Promise<ParseResult> {
  const backend = (await apiDiscoverAtlasPlaces(input.trim(), onProgress, onRequestId)) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}

export async function scanAnyLink(
  input: string,
  onProgress?: ParseProgressHandler,
  onRequestId?: ParseRequestHandler,
): Promise<ParseResult> {
  // Any Links now uses the same Universal Web Agent as all generic URLs:
  // HTTP reader extraction, then Playwright for JavaScript-rendered pages.
  return parseLink(input, onProgress, onRequestId);
}

export async function parseYoutubeLink(
  input: string,
  onProgress?: ParseProgressHandler,
  onRequestId?: ParseRequestHandler,
): Promise<ParseResult> {
  const backend = (await apiParseYoutube(input.trim(), onProgress, onRequestId)) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}

export async function parseTikTokLink(
  input: string,
  onProgress?: ParseProgressHandler,
  onRequestId?: ParseRequestHandler,
): Promise<ParseResult> {
  const backend = (await apiParseTikTok(input.trim(), onProgress, onRequestId)) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}

export async function parseInstagramReelLink(
  input: string,
  onProgress?: ParseProgressHandler,
  onRequestId?: ParseRequestHandler,
): Promise<ParseResult> {
  const backend = (await apiParseInstagramReel(input.trim(), onProgress, onRequestId)) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}

export async function parseFacebookReelLink(
  input: string,
  onProgress?: ParseProgressHandler,
  onRequestId?: ParseRequestHandler,
): Promise<ParseResult> {
  const backend = (await apiParseFacebookReel(input.trim(), onProgress, onRequestId)) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}

/**
 * Identify a geographic place from a single image using Google Cloud Vision
 * landmark detection + optional DeepSeek vision fallback.
 */
export async function findImagePlace(
  imageBase64: string,
  onProgress?: ParseProgressHandler,
  onRequestId?: ParseRequestHandler,
): Promise<ParseResult> {
  const backend = (await apiFindImagePlace(imageBase64, onProgress, onRequestId)) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}

export async function scanImagesForTextPlaces(
  imagesBase64: string[],
  onProgress?: ParseProgressHandler,
  onRequestId?: ParseRequestHandler,
  imageUris?: string[],
): Promise<ParseResult> {
  const backend = (await apiScanImagesBase64(imagesBase64, onProgress, onRequestId)) as unknown as BackendParseResponse;
  const result = adaptResponse(backend);
  const fallbackUri = imageUris?.find(Boolean);
  if (fallbackUri) {
    result.places = result.places.map((place, index) => ({
      ...place,
      imageUri: imageUris?.[index] || fallbackUri,
    }));
  }
  return result;
}
