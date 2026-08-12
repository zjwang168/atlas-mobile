/** Shared between `atlasService.ts` and `../local/syncQueue.ts` — kept in its
    own module so neither has to import the other (they already both import
    from `../local/syncQueue.ts` / feed into it, which would otherwise cycle). */

export const ATLAS_SELECT_COLUMNS = 'id, owner_id, title, emoji, description, visibility, created_at, updated_at, format_version, route_geojson, route_visible';

export const ATLAS_PLACES_SELECT_COLUMNS = 'id, atlas_id, place_id, added_by, note, sort_order, created_at, timeline_day, timeline_time, place_name, place_subtitle, latitude, longitude, photo_url, external_place_id, city, region, country';

const MAX_ATLAS_TITLE_LENGTH = 255;

export function truncateAtlasTitle(title: string): string {
  return title.length > MAX_ATLAS_TITLE_LENGTH ? title.slice(0, MAX_ATLAS_TITLE_LENGTH) : title;
}
