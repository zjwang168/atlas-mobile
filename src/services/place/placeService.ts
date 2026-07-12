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
import { supabase } from '../supabase/supabaseClient';

export type SavedPlace = {
  id: string;
  name: string;
  subtitle: string;
  category: string | null;
  latitude: number;
  longitude: number;
  region: string | null;
  created_at: string;
};

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

  // 改进的去重：名称互相包含 或 坐标极接近（~100m）
  const normalizeName = (s: string) =>
    s.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
  const COORD_THRESHOLD = 0.001;

  const isDuplicate = (
    place: { name: string; latitude: number; longitude: number },
    saved: { name: string; latitude: number; longitude: number },
  ): boolean => {
    const name = normalizeName(place.name);
    const savedName = normalizeName(saved.name);
    const nameMatch = name.includes(savedName) || savedName.includes(name);
    const coordMatch =
      Math.abs(saved.latitude - place.latitude) < COORD_THRESHOLD &&
      Math.abs(saved.longitude - place.longitude) < COORD_THRESHOLD;
    return nameMatch || coordMatch;
  };

  const { data: existing, error: existingError } = await supabase
    .from('places')
    .select('id, name, subtitle, category, latitude, longitude, region, created_at');
  if (existingError) throw new Error(`Failed to check existing places: ${existingError.message}`);

  const existingRows = (existing ?? []) as SavedPlace[];

  // 过滤出真正的新地点
  const seenInBatch = new Set<string>();
  const placesToInsert = places.filter((place) => {
    const dupInExisting = existingRows.some((saved) => isDuplicate(place, saved));
    const dupInBatch = places.some(
      (other, idx) => places.indexOf(other) !== idx && isDuplicate(place, other),
    );
    if (dupInExisting || dupInBatch) return false;
    return true;
  });

  if (placesToInsert.length === 0) {
    // 全部重复，返回匹配的已存记录
    return places.map((place) => existingRows.find((saved) => isDuplicate(place, saved)))
      .filter((place): place is SavedPlace => Boolean(place));
  }

  const rows = placesToInsert.map((p) => ({
    name: p.name,
    subtitle: p.subtitle || null,
    category: p.type && p.type !== 'Place' ? p.type : null,
    latitude: p.latitude,
    longitude: p.longitude,
    region: source?.region ?? null,
  }));

  const { data, error } = await supabase.from('places').insert(rows).select();
  if (error) throw new Error(`Failed to save places: ${error.message}`);

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
      .map((place) => existingRows.find((saved) => isDuplicate(place, saved)))
      .filter((place): place is SavedPlace => Boolean(place)),
    ...((data ?? []) as SavedPlace[]),
  ];
}

/** Fetch saved places, newest first, for the My Places screens. */
export async function fetchSavedPlaces(): Promise<SavedPlace[]> {
  const { data, error } = await supabase
    .from('places')
    .select('id, name, subtitle, category, latitude, longitude, region, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to fetch places: ${error.message}`);
  return (data ?? []) as SavedPlace[];
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
