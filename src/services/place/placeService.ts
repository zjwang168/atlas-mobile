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

import type { PlaceDetail } from '@/types/place';
import type { ParsedPlace } from '../import/importService';
import { buildPlaceStableKey } from './placeIdentity';
import { createLocalId, LOCAL_CACHE_KEYS } from '../local/cacheKeys';
import { getCached, getCurrentUserId, setCached, updateCached } from '../local/localStore';
import { enqueueWrite, flushQueue, isRetryableError, type SavedPlacesIndexEntry, withTimeout } from '../local/syncQueue';
import { getPlacePhoto } from '../api/apiService';
import { supabase } from '../supabase/supabaseClient';
import { staticMapThumbnail } from './staticMapThumbnail';

export type SavedPlace = {
  id: string;
  stableKey?: string;
  name: string;
  subtitle: string;
  category: string | null;
  latitude: number;
  longitude: number;
  region: string | null;
  external_place_id?: string | null;
  external_source?: string | null;
  city?: string | null;
  country?: string | null;
  photo_url?: string | null;
  note?: string | null;
  special_role?: 'home' | 'office' | 'school' | null;
  created_at: string;
};

export type SpecialPlaceRole = NonNullable<SavedPlace['special_role']>;

/**
 * The columns every read of `places` selects. Kept as one constant because the
 * provider ids below are only useful to isSamePlace() if *every* path that
 * produces a SavedPlace carries them — a select that omits them yields rows
 * that silently fall back to fuzzy matching.
 */
const PLACE_COLUMNS =
  'id, name, subtitle, category, latitude, longitude, region, external_place_id, external_source, city, country, photo_url, special_role, created_at';

type SavedPlacesListener = (places: SavedPlace[]) => void;

const savedPlacesListeners = new Set<SavedPlacesListener>();
let photoBackfillTail: Promise<void> = Promise.resolve();

export function subscribeSavedPlaces(listener: SavedPlacesListener): () => void {
  savedPlacesListeners.add(listener);
  return () => savedPlacesListeners.delete(listener);
}

function notifySavedPlaces(places: SavedPlace[]): void {
  savedPlacesListeners.forEach((listener) => listener(places));
}

function makeStableKey(place: { name: string; latitude: number; longitude: number; category?: string | null }): string {
  return buildPlaceStableKey({
    name: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    category: place.category ?? '',
  });
}

function truncate(value: string | null | undefined, maxLength: number): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function withStableKey(place: SavedPlace): SavedPlace {
  return {
    ...place,
    stableKey: makeStableKey(place),
  };
}

async function recordPinHistory(eventType: 'saved' | 'deleted', places: SavedPlace[]): Promise<void> {
  if (!places.length) return;
  const rows = places.map((place) => ({
    place_id: place.id,
    stable_key: place.stableKey ?? makeStableKey(place),
    name: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    event_type: eventType,
  }));
  const { error } = await supabase.from('place_pin_history').insert(rows);
  if (error) throw new Error(`Saving pin history failed: ${error.message}`);
}

async function setSavedPlacesCache(userId: string, places: SavedPlace[]): Promise<void> {
  const normalized = places.map(withStableKey);
  await setCached<SavedPlace[]>(userId, LOCAL_CACHE_KEYS.savedPlaces, normalized);
  await setCached<SavedPlacesIndexEntry[]>(
    userId,
    LOCAL_CACHE_KEYS.savedPlacesIndex,
    normalized.map((place) => ({ id: place.id, updatedAt: place.created_at })),
  );
  notifySavedPlaces(normalized);
}

async function updateSavedPlacesCache(
  userId: string,
  update: (places: SavedPlace[]) => SavedPlace[],
): Promise<SavedPlace[]> {
  const normalized = await updateCached<SavedPlace[]>(userId, LOCAL_CACHE_KEYS.savedPlaces, (current) => (
    update(current ?? []).map(withStableKey)
  ));
  await setCached<SavedPlacesIndexEntry[]>(
    userId,
    LOCAL_CACHE_KEYS.savedPlacesIndex,
    normalized.map((place) => ({ id: place.id, updatedAt: place.created_at })),
  );
  notifySavedPlaces(normalized);
  return normalized;
}

/** Normalize a place name for fuzzy comparison. */
const normalizePlaceName = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');

/** Coordinate proximity treated as "the same spot" (~100m). */
const COORD_THRESHOLD = 0.001;

/**
 * The provider's own id for a place, in either shape it arrives in: camelCase
 * on a `ParsedPlace`, snake_case on a `SavedPlace` read back from Supabase.
 */
export type ProviderIdentity = {
  externalId?: string | null;
  externalSource?: string | null;
  external_place_id?: string | null;
  external_source?: string | null;
};

/**
 * Either shape a place identity arrives in: a `ParsedPlace` fresh from search
 * or import (camelCase), or a `SavedPlace` read back from Supabase.
 */
type PlaceIdentity = ProviderIdentity & {
  name: string;
  latitude: number;
  longitude: number;
};

const providerId = (p: ProviderIdentity) => (p.externalId ?? p.external_place_id) || null;
const providerSource = (p: ProviderIdentity) => (p.externalSource ?? p.external_source) || null;

/**
 * The provider-id half of place identity. `null` means the ids cannot decide —
 * one side carries none, or the two come from providers that share no id space
 * — and the caller should fall back to something else.
 */
function compareProviderIds(a: ProviderIdentity, b: ProviderIdentity): boolean | null {
  const idA = providerId(a);
  const idB = providerId(b);
  if (!idA || !idB) return null;
  const sourceA = providerSource(a);
  const sourceB = providerSource(b);
  // Ids are only comparable within one provider. If the two sides came from
  // different ones, decline rather than declare them different places.
  if (sourceA && sourceB && sourceA !== sourceB) return null;
  return idA === idB;
}

/**
 * Same place, decided on the provider id alone.
 *
 * This is the half of `isSamePlace()` that needs no coordinates, which is what
 * makes it the only identity check a search suggestion can go through —
 * suggestions carry no coordinates until they are resolved.
 *
 * The trade is coverage, not correctness: a saved place with no provider id
 * never matches here, and imports don't set one (only place search does). So a
 * false result means "not known to be the same", not "different" — treat it as
 * a hint, and let `savePlaces()`'s full dedup be the authority.
 */
export function isSameProviderPlace(a: ProviderIdentity, b: ProviderIdentity): boolean {
  return compareProviderIds(a, b) === true;
}

/**
 * Whether two parsed/saved places refer to the same real-world place.
 *
 * A provider id decides it outright when both sides carry one from the same
 * provider: equal ids are the same place, and different ids are places the
 * provider itself distinguishes, so they must not be collapsed. Only when at
 * least one side has no usable id does this fall back to fuzzy matching, which
 * requires the names to contain each other AND the coordinates to be within
 * ~100m.
 *
 * Fuzzy matching needs both halves because either alone is far too broad:
 * "Georgetown" is a substring of "Georgetown University", and ~100m swallows
 * every neighbouring shop. Requiring both trades a rare duplicate row for never
 * silently discarding a place the user explicitly asked to save. (Exact
 * stableKey matching is too brittle to use instead: a name variant or a geocode
 * differing by >1e-5 degrees breaks it.)
 *
 * Single source of truth for place identity — used by the save dedup in
 * savePlaces() and by the "Saved" badges in SaveScreen / HistoryPlacesPanel.
 */
export function isSamePlace(a: PlaceIdentity, b: PlaceIdentity): boolean {
  const byProviderId = compareProviderIds(a, b);
  if (byProviderId !== null) return byProviderId;

  const nameA = normalizePlaceName(a.name);
  const nameB = normalizePlaceName(b.name);
  const nameMatch = nameA.includes(nameB) || nameB.includes(nameA);
  const coordMatch =
    Math.abs(a.latitude - b.latitude) < COORD_THRESHOLD &&
    Math.abs(a.longitude - b.longitude) < COORD_THRESHOLD;
  return nameMatch && coordMatch;
}

export type SavePlacesResult = {
  /** Rows this call created — optimistic local rows when the write was queued offline. */
  inserted: SavedPlace[];
  /** Input places that already existed, mapped to the row they matched. */
  duplicates: SavedPlace[];
};

async function backfillSavedPlacePhoto(place: SavedPlace): Promise<void> {
  if (place.photo_url) return;

  const response = await getPlacePhoto(place.name);
  const photoUrl = response.photo_url || staticMapThumbnail(place.latitude, place.longitude);
  if (!photoUrl) return;

  const userId = await getCurrentUserId();
  if (!userId) return;
  await updateSavedPlacesCache(userId, (current) => current.map((row) => (
    row.id === place.id ? { ...row, photo_url: photoUrl } : row
  )));

  if (place.id.startsWith('local-')) return;
  const { error } = await withTimeout(
    supabase.from('places').update({ photo_url: photoUrl }).eq('id', place.id),
    'Saving place photo timed out',
  );
  if (error) throw new Error(`Failed to save place photo: ${error.message}`);
}

/** Queue photo enrichment after a place save, one request at a time. */
export function queueSavedPlacePhotoBackfill(place: SavedPlace): void {
  photoBackfillTail = photoBackfillTail
    .catch(() => undefined)
    .then(() => backfillSavedPlacePhoto(place))
    .catch((error) => console.warn('[placeService] photo backfill failed:', error));
}

/**
 * Persist the selected places from an import or a search.
 *
 * Splitting inserted from duplicates is what lets a caller tell "saved" from
 * "you already had this" — collapsing them into one list is how a dedup false
 * positive reads as a successful save.
 *
 * @param places  The parsed places the user selected.
 * @param source  Where they came from (link + region), stored per place.
 */
export async function savePlaces(
  places: ParsedPlace[],
  source?: { url?: string; region?: string },
): Promise<SavePlacesResult> {
  if (places.length === 0) return { inserted: [], duplicates: [] };
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Cannot save places before auth is ready');

  // Saving must not wait for unrelated queued writes or a full-table remote
  // read. The local cache is already the My Places read model and gives us
  // immediate dedupe + optimistic rendering; normal refresh reconciles it.
  void flushQueue(userId).catch((error) => console.warn('[placeService] background queue flush failed:', error));
  const existingRows = (await getCached<SavedPlace[]>(userId, LOCAL_CACHE_KEYS.savedPlaces)) ?? [];

  /** The existing row each input place matched, for the callers' duplicates list. */
  const matchedExisting = () => places
    .map((place) => existingRows.find((saved) => isSamePlace(place, saved)))
    .filter((place): place is SavedPlace => Boolean(place));

  // 过滤出真正的新地点（对库内已存 + 本批次内部都去重）
  const placesToInsert = places.filter((place, index) => {
    const dupInExisting = existingRows.some((saved) => isSamePlace(place, saved));
    const dupInBatch = places.some(
      (other, idx) => index !== idx && idx < index && isSamePlace(place, other),
    );
    if (dupInExisting || dupInBatch) return false;
    return true;
  });

  if (placesToInsert.length === 0) {
    // 全部重复，返回匹配的已存记录。这条路径不写库也不报错，所以 dev 下留一条
    // 日志——否则一次误判的去重和一次成功的保存在外部看起来完全一样。
    if (__DEV__) {
      console.info(
        '[placeService] nothing inserted — every place matched an existing row:',
        places.map((place) => {
          const match = existingRows.find((saved) => isSamePlace(place, saved));
          return {
            input: place.name,
            inputExternalId: place.externalId ?? null,
            matched: match?.name ?? null,
            matchedId: match?.id ?? null,
          };
        }),
      );
    }
    return { inserted: [], duplicates: matchedExisting() };
  }

  const rows = placesToInsert.map((p) => ({
    name: truncate(p.name, 255) ?? 'Unknown place',
    subtitle: truncate(p.subtitle, 255),
    category: truncate(p.type && p.type !== 'Place' ? p.type : null, 100),
    latitude: p.latitude,
    longitude: p.longitude,
    // Batch-level: the region this whole import was inferred to be in, not
    // each place's own. Place search passes no source, so its rows get null.
    region: truncate(source?.region, 100),
    // `imageUri` is the backend-provided place thumbnail from parse responses.
    // Keep saves deterministic: persist it as-is instead of starting a client
    // side third-party lookup after the row is visible.
    photo_url: truncate(p.imageUri, 1000),
    // Per-place. Only place search supplies these; parse results leave them null.
    external_place_id: truncate(p.externalId, 255),
    external_source: truncate(p.externalSource, 100),
    city: truncate(p.city, 100),
    country: truncate(p.country, 100),
  }));

  // Temporary id for optimistic UI — never sent to Supabase (which assigns the
  // real id via uuid_generate_v4()). Overwritten below once the insert returns,
  // and by reconcileSavedPlaces() in syncQueue.ts if this save is queued offline.
  const localRows: SavedPlace[] = rows.map((row) => withStableKey({
    id: createLocalId(),
    name: row.name,
    subtitle: row.subtitle ?? '',
    category: row.category,
    latitude: row.latitude,
    longitude: row.longitude,
    region: row.region,
    // Carried onto the optimistic row too: it goes straight into the cache the
    // next dedup reads from, and a row without them falls back to fuzzy matching.
    external_place_id: row.external_place_id,
    external_source: row.external_source,
    city: row.city,
    country: row.country,
    photo_url: row.photo_url,
    created_at: new Date().toISOString(),
  }));

  await updateSavedPlacesCache(userId, (current) => [...localRows, ...current]);

  let data = null as SavedPlace[] | null;
  let error: { message?: string } | null = null;

  try {
    const bulk = await withTimeout(
      supabase.from('places').insert(rows).select(PLACE_COLUMNS),
      'Saving places timed out',
    );
    data = (bulk.data ?? null) as SavedPlace[] | null;
    error = bulk.error;
  } catch (writeError) {
    if (!isRetryableError(writeError)) {
      await updateSavedPlacesCache(userId, (current) => current.filter((row) => !localRows.some((local) => local.id === row.id)));
      throw writeError;
    }
    await enqueueWrite(userId, { kind: 'savePlaces', places: placesToInsert, localRows, source });
    return { inserted: localRows, duplicates: matchedExisting() };
  }

  if (error) {
    console.warn('[placeService] bulk insert failed, falling back to row-by-row:', {
      message: error.message,
      rows,
    });

    const insertedRows: SavedPlace[] = [];
    for (const row of rows) {
      const single = await withTimeout(
        supabase.from('places').insert(row).select(PLACE_COLUMNS),
        'Saving place timed out',
      ).catch((singleError) => {
        if (!isRetryableError(singleError)) throw singleError;
        return { data: null, error: { message: singleError instanceof Error ? singleError.message : String(singleError) } };
      });
      if (single.error) {
        console.warn('[placeService] row insert failed, skipping row:', {
          message: single.error.message,
          row,
        });
        continue;
      }
      if (single.data?.[0]) {
        insertedRows.push(single.data[0] as SavedPlace);
      }
    }

    if (insertedRows.length === 0) {
      if (isRetryableError(new Error(error.message))) {
        await enqueueWrite(userId, { kind: 'savePlaces', places: placesToInsert, localRows, source });
        return { inserted: localRows, duplicates: matchedExisting() };
      }
      await updateSavedPlacesCache(userId, (current) => current.filter((row) => !localRows.some((local) => local.id === row.id)));
      throw new Error(`Failed to save places: ${error.message}`);
    }
    data = insertedRows;
  }

  // Swap each local-id row for its real Supabase row, matched by array index
  // since localRows/rows/data are all derived from placesToInsert in the same order.
  const savedRows = ((data ?? []) as SavedPlace[]).map(withStableKey);
  await updateSavedPlacesCache(userId, (current) => (
    current.map((row) => {
      const localIndex = localRows.findIndex((local) => local.id === row.id);
      return localIndex >= 0 ? (savedRows[localIndex] ?? row) : row;
    })
  ));
  recordPinHistory('saved', savedRows).catch((error) => console.warn('[placeService] pin history insert failed:', error));

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

  return { inserted: savedRows, duplicates: matchedExisting() };
}

/** Fetch saved places, newest first, for the My Places screens. */
export async function fetchSavedPlaces(): Promise<SavedPlace[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const cached = await getCached<SavedPlace[]>(userId, LOCAL_CACHE_KEYS.savedPlaces);
  const fetchFresh = async () => {
    await flushQueue(userId).catch((error) => console.warn('[placeService] queue flush before fetch failed:', error));
    // PostgREST projects commonly cap a single response at 1,000 rows. Read
    // explicit pages so older saved places are never omitted from the map just
    // because the user has not scrolled the list yet.
    const pageSize = 500;
    const rows: SavedPlace[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from('places')
        .select(PLACE_COLUMNS)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw new Error(`Failed to fetch places: ${error.message}`);
      const page = (data ?? []) as SavedPlace[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    const fresh = rows.map(withStableKey);
    await setSavedPlacesCache(userId, fresh);
    return fresh;
  };

  if (cached) {
    fetchFresh().catch((error) => console.warn('[placeService] background refresh failed:', error));
    return cached;
  }

  return fetchFresh();
}

/**
 * Resolve a place's thumbnail: the real saved photo if there is one, otherwise
 * whatever `fallback` asks for.
 *
 * `'staticMap'` (the default, and the long-standing behaviour) generates a
 * Mapbox static-map pin, so the caller always gets a URL. `'none'` returns an
 * empty string instead, leaving the caller free to render `PlaceCover` — a
 * category-coloured block reads better than a near-identical grey map for
 * every photoless place, but only a caller that has such a fallback can ask
 * for it.
 */
export function resolvePlaceThumbnail(
  place: Pick<SavedPlace, 'photo_url' | 'latitude' | 'longitude'>,
  options: { fallback?: 'staticMap' | 'none' } = {},
): string {
  if (place.photo_url) return place.photo_url;
  return options.fallback === 'none' ? '' : staticMapThumbnail(place.latitude, place.longitude);
}

/** Adapt a DB row to the PlaceDetail shape the detail screens expect.
    Fields we don't persist yet get sensible defaults. */
export function toPlaceDetail(row: SavedPlace): PlaceDetail {
  return {
    id: row.id,
    name: row.name,
    subtitle: row.subtitle ?? '',
    latitude: row.latitude,
    longitude: row.longitude,
    address: row.region ?? '',
    // No static-map fallback: every screen rendering a PlaceDetail thumbnail
    // falls back to PlaceCover, which says more than a grey map tile.
    thumbnailUrl: resolvePlaceThumbnail(row, { fallback: 'none' }),
    schedule: [],
    tags: row.category ? [{ id: row.category, label: row.category }] : [],
    // Also carried through raw, not only as a tag: PlaceCover buckets on it.
    category: row.category ?? undefined,
    summary: row.subtitle ?? '',
    visitStrategy: '',
    note: undefined,
    savedAt: new Date(row.created_at).toLocaleDateString(),
    specialRole: row.special_role ?? null,
  };
}

/** Save or replace one sensitive system place after an explicit chat confirmation. */
export async function saveSpecialPlace(
  role: SpecialPlaceRole,
  place: Omit<SavedPlace, 'id' | 'created_at' | 'special_role' | 'stableKey'>,
): Promise<SavedPlace> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Cannot save special places before auth is ready');
  const existing = (await getCached<SavedPlace[]>(userId, LOCAL_CACHE_KEYS.savedPlaces) ?? [])
    .find((item) => item.special_role === role);
  const roleName: Record<SpecialPlaceRole, string> = {
    home: 'Home',
    office: 'Office',
    school: 'School',
  };
  const payload = {
    // A special place is identified by its role in every My Places surface.
    // Keep that label stable while its subtitle retains the prompt-resolved
    // address the user explicitly confirmed.
    name: roleName[role],
    subtitle: place.subtitle || null,
    category: place.category,
    latitude: place.latitude,
    longitude: place.longitude,
    region: place.region,
    city: place.city,
    country: place.country,
    photo_url: place.photo_url,
    special_role: role,
  };
  const localRow = withStableKey({
    ...payload,
    id: createLocalId(),
    subtitle: payload.subtitle ?? '',
    category: payload.category ?? null,
    region: payload.region ?? null,
    city: payload.city ?? null,
    country: payload.country ?? null,
    photo_url: payload.photo_url ?? null,
    created_at: new Date().toISOString(),
  });

  // Confirmation means the place belongs to the user immediately. Network
  // persistence is reconciled below and must never make that confirmation
  // appear to fail in the chat UI.
  await updateSavedPlacesCache(userId, (current) => [
    localRow,
    ...current.filter((item) => item.special_role !== role),
  ]);

  const replacingPlaceId = existing && !existing.id.startsWith('local-') ? existing.id : undefined;
  void (async () => {
    const query = replacingPlaceId
      ? supabase.from('places').update(payload).eq('id', replacingPlaceId)
      : supabase.from('places').insert(payload);
    try {
      const { data, error } = await withTimeout(
        query.select('id, name, subtitle, category, latitude, longitude, region, city, country, photo_url, special_role, created_at'),
        'Saving special place timed out',
      );
      if (error || !data?.[0]) throw new Error(`Failed to save ${role}: ${error?.message ?? 'no row returned'}`);
      const saved = withStableKey({ ...(data[0] as SavedPlace), name: roleName[role], special_role: role });
      await updateSavedPlacesCache(userId, (current) => [
        saved,
        ...current.filter((item) => item.id !== localRow.id && item.special_role !== role),
      ]);
      recordPinHistory('saved', [saved]).catch((error) => console.warn('[placeService] special-place pin history insert failed:', error));
    } catch (error) {
      // Queue every failure. A server-side validation problem is still not a
      // reason to remove an explicitly confirmed local Office/Home/School.
      console.warn(`[placeService] ${role} saved locally; remote sync deferred:`, error);
      await enqueueWrite(userId, {
        kind: 'saveSpecialPlace',
        role,
        localRow,
        replacingPlaceId,
      });
      void flushQueue(userId).catch((flushError) => console.warn('[placeService] special-place queue flush failed:', flushError));
    }
  })();
  return localRow;
}

/**
 * Delete a place by ID from the places table.
 *
 * @param id  The ID of the place to delete.
 */
export async function deletePlace(id: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Cannot delete places before auth is ready');
  let deletedPlace: SavedPlace | undefined;
  await updateSavedPlacesCache(userId, (current) => {
    deletedPlace = current.find((place) => place.id === id);
    return current.filter((place) => place.id !== id);
  });
  if (deletedPlace) {
    recordPinHistory('deleted', [deletedPlace]).catch((error) => console.warn('[placeService] pin history delete record failed:', error));
  }

  if (id.startsWith('local-')) {
    await enqueueWrite(userId, { kind: 'deletePlace', placeId: id });
    return;
  }

  try {
    const { error } = await withTimeout(supabase.from('places').delete().eq('id', id), 'Deleting place timed out');
    if (error) throw new Error(`Failed to delete place: ${error.message}`);
  } catch (error) {
    if (!isRetryableError(error)) throw error;
    await enqueueWrite(userId, { kind: 'deletePlace', placeId: id });
  }
}

/**
 * Update a saved place's note locally. The current Supabase `places` table
 * does not have a `note` column, so this stays client-side only for now.
 *
 * @param id    The ID of the place to update.
 * @param note  The new note text (empty string clears the note).
 */
export async function updatePlaceNote(id: string, note: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Cannot update place note before auth is ready');
  const trimmed = note.trim();

  await updateSavedPlacesCache(userId, (current) =>
    current.map((place) => (place.id === id ? { ...place, note: trimmed || null } : place)),
  );

  // No-op on the server until the DB schema grows a note column.
}

/** Rename a saved place locally and persist the name when the row is remote. */
export async function updatePlaceName(id: string, name: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Cannot update place name before auth is ready');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Place name cannot be empty');

  const current = (await getCached<SavedPlace[]>(userId, LOCAL_CACHE_KEYS.savedPlaces) ?? [])
    .find((place) => place.id === id);
  if (!current) throw new Error('Place not found');
  await updateSavedPlacesCache(userId, (places) => places.map((place) => (
    place.id === id ? { ...place, name: trimmed } : place
  )));

  if (id.startsWith('local-')) {
    return;
  }
  try {
    const { error } = await withTimeout(
      supabase.from('places').update({ name: trimmed }).eq('id', id),
      'Updating place name timed out',
    );
    if (error) throw new Error(`Failed to update place name: ${error.message}`);
  } catch (error) {
    if (!isRetryableError(error)) throw error;
    await enqueueWrite(userId, {
      kind: 'updatePlaceName',
      placeId: id,
      name: trimmed,
    });
  }
}
