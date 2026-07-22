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

type AtlasPlacesListener = (rows: AtlasPlace[]) => void;

const atlasPlacesListeners = new Set<AtlasPlacesListener>();

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

/**
 * Add places to an atlas. Writes optimistic local rows immediately so the UI
 * reflects the new membership before the network round-trip, then syncs to
 * Supabase — queued for retry via syncQueue when offline or the request
 * fails with a retryable error. Places already in the atlas are skipped.
 */
export async function addPlacesToAtlas(atlasId: string, placeIds: string[]): Promise<AtlasPlace[]> {
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
  const localRows: AtlasPlace[] = toAdd.map((placeId) => ({
    id: createLocalId(),
    atlas_id: atlasId,
    place_id: placeId,
    added_by: null,
    note: null,
    sort_order: nextSortOrder++,
    created_at: now,
  }));

  await updateAtlasPlacesCache(userId, (current) => [...current, ...localRows]);

  try {
    const rows = localRows.map(({ atlas_id, place_id, sort_order }) => ({ atlas_id, place_id, sort_order }));
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
