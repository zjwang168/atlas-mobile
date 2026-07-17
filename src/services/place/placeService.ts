/**
 * Persistence for places, backed by the team Supabase `places` table.
 *
 * savePlaces(): called by the import flow's Save button with the places the
 * user selected. Also records where they came from in `place_sources`.
 * fetchSavedPlaces(): read model for the My Places screens.
 *
 * NOTE ON AUTH: there is no login yet, so `created_by` is left NULL and RLS is
 * currently disabled on the table. When auth lands, set created_by from the
 * session and tighten RLS to `created_by = auth.uid()`.
 */

import type { ParsedPlace } from '../import/importService';
import { buildPlaceStableKey } from '../import/importService';
import { supabase } from '../supabase/supabaseClient';
import { fetchPhotosForPlaces } from './placePhotoService';

export type SavedPlace = {
  id: string;
  stableKey?: string;
  name: string;
  subtitle: string;
  category: string | null;
  latitude: number;
  longitude: number;
  region: string | null;
  photo_url?: string | null;
  created_at: string;
};

function makeStableKey(place: { name: string; latitude: number; longitude: number; category?: string | null }): string {
  return buildPlaceStableKey({
    name: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    category: place.category ?? '',
  });
}

function truncate(value: string | null | undefined, maxLength: number): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

/** Normalize a place name for fuzzy comparison. */
const normalizePlaceName = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');

/** Coordinate proximity treated as "the same spot" (~100m). */
const COORD_THRESHOLD = 0.001;

/**
 * Whether two parsed/saved places refer to the same real-world place:
 * normalized names contain each other OR coordinates are within ~100m.
 *
 * Single source of truth for place identity — used by the save dedup in
 * savePlaces() and by the "Saved" badges in SaveScreen / HistoryPlacesPanel.
 * (Exact stableKey matching is too brittle for this: a name variant or a
 * geocode differing by >1e-5 degrees breaks it.)
 */
export function isSamePlace(
  a: { name: string; latitude: number; longitude: number },
  b: { name: string; latitude: number; longitude: number },
): boolean {
  const nameA = normalizePlaceName(a.name);
  const nameB = normalizePlaceName(b.name);
  const nameMatch = nameA.includes(nameB) || nameB.includes(nameA);
  const coordMatch =
    Math.abs(a.latitude - b.latitude) < COORD_THRESHOLD &&
    Math.abs(a.longitude - b.longitude) < COORD_THRESHOLD;
  return nameMatch || coordMatch;
}

/**
 * Persist the selected places from an import.
 *
 * @param places  The parsed places the user selected.
 * @param source  Where they came from (link + region), stored per place.
 * @returns       The inserted rows (with real DB ids).
 */
export async function savePlaces(
  places: ParsedPlace[],
  source?: { url?: string; region?: string },
): Promise<SavedPlace[]> {
  if (places.length === 0) return [];

  const { data: existing, error: existingError } = await supabase
    .from('places')
    .select('id, name, subtitle, category, latitude, longitude, region, photo_url, created_at');
  if (existingError) throw new Error(`Failed to check existing places: ${existingError.message}`);

  const existingRows = (existing ?? []) as SavedPlace[];

  // 过滤出真正的新地点（对库内已存 + 本批次内部都去重）
  const placesToInsert = places.filter((place) => {
    const dupInExisting = existingRows.some((saved) => isSamePlace(place, saved));
    const dupInBatch = places.some(
      (other, idx) => places.indexOf(other) !== idx && isSamePlace(place, other),
    );
    if (dupInExisting || dupInBatch) return false;
    return true;
  });

  if (placesToInsert.length === 0) {
    // 全部重复，返回匹配的已存记录
    return places.map((place) => existingRows.find((saved) => isSamePlace(place, saved)))
      .filter((place): place is SavedPlace => Boolean(place));
  }

  // Best-effort photo lookup (free Wikipedia layer). Bounded: ~2.5s per
  // request, 4 in flight; misses are simply null and the UI falls back to
  // the static map thumbnail. Fetched once here, cached forever in the row.
  const photos = await fetchPhotosForPlaces(placesToInsert);

  const rows = placesToInsert.map((p, i) => ({
    name: truncate(p.name, 255) ?? 'Unknown place',
    subtitle: truncate(p.subtitle, 255),
    category: truncate(p.type && p.type !== 'Place' ? p.type : null, 100),
    latitude: p.latitude,
    longitude: p.longitude,
    region: truncate(source?.region, 100),
    photo_url: photos[i],
  }));

  let data = null as SavedPlace[] | null;
  let error: { message?: string } | null = null;

  const bulk = await supabase.from('places').insert(rows).select();
  data = (bulk.data ?? null) as SavedPlace[] | null;
  error = bulk.error;

  if (error) {
    console.warn('[placeService] bulk insert failed, falling back to row-by-row:', {
      message: error.message,
      rows,
    });

    const insertedRows: SavedPlace[] = [];
    for (const row of rows) {
      const single = await supabase.from('places').insert(row).select();
      if (single.error) {
        console.warn('[placeService] row insert failed, skipping row:', {
          message: single.error.message,
          row,
        });
        continue;
      }
      if (single.data?.[0]) {
        insertedRows.push(single.data[0] as SavedPlace);
      }
    }

    if (insertedRows.length === 0) {
      throw new Error(`Failed to save places: ${error.message}`);
    }
    data = insertedRows;
  }

  // Record provenance (best-effort; a failure here shouldn't lose the places).
  if (source?.url && data) {
    const sourceRows = data.map((row: { id: string }) => ({
      place_id: row.id,
      source_type: 'link',
      source_url: source.url,
    }));
    const { error: srcError } = await supabase.from('place_sources').insert(sourceRows);
    if (srcError) console.warn('[placeService] place_sources insert failed:', srcError.message);
  }

  return [
    ...places
      .map((place) => existingRows.find((saved) => isSamePlace(place, saved)))
      .filter((place): place is SavedPlace => Boolean(place)),
    ...((data ?? []) as SavedPlace[]),
  ];
}

/** Fetch saved places, newest first, for the My Places screens. */
export async function fetchSavedPlaces(): Promise<SavedPlace[]> {
  const { data, error } = await supabase
    .from('places')
    .select('id, name, subtitle, category, latitude, longitude, region, photo_url, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to fetch places: ${error.message}`);
  return ((data ?? []) as SavedPlace[]).map((place) => ({
    ...place,
    stableKey: makeStableKey(place),
  }));
}

/**
 * Delete a place by ID from the places table.
 *
 * @param id  The ID of the place to delete.
 */
export async function deletePlace(id: string): Promise<void> {
  const { error } = await supabase.from('places').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete place: ${error.message}`);
}
