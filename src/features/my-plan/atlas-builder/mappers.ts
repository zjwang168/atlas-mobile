import { decodeAtlasPlaceMetadata } from "@/services/atlas/atlasPlaceMetadata";
import type { AtlasPlaceSnapshot } from "@/services/atlas/atlasPlacesService";
import type { SavedPlace } from "@/services/place/placeService";
import type { AtlasPlace } from "@/types/place";
import type { DraftPlace } from "./types";

export function toDraft(place: SavedPlace, row?: AtlasPlace): DraftPlace {
  const metadata = decodeAtlasPlaceMetadata(row?.note);
  const hasSnapshotCoordinates = row?.latitude != null && row.longitude != null;
  return {
    id: place.id,
    name: row?.place_name ?? place.name,
    subtitle: row?.place_subtitle ?? place.subtitle,
    latitude: hasSnapshotCoordinates ? row.latitude! : place.latitude,
    longitude: hasSnapshotCoordinates ? row.longitude! : place.longitude,
    photo_url: row?.photo_url ?? place.photo_url,
    city: row?.city ?? place.city,
    region: row?.region ?? place.region,
    country: row?.country ?? place.country,
    category: place.category,
    source: "saved",
    note: metadata.note,
    timeline_day: row?.timeline_day,
    timeline_time: row?.timeline_time,
    transport: metadata.transport,
    joinId: row?.id,
  };
}

export function atlasPlaceSnapshot(place: DraftPlace): AtlasPlaceSnapshot {
  return {
    place_name: place.name,
    place_subtitle: place.subtitle,
    latitude: place.latitude,
    longitude: place.longitude,
    photo_url: place.photo_url ?? null,
    city: place.city ?? null,
    region: place.region ?? null,
    country: place.country ?? null,
  };
}

export function toDraftFromRow(
  row: AtlasPlace,
  saved?: SavedPlace,
): DraftPlace | null {
  if (saved) return toDraft(saved, row);
  if (row.latitude == null || row.longitude == null || !row.place_name)
    return null;
  const metadata = decodeAtlasPlaceMetadata(row.note);
  return {
    id: row.external_place_id ?? row.id,
    name: row.place_name,
    subtitle: row.place_subtitle ?? "",
    latitude: row.latitude,
    longitude: row.longitude,
    photo_url: row.photo_url ?? null,
    city: row.city ?? null,
    region: row.region ?? null,
    country: row.country ?? null,
    category: null,
    source: "search",
    note: metadata.note,
    timeline_day: row.timeline_day,
    timeline_time: row.timeline_time,
    transport: metadata.transport,
    joinId: row.id,
  };
}
