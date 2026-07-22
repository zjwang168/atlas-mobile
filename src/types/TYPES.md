# Types

Shared TypeScript types used across features. Import from here — do not re-declare types inline in feature or component files.

## `place.ts` — canonical place types

```ts
import type { Place, PlaceDetail, PlaceTag, PlaceLink, DaySchedule, TimeSlot, DayOfWeek, AtlasPlace } from '@/types/place';
```

| Type | Used by |
|---|---|
| `Place` | Map markers, list rows — minimal identity + coordinates |
| `PlaceDetail` | Place detail panel, AllPlaces list, AddPlace picker — extends `Place` with `savedAt`, schedule, tags, links, etc. Also carries the rest of the `places` table columns (`category`, `description`, `aiSummary`, `city`/`region`/`country`, `visibility`, `recommended`, `externalPlaceId`, `externalSource`, `createdBy`, `updatedAt`) as optional fields — reserved for the DB row, not yet populated by `toPlaceDetail()` or consumed by any UI |
| `PlaceTag` | PlaceCard tags, PlaceInfoSection, Badge pills |
| `PlaceLink` | PlaceInfoSection link rows |
| `DaySchedule` / `TimeSlot` | `placeHours.ts` utility, PlaceOverviewSection |
| `DayOfWeek` | `placeHours.ts` — `'monday'` … `'sunday'` |
| `AtlasPlace` | Mirrors the `atlas_places` join table (renamed from `collection_places`), field names matching the DB row (`atlas_id`, `place_id`, `added_by`, `sort_order`, `created_at`) — read/written by `services/atlas/atlasPlacesService.ts` and exposed as `useHome().atlasPlaces`/`addPlacesToAtlas`/`removePlaceFromAtlas`, the same offline-first pattern as `SavedPlace`/`Atlas`; `AtlasDetail.tsx` resolves rows to `PlaceDetail` via `savedPlaces` + `toPlaceDetail()` (see `ATLAS-DETAIL.md`, `HOME.md`) |

## `route.ts` — parse/route API types

```ts
import type { ParseResult, GeocodedLocation, RouteResult, RouteSegment, ChatMessage } from '@/types/route';
```

| Type | Used by |
|---|---|
| `ParseResult` | `parseLink()` return, `HomeScreen` state; `locations[]` may include backend-filled `photo_url` |
| `GeocodedLocation` | Map markers for route stops; carries optional `photo_url` from parse responses |
| `RouteResult` | GeoJSON polyline construction |
| `ChatMessage` | `HomeScreen` message thread (`role: 'user' \| 'assistant' \| 'system'`) |

## `atlas.ts` — Atlas row type

```ts
import type { Atlas } from '@/types/atlas';
```

`Atlas` mirrors the Supabase `atlas` table (renamed from `collections`), including its `emoji` column — read/written by `services/atlas/atlasService.ts`, the same offline-first pattern as `SavedPlace`/`placeService.ts`.

## Stub type files (not yet populated)

| File | Intended purpose |
|---|---|
| `import.ts` | Import payload and response types (used by `importService.ts`) |
| `user.ts` | User profile type |
