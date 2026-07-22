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

export type SavedAtlas = Atlas;

const DEFAULT_ATLAS_EMOJI = '🗺️';

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
  };

  await updateAtlasesCache(userId, (current) => [localRow, ...current]);

  try {
    const { data, error } = await withTimeout(
      supabase
        .from('atlas')
        .insert({ title: trimmed, emoji: DEFAULT_ATLAS_EMOJI })
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
