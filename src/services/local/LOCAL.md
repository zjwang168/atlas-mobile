# Local Data Service

`src/services/local/` owns on-device persistence for cacheable app data. Feature code should not call `AsyncStorage` directly.

## Files

- `cacheKeys.ts` defines versioned local key names and local-id helpers.
- `localStore.ts` wraps `AsyncStorage` with `{ version, data }` envelopes, user namespacing, and serialized read-modify-write updates.
- `syncQueue.ts` stores retryable offline place writes, flushes them on demand, reconciles local ids after a successful save, and keeps a bounded dead-letter list for failed writes.

## Current Domains

- Places are cache-then-revalidate. `fetchSavedPlaces()` returns cached rows immediately when available, refreshes Supabase in the background, and updates subscribers when fresh rows land.
- Place saves/deletes/note edits are optimistic. Retryable failures are queued and replayed on foreground or the next fetch/save.
- Atlases follow the same shape as places: `fetchAtlases()` is cache-then-revalidate, and `createAtlas()` is an optimistic local write — retryable failures are queued (`createAtlas` write kind) and replayed the same way.
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
