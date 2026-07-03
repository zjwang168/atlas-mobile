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

import { supabase } from '../supabase/supabaseClient';
import type { ParsedPlace } from '../import/importService';

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

  const rows = places.map((p) => ({
    name: p.name,
    subtitle: p.subtitle || null,
    category: p.type && p.type !== 'Place' ? p.type : null,
    latitude: p.latitude,
    longitude: p.longitude,
    region: source?.region ?? null,
    external_source: 'import',
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

  return (data ?? []) as SavedPlace[];
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
