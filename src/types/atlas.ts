/** Row shape of the Supabase `atlas` table (renamed from `collections`). */
export type Atlas = {
  id: string;
  owner_id: string | null;
  title: string;
  emoji: string;
  description: string | null;
  visibility: string;
  created_at: string;
  updated_at: string;
  /** New map-first atlas format. Older collections are deliberately hidden. */
  format_version?: number;
  route_geojson?: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString> | null;
  route_visible?: boolean;
};
