# Local Data Service

`src/services/local/` owns on-device persistence for cacheable app data. Feature code should not call `AsyncStorage` directly.

## Files

- `cacheKeys.ts` defines versioned local key names and local-id helpers.
- `localStore.ts` wraps `AsyncStorage` with `{ version, data }` envelopes, user namespacing, and serialized read-modify-write updates.
- `syncQueue.ts` stores retryable offline place writes, flushes them on demand, reconciles local ids after a successful save, and keeps a bounded dead-letter list for failed writes.

## Current Domains

- Places are cache-then-revalidate. `fetchSavedPlaces()` returns cached rows immediately when available, refreshes Supabase in the background, and updates subscribers when fresh rows land.
- Place saves/deletes/note edits are optimistic. Retryable failures are queued and replayed on foreground or the next fetch/save.
- Atlases follow the same shape as places: `fetchAtlases()` is cache-then-revalidate, and `createAtlas()`/`deleteAtlas()` are optimistic local writes — retryable failures are queued (`createAtlas` / `deleteAtlas` write kinds) and replayed the same way. Deleting an atlas still queued in a not-yet-synced `createAtlas` write (offline create-then-delete) cancels it out of the queue entirely, same cancellation pattern as `deletePlace`/`removePlaceFromAtlas`. Deleting an atlas also drops its cached `atlas_places` rows locally; Supabase cascades them server-side (`atlas_places.atlas_id` is `ON DELETE CASCADE`), so no separate queued write is needed for those.
- Atlas ↔ place membership (`atlas_places`) follows the same shape: `fetchAtlasPlaces()` is cache-then-revalidate (one flat cache across all atlases, filtered by `atlas_id` by callers), and `addPlacesToAtlas()`/`removePlaceFromAtlas()` are optimistic local writes — retryable failures are queued (`addAtlasPlaces` / `removeAtlasPlace` write kinds) and replayed the same way. Removing a place still queued in a not-yet-synced `addAtlasPlaces` write (offline add-then-remove) cancels it out of that pending insert during the next flush, rather than replaying a delete for a row Supabase never saw — mirroring how `deletePlace()` cancels an unsynced `savePlaces` write.
- Plans use local storage as their persistence layer until a server-backed plans API exists.

## Public API

```ts
getCached<T>(userId, key)
setCached<T>(userId, key, value)
updateCached<T>(userId, key, update)
clearUserCache(userId)
enqueueWrite(userId, write)
flushQueue(userId)
getLocalSyncDebug(userId)
```

All keys are scoped as `local:<userId>:<domain>`, so cache entries do not leak across account switches.
