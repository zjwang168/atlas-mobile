import type { Atlas } from '@/types/atlas';
import { ATLAS_SELECT_COLUMNS } from '../atlas/atlasShared';
import type { ParsedPlace } from '../import/importService';
import { buildPlaceStableKey } from '../import/importService';
import type { SavedPlace } from '../place/placeService';
import { supabase } from '../supabase/supabaseClient';
import { createLocalId, isLocalId, LOCAL_CACHE_KEYS } from './cacheKeys';
import { getCached, setCached, updateCached } from './localStore';

export type SavedPlacesIndexEntry = {
  id: string;
  updatedAt: string;
};

type SavePlacesWrite = {
  kind: 'savePlaces';
  id: string;
  attempts: number;
  createdAt: string;
  places: ParsedPlace[];
  localRows: SavedPlace[];
  source?: { url?: string; region?: string };
};

type DeletePlaceWrite = {
  kind: 'deletePlace';
  id: string;
  attempts: number;
  createdAt: string;
  placeId: string;
};

type UpdateNoteWrite = {
  kind: 'updateNote';
  id: string;
  attempts: number;
  createdAt: string;
  placeId: string;
  note: string;
};

type CreateAtlasWrite = {
  kind: 'createAtlas';
  id: string;
  attempts: number;
  createdAt: string;
  localId: string;
  title: string;
  emoji: string;
};

export type QueuedWrite = SavePlacesWrite | DeletePlaceWrite | UpdateNoteWrite | CreateAtlasWrite;
type NewQueuedWrite = Omit<SavePlacesWrite, 'id' | 'attempts' | 'createdAt'>
  | Omit<DeletePlaceWrite, 'id' | 'attempts' | 'createdAt'>
  | Omit<UpdateNoteWrite, 'id' | 'attempts' | 'createdAt'>
  | Omit<CreateAtlasWrite, 'id' | 'attempts' | 'createdAt'>;

export type DeadLetterWrite = QueuedWrite & {
  failedAt: string;
  reason: string;
};

const MAX_ATTEMPTS = 5;
const WRITE_TIMEOUT_MS = 30_000;
const inFlightFlushes = new Map<string, Promise<{ success: boolean; remaining: number }>>();

function truncate(value: string | null | undefined, maxLength: number): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function makeStableKey(place: { name: string; latitude: number; longitude: number; category?: string | null }): string {
  return buildPlaceStableKey({
    name: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    category: place.category ?? '',
  });
}

function withTimeout<T>(operation: PromiseLike<T>, message = 'Write timed out'): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), WRITE_TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve(operation), timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/timed out|network request failed|failed to fetch|abort|offline/i.test(message)) return true;
  if (/\b(400|401|403|404|409|422)\b/.test(message)) return false;
  return true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error');
}

async function readQueue(userId: string): Promise<QueuedWrite[]> {
  return (await getCached<QueuedWrite[]>(userId, LOCAL_CACHE_KEYS.writeQueue)) ?? [];
}

async function writeQueue(userId: string, queue: QueuedWrite[]): Promise<void> {
  await setCached(userId, LOCAL_CACHE_KEYS.writeQueue, queue);
}

async function moveToDeadLetters(userId: string, write: QueuedWrite, reason: string): Promise<void> {
  await updateCached<DeadLetterWrite[]>(userId, LOCAL_CACHE_KEYS.deadLetters, (current) => [
    {
      ...write,
      failedAt: new Date().toISOString(),
      reason,
    },
    ...(current ?? []),
  ].slice(0, 25));
}

export async function enqueueWrite(userId: string, write: NewQueuedWrite): Promise<QueuedWrite> {
  const queued = {
    ...write,
    id: createLocalId(),
    attempts: 0,
    createdAt: new Date().toISOString(),
  } as QueuedWrite;
  await updateCached<QueuedWrite[]>(userId, LOCAL_CACHE_KEYS.writeQueue, (current) => [...(current ?? []), queued]);
  return queued;
}

export async function getLocalSyncDebug(userId: string): Promise<{
  queue: QueuedWrite[];
  deadLetters: DeadLetterWrite[];
}> {
  const [queue, deadLetters] = await Promise.all([
    getCached<QueuedWrite[]>(userId, LOCAL_CACHE_KEYS.writeQueue),
    getCached<DeadLetterWrite[]>(userId, LOCAL_CACHE_KEYS.deadLetters),
  ]);
  return {
    queue: queue ?? [],
    deadLetters: deadLetters ?? [],
  };
}

async function insertPlacesOnline(write: SavePlacesWrite): Promise<SavedPlace[]> {
  const rows = write.places.map((p, index) => ({
    name: truncate(p.name, 255) ?? 'Unknown place',
    subtitle: truncate(p.subtitle, 255),
    category: truncate(p.type && p.type !== 'Place' ? p.type : null, 100),
    latitude: p.latitude,
    longitude: p.longitude,
    region: truncate(write.source?.region, 100),
    photo_url: write.localRows[index]?.photo_url ?? null,
  }));

  const { data, error } = await withTimeout(
    supabase.from('places').insert(rows).select('id, name, subtitle, category, latitude, longitude, region, photo_url, note, created_at'),
  );
  if (error) throw new Error(`Failed to save queued places: ${error.message}`);

  const saved = ((data ?? []) as SavedPlace[]).map((place) => ({
    ...place,
    stableKey: makeStableKey(place),
  }));

  if (write.source?.url && saved.length > 0) {
    const sourceRows = saved.map((row) => ({
      place_id: row.id,
      source_type: 'link',
      source_url: write.source?.url,
    }));
    const { error: srcError } = await supabase.from('place_sources').insert(sourceRows);
    if (srcError) console.warn('[syncQueue] place_sources insert failed:', srcError.message);
  }

  return saved;
}

async function insertAtlasOnline(write: CreateAtlasWrite): Promise<Atlas> {
  const { data, error } = await withTimeout(
    supabase
      .from('atlas')
      .insert({ title: write.title, emoji: write.emoji })
      .select(ATLAS_SELECT_COLUMNS)
      .single(),
  );
  if (error) throw new Error(`Failed to save queued atlas: ${error.message}`);
  return data as Atlas;
}

async function reconcileAtlas(userId: string, localId: string, remoteRow: Atlas): Promise<void> {
  await updateCached<Atlas[]>(userId, LOCAL_CACHE_KEYS.atlases, (current) => (
    (current ?? []).map((row) => (row.id === localId ? remoteRow : row))
  ));
}

async function deletePlaceOnline(placeId: string): Promise<void> {
  const { error } = await withTimeout(supabase.from('places').delete().eq('id', placeId));
  if (error) throw new Error(`Failed to delete queued place: ${error.message}`);
}

async function updateNoteOnline(placeId: string, note: string): Promise<void> {
  const { error } = await withTimeout(supabase.from('places').update({ note: note || null }).eq('id', placeId));
  if (error) throw new Error(`Failed to update queued place note: ${error.message}`);
}

async function reconcileSavedPlaces(userId: string, localRows: SavedPlace[], remoteRows: SavedPlace[]): Promise<void> {
  const localByIndex = new Map(localRows.map((row, index) => [index, row.id]));
  const now = new Date().toISOString();
  const savedPlaces = await updateCached<SavedPlace[]>(userId, LOCAL_CACHE_KEYS.savedPlaces, (current) => {
    const rows = current ?? [];
    return rows.map((row) => {
      const localIndex = localRows.findIndex((localRow) => localRow.id === row.id);
      if (localIndex < 0) return row;
      return remoteRows[localIndex] ?? row;
    });
  });
  await setCached<SavedPlacesIndexEntry[]>(
    userId,
    LOCAL_CACHE_KEYS.savedPlacesIndex,
    savedPlaces.map((row) => ({ id: row.id, updatedAt: row.created_at ?? now })),
  );

  const idMap = new Map<string, string>();
  remoteRows.forEach((row, index) => {
    const localId = localByIndex.get(index);
    if (localId) idMap.set(localId, row.id);
  });
  if (idMap.size === 0) return;

  const queue = await readQueue(userId);
  await writeQueue(userId, queue.map((write) => {
    if (write.kind === 'deletePlace' || write.kind === 'updateNote') {
      return { ...write, placeId: idMap.get(write.placeId) ?? write.placeId };
    }
    return write;
  }));
}

async function removeCancelledLocalSave(userId: string, deleteWrite: DeletePlaceWrite, queue: QueuedWrite[]): Promise<QueuedWrite[] | null> {
  if (!isLocalId(deleteWrite.placeId)) return null;
  const saveWrite = queue.find(
    (write): write is SavePlacesWrite =>
      write.kind === 'savePlaces' && write.localRows.some((row) => row.id === deleteWrite.placeId),
  );
  if (!saveWrite) return null;

  await setCached<SavedPlace[]>(
    userId,
    LOCAL_CACHE_KEYS.savedPlaces,
    ((await getCached<SavedPlace[]>(userId, LOCAL_CACHE_KEYS.savedPlaces)) ?? []).filter((row) => row.id !== deleteWrite.placeId),
  );
  return queue.filter((write) => write.id !== saveWrite.id && write.id !== deleteWrite.id);
}

async function replayWrite(userId: string, write: QueuedWrite): Promise<void> {
  if (write.kind === 'savePlaces') {
    const remoteRows = await insertPlacesOnline(write);
    await reconcileSavedPlaces(userId, write.localRows, remoteRows);
    return;
  }
  if (write.kind === 'updateNote') {
    await updateNoteOnline(write.placeId, write.note);
    return;
  }
  if (write.kind === 'createAtlas') {
    const remoteRow = await insertAtlasOnline(write);
    await reconcileAtlas(userId, write.localId, remoteRow);
    return;
  }
  await deletePlaceOnline(write.placeId);
}

export async function flushQueue(userId: string): Promise<{ success: boolean; remaining: number }> {
  const inFlight = inFlightFlushes.get(userId);
  if (inFlight) return inFlight;

  const flush = (async () => {
    let queue = await readQueue(userId);
    let success = true;

    for (const write of [...queue]) {
      const cancelled = write.kind === 'deletePlace'
        ? await removeCancelledLocalSave(userId, write, queue)
        : null;
      if (cancelled) {
        queue = cancelled;
        await writeQueue(userId, queue);
        continue;
      }

      try {
        await replayWrite(userId, write);
        queue = queue.filter((queued) => queued.id !== write.id);
        await writeQueue(userId, queue);
      } catch (error) {
        const attempts = write.attempts + 1;
        const reason = errorMessage(error);
        if (!isRetryableError(error) || attempts >= MAX_ATTEMPTS) {
          await moveToDeadLetters(userId, { ...write, attempts }, reason);
          queue = queue.filter((queued) => queued.id !== write.id);
          await writeQueue(userId, queue);
          continue;
        }
        queue = queue.map((queued) => queued.id === write.id ? { ...queued, attempts } as QueuedWrite : queued);
        await writeQueue(userId, queue);
        success = false;
        break;
      }
    }

    return { success, remaining: queue.length };
  })().finally(() => {
    inFlightFlushes.delete(userId);
  });

  inFlightFlushes.set(userId, flush);
  return flush;
}

export { withTimeout };
