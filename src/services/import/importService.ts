/**
 * Import / link-parsing service.
 *
 * This is the single seam between the UI and the parser backend. It calls the
 * real FastAPI backend via apiService and adapts responses to the UI contract
 * below. parseInput() auto-detects whether the pasted content is a URL
 * (scrape + parse via /parse_link) or plain text (parse directly via
 * /parse_text — covers Xiaohongshu, WeChat, copied notes).
 */

import { parseLink as apiParseLink, parseText as apiParseText } from '../api/apiService';

export type ParsedPlace = {
  id: string;
  name: string;
  subtitle: string;
  type: string;
  latitude: number;
  longitude: number;
  /** Optional thumbnail for the place row. */
  imageUri?: string;
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
    name: loc.name,
    subtitle: loc.description || loc.full_address || '',
    type: loc.category || 'Place',
    latitude: loc.latitude,
    longitude: loc.longitude,
  }));

  return {
    sourceTitle: backend.title || 'Imported content',
    centerCoordinate: medianCenter(backend.locations ?? []),
    region: backend.inferred_region ?? undefined,
    places,
  };
}

/**
 * Parse a pasted URL into places by calling the backend parser.
 */
export async function parseLink(input: string): Promise<ParseResult> {
  const backend = (await apiParseLink(input.trim())) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}

/**
 * Parse pasted plain text (travel notes, Xiaohongshu content, etc.).
 */
export async function parseText(input: string): Promise<ParseResult> {
  const backend = (await apiParseText(input.trim())) as unknown as BackendParseResponse;
  return adaptResponse(backend);
}

/**
 * Parse anything the user pastes: URLs are scraped server-side; everything
 * else is treated as raw text and parsed directly.
 */
export async function parseInput(input: string): Promise<ParseResult> {
  return looksLikeUrl(input) ? parseLink(input) : parseText(input);
}
