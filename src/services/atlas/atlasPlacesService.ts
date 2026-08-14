/**
 * Persistence for atlas ↔ place membership, backed by the Supabase
 * `atlas_places` join table and the same offline-first local cache as
 * `atlasService.ts` / `place/placeService.ts`.
 *
 * The local cache holds every `atlas_places` row for the current user across
 * all atlases (mirrors how `savedPlaces` caches every place); callers filter
 * by `atlas_id` for a single atlas's list.
 */

import type { AtlasPlace } from '@/types/place';
import { ATLAS_PLACES_SELECT_COLUMNS } from './atlasShared';
import { createLocalId, LOCAL_CACHE_KEYS } from '../local/cacheKeys';
import { getCached, getCurrentUserId, setCached, updateCached } from '../local/localStore';
import { enqueueWrite, flushQueue, isRetryableError, withTimeout } from '../local/syncQueue';
import { supabase } from '../supabase/supabaseClient';
import { getPlacePhoto } from '../api/apiService';
import { staticMapThumbnail } from '../place/staticMapThumbnail';

type AtlasPlacesListener = (rows: AtlasPlace[]) => void;

const atlasPlacesListeners = new Set<AtlasPlacesListener>();
let atlasPhotoBackfillTail: Promise<void> = Promise.resolve();
const atlasPhotoBackfillRequests = new Map<string, Promise<string | null>>();

export function subscribeAtlasPlaces(listener: AtlasPlacesListener): () => void {
  atlasPlacesListeners.add(listener);
  return () => atlasPlacesListeners.delete(listener);
}

function notifyAtlasPlaces(rows: AtlasPlace[]): void {
  atlasPlacesListeners.forEach((listener) => listener(rows));
}

async function setAtlasPlacesCache(userId: string, rows: AtlasPlace[]): Promise<void> {
  await setCached<AtlasPlace[]>(userId, LOCAL_CACHE_KEYS.atlasPlaces, rows);
  notifyAtlasPlaces(rows);
}

async function updateAtlasPlacesCache(
  userId: string,
  update: (rows: AtlasPlace[]) => AtlasPlace[],
): Promise<AtlasPlace[]> {
  const next = await updateCached<AtlasPlace[]>(userId, LOCAL_CACHE_KEYS.atlasPlaces, (current) => update(current ?? []));
  notifyAtlasPlaces(next);
  return next;
}

/** Fetch every `atlas_places` row for the current user (cache-then-revalidate); filter by `atlas_id` for one atlas. */
export async function fetchAtlasPlaces(): Promise<AtlasPlace[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const cached = await getCached<AtlasPlace[]>(userId, LOCAL_CACHE_KEYS.atlasPlaces);
  const fetchFresh = async () => {
    await flushQueue(userId).catch((error) => console.warn('[atlasPlacesService] queue flush before fetch failed:', error));
    const { data, error } = await supabase
      .from('atlas_places')
      .select(ATLAS_PLACES_SELECT_COLUMNS)
      .order('sort_order', { ascending: true });
    if (error) throw new Error(`Failed to fetch atlas places: ${error.message}`);
    const fresh = (data ?? []) as AtlasPlace[];
    await setAtlasPlacesCache(userId, fresh);
    return fresh;
  };

  if (cached) {
    fetchFresh().catch((error) => console.warn('[atlasPlacesService] background refresh failed:', error));
    return cached;
  }

  return fetchFresh();
}

export type AtlasPlaceSnapshot = Pick<AtlasPlace, 'place_name' | 'place_subtitle' | 'latitude' | 'longitude' | 'photo_url' | 'city' | 'region' | 'country'>;

/**
 * Add places to an atlas. Its snapshot makes each Atlas own its orange pin's
 * coordinates, including when the membership write has to be queued offline.
 */
export async function addPlacesToAtlas(
  atlasId: string,
  placeIds: string[],
  snapshotsByPlaceId?: ReadonlyMap<string, AtlasPlaceSnapshot>,
): Promise<AtlasPlace[]> {
  if (placeIds.length === 0) return [];
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Cannot add places to an atlas before auth is ready');

  const existing = (await getCached<AtlasPlace[]>(userId, LOCAL_CACHE_KEYS.atlasPlaces)) ?? [];
  const existingForAtlas = existing.filter((row) => row.atlas_id === atlasId);
  const alreadyAdded = new Set(existingForAtlas.map((row) => row.place_id));
  const toAdd = placeIds.filter((placeId) => !alreadyAdded.has(placeId));
  if (toAdd.length === 0) return [];

  const now = new Date().toISOString();
  let nextSortOrder = existingForAtlas.length;
  const localRows: AtlasPlace[] = toAdd.map((placeId) => {
    const snapshot = snapshotsByPlaceId?.get(placeId);
    return {
      id: createLocalId(),
      atlas_id: atlasId,
      place_id: placeId,
      added_by: null,
      note: null,
      sort_order: nextSortOrder++,
      created_at: now,
      place_name: snapshot?.place_name ?? null,
      place_subtitle: snapshot?.place_subtitle ?? null,
      latitude: snapshot?.latitude ?? null,
      longitude: snapshot?.longitude ?? null,
      photo_url: snapshot?.photo_url ?? null,
      city: snapshot?.city ?? null,
      region: snapshot?.region ?? null,
      country: snapshot?.country ?? null,
    };
  });

  await updateAtlasPlacesCache(userId, (current) => [...current, ...localRows]);

  try {
    const rows = localRows.map(({ atlas_id, place_id, sort_order, place_name, place_subtitle, latitude, longitude, photo_url, city, region, country }) => ({
      atlas_id, place_id, sort_order, place_name, place_subtitle, latitude, longitude, photo_url, city, region, country,
    }));
    const { data, error } = await withTimeout(
      supabase.from('atlas_places').insert(rows).select(ATLAS_PLACES_SELECT_COLUMNS),
      'Adding places to atlas timed out',
    );
    if (error) throw new Error(`Failed to add places to atlas: ${error.message}`);

    const savedRows = (data ?? []) as AtlasPlace[];
    await updateAtlasPlacesCache(userId, (current) => current.map((row) => {
      const localIndex = localRows.findIndex((local) => local.id === row.id);
      return localIndex >= 0 ? (savedRows[localIndex] ?? row) : row;
    }));
    return savedRows;
  } catch (error) {
    if (!isRetryableError(error)) {
      await updateAtlasPlacesCache(userId, (current) => current.filter((row) => !localRows.some((local) => local.id === row.id)));
      throw error;
    }
    await enqueueWrite(userId, { kind: 'addAtlasPlaces', atlasId, localRows });
    return localRows;
  }
}

export type AtlasOwnedPlaceInput = {
  id: string;
  name: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  photo_url?: string | null;
  external_place_id?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  note?: string | null;
  timeline_day?: number | null;
  timeline_time?: string | null;
};

/** Adds a searched place to one Atlas without saving it to My Places. */
export async function addAtlasOwnedPlaces(atlasId: string, places: AtlasOwnedPlaceInput[]): Promise<AtlasPlace[]> {
  if (!places.length) return [];
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Cannot add places to an atlas before auth is ready');

  const existing = (await getCached<AtlasPlace[]>(userId, LOCAL_CACHE_KEYS.atlasPlaces)) ?? [];
  const existingForAtlas = existing.filter((row) => row.atlas_id === atlasId);
  const existingKeys = new Set(existingForAtlas.map((row) => row.external_place_id ?? row.place_id).filter(Boolean));
  const toAdd = places.filter((place) => !existingKeys.has(place.external_place_id ?? place.id));
  if (!toAdd.length) return [];

  const now = new Date().toISOString();
  let sortOrder = existingForAtlas.length;
  const localRows: AtlasPlace[] = toAdd.map((place) => ({
    id: createLocalId(), atlas_id: atlasId, place_id: null, added_by: null, note: place.note ?? null,
    sort_order: sortOrder++, created_at: now, place_name: place.name, place_subtitle: place.subtitle,
    latitude: place.latitude, longitude: place.longitude, photo_url: place.photo_url ?? null,
    external_place_id: place.external_place_id ?? place.id, city: place.city ?? null,
    region: place.region ?? null, country: place.country ?? null,
    timeline_day: place.timeline_day ?? null, timeline_time: place.timeline_time ?? null,
  }));
  await updateAtlasPlacesCache(userId, (current) => [...current, ...localRows]);

  try {
    const rows = localRows.map(({ id, added_by, created_at, ...row }) => row);
    const { data, error } = await withTimeout(
      supabase.from('atlas_places').insert(rows).select(ATLAS_PLACES_SELECT_COLUMNS),
      'Adding places to atlas timed out',
    );
    if (error) throw new Error(`Failed to add searched places to atlas: ${error.message}`);
    const savedRows = (data ?? []) as AtlasPlace[];
    await updateAtlasPlacesCache(userId, (current) => current.map((row) => {
      const localIndex = localRows.findIndex((local) => local.id === row.id);
      return localIndex >= 0 ? (savedRows[localIndex] ?? row) : row;
    }));
    return savedRows;
  } catch (error) {
    if (!isRetryableError(error)) {
      await updateAtlasPlacesCache(userId, (current) => current.filter((row) => !localRows.some((local) => local.id === row.id)));
      throw error;
    }
    await enqueueWrite(userId, { kind: 'addAtlasPlaces', atlasId, localRows });
    return localRows;
  }
}

async function backfillAtlasPlacePhoto(place: AtlasPlace): Promise<string | null> {
  if (place.photo_url) return place.photo_url;
  if (!place.place_name || place.latitude == null || place.longitude == null) return null;

  const response = await getPlacePhoto(place.place_name);
  const photoUrl = response.photo_url || staticMapThumbnail(place.latitude, place.longitude);
  if (!photoUrl) return null;

  const userId = await getCurrentUserId();
  if (!userId) return null;
  await updateAtlasPlacesCache(userId, (current) => current.map((row) => (
    row.id === place.id ? { ...row, photo_url: photoUrl } : row
  )));

  if (place.id.startsWith('local-')) return photoUrl;
  const { error } = await withTimeout(
    supabase.from('atlas_places').update({ photo_url: photoUrl }).eq('id', place.id),
    'Saving Atlas place photo timed out',
  );
  if (error) throw new Error(`Failed to save Atlas place photo: ${error.message}`);
  return photoUrl;
}

/** Enrich an Atlas place after it is saved, one lookup at a time. */
export function queueAtlasPlacePhotoBackfill(place: AtlasPlace): Promise<string | null> {
  const existing = atlasPhotoBackfillRequests.get(place.id);
  if (existing) return existing;
  const task = atlasPhotoBackfillTail
    .catch(() => undefined)
    .then(() => backfillAtlasPlacePhoto(place));
  // Keep enrichment sequential to avoid competing with map gestures and
  // search traffic, while still returning this place's outcome to the caller.
  atlasPhotoBackfillTail = task.then(() => undefined, () => undefined);
  const request = task.catch((error) => {
    console.warn('[atlasPlacesService] photo backfill failed:', error);
    return null;
  });
  atlasPhotoBackfillRequests.set(place.id, request);
  void request.finally(() => atlasPhotoBackfillRequests.delete(place.id));
  return request;
}

export type AtlasPlacePatch = Pick<AtlasPlace, 'note' | 'sort_order' | 'timeline_day' | 'timeline_time'> & AtlasPlaceSnapshot;

/**
 * Apply an Atlas edit in one cache transaction and one PostgREST request.
 * Saving used to call updateAtlasPlace once per stop, repeatedly parsing and
 * rewriting the full atlas_places cache and re-rendering every subscriber.
 */
export async function updateAtlasPlaces(
  updates: Array<{ joinRowId: string; patch: Partial<AtlasPlacePatch> }>,
): Promise<void> {
  if (!updates.length) return;
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Cannot update Atlas items before auth is ready');

  const patchesById = new Map(updates.map(({ joinRowId, patch }) => [joinRowId, patch]));
  const nextRows = await updateAtlasPlacesCache(userId, (current) => current.map((row) => {
    const patch = patchesById.get(row.id);
    return patch ? { ...row, ...patch } : row;
  }));
  const remoteRows = nextRows.filter((row) => patchesById.has(row.id) && !row.id.startsWith('local-'));
  if (!remoteRows.length) return;

  const payload = remoteRows.map((row) => ({
    id: row.id,
    atlas_id: row.atlas_id,
    place_id: row.place_id,
    note: row.note,
    sort_order: row.sort_order,
    timeline_day: row.timeline_day ?? null,
    timeline_time: row.timeline_time ?? null,
    place_name: row.place_name ?? null,
    place_subtitle: row.place_subtitle ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    photo_url: row.photo_url ?? null,
    external_place_id: row.external_place_id ?? null,
    city: row.city ?? null,
    region: row.region ?? null,
    country: row.country ?? null,
  }));
  const { error } = await withTimeout(
    supabase.from('atlas_places').upsert(payload, { onConflict: 'id' }),
    'Updating Atlas items timed out',
  );
  if (error) throw new Error(`Failed to update Atlas items: ${error.message}`);
}

/** Update one Atlas item. This backs notes and time dividers. */
export async function updateAtlasPlace(joinRowId: string, patch: Partial<AtlasPlacePatch>): Promise<void> {
  await updateAtlasPlaces([{ joinRowId, patch }]);
}

/** Apply a whole ordering in one cache write and one remote request. */
export async function reorderAtlasPlaces(rows: Array<{ id: string; sort_order: number }>): Promise<void> {
  await updateAtlasPlaces(rows.map(({ id, sort_order }) => ({ joinRowId: id, patch: { sort_order } })));
}

/**
 * Remove a place from an atlas — deletes the `atlas_places` join row only,
 * the underlying place is untouched. Local cache first, queued for retry via
 * syncQueue when offline or the request fails with a retryable error.
 *
 * @param joinRowId  The `atlas_places` row id (from `AtlasPlace.id`, not the place id).
 */
export async function removePlaceFromAtlas(joinRowId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Cannot remove a place from an atlas before auth is ready');

  await updateAtlasPlacesCache(userId, (current) => current.filter((row) => row.id !== joinRowId));

  if (joinRowId.startsWith('local-')) {
    // Not yet synced — queue the removal so flushQueue's cancellation pass
    // can drop it from the pending 'addAtlasPlaces' write instead of
    // replaying it against Supabase (see removeCancelledLocalAtlasPlace).
    await enqueueWrite(userId, { kind: 'removeAtlasPlace', joinRowId });
    return;
  }

  try {
    const { error } = await withTimeout(
      supabase.from('atlas_places').delete().eq('id', joinRowId),
      'Removing place from atlas timed out',
    );
    if (error) throw new Error(`Failed to remove place from atlas: ${error.message}`);
  } catch (error) {
    if (!isRetryableError(error)) throw error;
    await enqueueWrite(userId, { kind: 'removeAtlasPlace', joinRowId });
  }
}

/**
 * Drops every `atlas_places` row for an atlas from the local cache — called
 * when the atlas itself is deleted (`atlasService.deleteAtlas`). No separate
 * Supabase write is needed: `atlas_places.atlas_id` is `ON DELETE CASCADE`,
 * so deleting the `atlas` row removes its join rows server-side too.
 */
export async function removeAtlasPlacesForAtlas(atlasId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;
  await updateAtlasPlacesCache(userId, (current) => current.filter((row) => row.atlas_id !== atlasId));
}
