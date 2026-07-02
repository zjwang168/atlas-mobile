/**
 * Import / link-parsing service.
 *
 * This is the single seam between the UI and the link parser. It now calls the
 * real FastAPI backend (/parse_link) via apiService and adapts the response to
 * the UI contract below. The UI contract is unchanged from the mocked version.
 */

import { parseLink as apiParseLink } from '../api/apiService';

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
  /** Caption/title extracted from the source link, shown in the top pill. */
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

/** Fields of the backend /parse_link response that we consume. */
type BackendParseResponse = {
  title: string;
  locations: BackendLocation[];
  inferred_region?: string | null;
};

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

/**
 * Parse a pasted URL into places by calling the backend parser.
 *
 * @param input  Link the user pasted.
 * @returns      Extracted places in the UI contract.
 */
export async function parseLink(input: string): Promise<ParseResult> {
  const backend = (await apiParseLink(input.trim())) as unknown as BackendParseResponse;

  const places: ParsedPlace[] = (backend.locations ?? []).map((loc, index) => ({
    id: String(index + 1),
    name: loc.name,
    subtitle: loc.description || loc.full_address || '',
    type: loc.category || 'Place',
    latitude: loc.latitude,
    longitude: loc.longitude,
  }));

  return {
    sourceTitle: backend.title || 'Imported link',
    centerCoordinate: medianCenter(backend.locations ?? []),
    region: backend.inferred_region ?? undefined,
    places,
  };
}
