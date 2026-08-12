/**
 * Persistence for atlases, backed by the team Supabase `atlas` table and an
 * offline-first local cache (see `../local/`). Mirrors `place/placeService.ts`.
 */

import type { Atlas } from '@/types/atlas';
import { createLocalId, LOCAL_CACHE_KEYS } from '../local/cacheKeys';
import { getCached, getCurrentUserId, setCached, updateCached } from '../local/localStore';
import { enqueueWrite, flushQueue, isRetryableError, withTimeout } from '../local/syncQueue';
import { supabase } from '../supabase/supabaseClient';
import { ATLAS_SELECT_COLUMNS, truncateAtlasTitle } from './atlasShared';
import { removeAtlasPlacesForAtlas } from './atlasPlacesService';

export type SavedAtlas = Atlas;

const DEFAULT_ATLAS_EMOJI = '🗺️';
const ATLAS_FORMAT_VERSION = 2;

type AtlasListener = (atlases: Atlas[]) => void;

const atlasListeners = new Set<AtlasListener>();

export function subscribeAtlases(listener: AtlasListener): () => void {
  atlasListeners.add(listener);
  return () => atlasListeners.delete(listener);
}

function notifyAtlases(atlases: Atlas[]): void {
  atlasListeners.forEach((listener) => listener(atlases));
}

async function setAtlasesCache(userId: string, atlases: Atlas[]): Promise<void> {
  await setCached<Atlas[]>(userId, LOCAL_CACHE_KEYS.atlases, atlases);
  notifyAtlases(atlases);
}

async function updateAtlasesCache(userId: string, update: (atlases: Atlas[]) => Atlas[]): Promise<Atlas[]> {
  const next = await updateCached<Atlas[]>(userId, LOCAL_CACHE_KEYS.atlases, (current) => update(current ?? []));
  notifyAtlases(next);
  return next;
}

/** Fetch atlases, newest first, for the Atlas tab. */
export async function fetchAtlases(): Promise<Atlas[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const cached = await getCached<Atlas[]>(userId, LOCAL_CACHE_KEYS.atlases);
  const fetchFresh = async () => {
    await flushQueue(userId).catch((error) => console.warn('[atlasService] queue flush before fetch failed:', error));
    const { data, error } = await supabase
      .from('atlas')
      .select(ATLAS_SELECT_COLUMNS)
      .eq('format_version', ATLAS_FORMAT_VERSION)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Failed to fetch atlases: ${error.message}`);
    const fresh = (data ?? []) as Atlas[];
    await setAtlasesCache(userId, fresh);
    return fresh;
  };

  if (cached) {
    fetchFresh().catch((error) => console.warn('[atlasService] background refresh failed:', error));
    return cached;
  }

  return fetchFresh();
}

/**
 * Create a new atlas. Writes an optimistic local row immediately so the UI
 * reflects the new atlas before the network round-trip, then syncs to
 * Supabase — queued for retry via syncQueue when offline or the request
 * fails with a retryable error.
 */
export async function createAtlas(title: string): Promise<Atlas> {
  const trimmed = truncateAtlasTitle(title.trim());
  if (!trimmed) throw new Error('Atlas name cannot be empty');

  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Cannot create an atlas before auth is ready');

  const now = new Date().toISOString();
  const localRow: Atlas = {
    id: createLocalId(),
    owner_id: null,
    title: trimmed,
    emoji: DEFAULT_ATLAS_EMOJI,
    description: null,
    visibility: 'private',
    created_at: now,
    updated_at: now,
    format_version: ATLAS_FORMAT_VERSION,
    route_geojson: null,
    route_visible: false,
  };

  await updateAtlasesCache(userId, (current) => [localRow, ...current]);

  try {
    const { data, error } = await withTimeout(
      supabase
        .from('atlas')
        .insert({ title: trimmed, emoji: DEFAULT_ATLAS_EMOJI, format_version: ATLAS_FORMAT_VERSION, route_visible: false })
        .select(ATLAS_SELECT_COLUMNS)
        .single(),
      'Creating atlas timed out',
    );
    if (error) throw new Error(`Failed to create atlas: ${error.message}`);

    const savedRow = data as Atlas;
    await updateAtlasesCache(userId, (current) => current.map((row) => (row.id === localRow.id ? savedRow : row)));
    return savedRow;
  } catch (error) {
    if (!isRetryableError(error)) {
      await updateAtlasesCache(userId, (current) => current.filter((row) => row.id !== localRow.id));
      throw error;
    }
    await enqueueWrite(userId, {
      kind: 'createAtlas',
      localId: localRow.id,
      title: trimmed,
      emoji: DEFAULT_ATLAS_EMOJI,
    });
    return localRow;
  }
}

/** Persist the presentation state of an Atlas without touching its place rows. */
export async function updateAtlas(
  id: string,
  patch: Partial<Pick<Atlas, 'title' | 'route_geojson' | 'route_visible'>>,
): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Cannot update an atlas before auth is ready');

  const updatedAt = new Date().toISOString();
  await updateAtlasesCache(userId, (current) => current.map((atlas) => (
    atlas.id === id ? { ...atlas, ...patch, updated_at: updatedAt } : atlas
  )));

  if (id.startsWith('local-')) return;
  const { error } = await withTimeout(
    supabase.from('atlas').update({ ...patch, updated_at: updatedAt }).eq('id', id),
    'Updating atlas timed out',
  );
  if (error) throw new Error(`Failed to update atlas: ${error.message}`);
}

/**
 * Delete an atlas. Removes it from the local cache immediately (along with
 * its cached `atlas_places` rows), then syncs to Supabase — queued for retry
 * via syncQueue when offline or the request fails with a retryable error.
 * `atlas_places` rows are `ON DELETE CASCADE`, so no separate server call is
 * needed for those.
 */
export async function deleteAtlas(id: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Cannot delete an atlas before auth is ready');

  await updateAtlasesCache(userId, (current) => current.filter((row) => row.id !== id));
  await removeAtlasPlacesForAtlas(id);

  if (id.startsWith('local-')) {
    await enqueueWrite(userId, { kind: 'deleteAtlas', atlasId: id });
    return;
  }

  try {
    const { error } = await withTimeout(supabase.from('atlas').delete().eq('id', id), 'Deleting atlas timed out');
    if (error) throw new Error(`Failed to delete atlas: ${error.message}`);
  } catch (error) {
    if (!isRetryableError(error)) throw error;
    await enqueueWrite(userId, { kind: 'deleteAtlas', atlasId: id });
  }
}
