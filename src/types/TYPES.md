# Types

Shared TypeScript types used across features. Import from here — do not re-declare types inline in feature or component files.

## `place.ts` — canonical place types

```ts
import type { Place, PlaceDetail, PlaceSaveOutcome, PlaceTag, PlaceLink, DaySchedule, TimeSlot, DayOfWeek, AtlasPlace } from '@/types/place';
```

| Type | Used by |
|---|---|
| `Place` | Map markers, list rows — minimal identity + coordinates |
| `PlaceSaveOutcome` | `'saved' \| 'duplicate'` — what a save turned out to do, since `savePlaces()` dedups and a matched place creates no row. Produced by `usePlaceSearch`, rendered by `SaveAffordance`, consumed by both search surfaces |
| `PlaceDetail` | Place detail panel, AllPlaces list, AddPlace picker — extends `Place` with `savedAt`, schedule, tags, links, etc. `category` is populated by `toPlaceDetail()` and read by `PlaceCover` to pick a thumbnail colour. The rest of the `places` table columns (`description`, `aiSummary`, `city`/`region`/`country`, `visibility`, `recommended`, `externalPlaceId`, `externalSource`, `createdBy`, `updatedAt`) are carried as optional fields but reserved — not yet populated or consumed by any UI |
| `PlaceTag` | PlaceCard tags, PlaceInfoSection, Badge pills |
| `PlaceLink` | PlaceInfoSection link rows |
| `DaySchedule` / `TimeSlot` | `placeHours.ts` utility, PlaceOverviewSection |
| `DayOfWeek` | `placeHours.ts` — `'monday'` … `'sunday'` |
| `AtlasPlace` | Mirrors the `atlas_places` join table (renamed from `collection_places`), field names matching the DB row (`atlas_id`, `place_id`, `added_by`, `sort_order`, `created_at`) — read/written by `services/atlas/atlasPlacesService.ts` and exposed as `useHome().atlasPlaces`/`addPlacesToAtlas`/`removePlaceFromAtlas`, the same offline-first pattern as `SavedPlace`/`Atlas`; `AtlasDetail.tsx` resolves rows to `PlaceDetail` via `savedPlaces` + `toPlaceDetail()` (see `ATLAS-DETAIL.md`, `HOME.md`) |

## `route.ts` — parse/route API types

```ts
import type { ParseResult, GeocodedLocation, PlaceSuggestion, RouteResult, RouteSegment, ChatMessage } from '@/types/route';
```

| Type | Used by |
|---|---|
| `ParseResult` | `parseLink()` return, `HomeScreen` state; `locations[]` may include backend-filled `photo_url` |
| `GeocodedLocation` | Map markers for route stops, and `retrievePlace()` results; carries optional `photo_url` from parse responses, plus optional `external_id`/`source`/`city`/`region`/`country` that only place search populates |
| `PlaceSuggestion` | One candidate from `searchPlaces()` — deliberately has no coordinates; resolve it via `retrievePlace()` to get a saveable place |
| `RouteResult` | GeoJSON polyline construction |
| `ChatMessage` | `HomeScreen` message thread (`role: 'user' \| 'assistant' \| 'system'`) |

## `atlas.ts` — Atlas row type

```ts
import type { Atlas } from '@/types/atlas';
```

`Atlas` mirrors the Supabase `atlas` table (renamed from `collections`), including its `emoji` column — read/written by `services/atlas/atlasService.ts`, the same offline-first pattern as `SavedPlace`/`placeService.ts`.

## `event.ts` — local event types

```ts
import type { LocalEvent, EventCategory, EventsResult, EventSourceStatus } from '@/types/event';
import { EVENT_CATEGORIES } from '@/types/event';
```

| Type | Notes |
|---|---|
| `LocalEvent` | One row from `GET /events`. `latitude`/`longitude` are never null — the backend drops rows it could not place. A dated event fills `starts_at`; a recurring one fills `schedule_text` and leaves `starts_at` null, so read those two in that order rather than branching on `source`. `image_is_stock` marks an image as a generic category photo rather than a picture of this event — never caption one as if it showed the real thing |
| `EventCategory` | `'festival' \| 'market' \| 'music' \| 'arts' \| 'outdoors' \| 'history' \| 'community'` — the set every backend source is normalized onto; `EVENT_CATEGORIES` is the runtime array |
| `EventSourceStatus` | Per-source outcome (`ok` / `unavailable` / `not_configured`), so a partial answer can be labelled as partial rather than shown as complete |
| `EventsResult` | The whole response — events, source statuses, attribution, and the radius/window actually applied after clamping |

Read/written by `services/events/eventsService.ts`; see `backend/services/events_service/EVENTS-SERVICE.md` for what each source can promise.

## `plan.ts` — plan row types

```ts
import type { PlanRow, PlanItineraryPlaceFlexibleRow, PlanItineraryDayRow, PlanItineraryPlaceRow, VisitSlot } from '@/types/plan';
```

| Type | Used by |
|---|---|
| `PlanRow` | Mirrors the Supabase `plans` table — read/written by `services/plan/planService.ts` |
| `PlanItineraryPlaceFlexibleRow` | Mirrors `plan_itinerary_place_flexible` (a plan's flexible, unscheduled places) — read/written by `services/plan/planItineraryService.ts` |
| `PlanItineraryDayRow` | Mirrors `plan_itinerary_days` — read/written by `services/plan/planItineraryService.ts` |
| `PlanItineraryPlaceRow` | Mirrors `plan_itinerary_places` (a place scheduled onto a day + `visit_slot`) — read/written by `services/plan/planItineraryService.ts` |
| `VisitSlot` | `'morning' \| 'noon' \| 'afternoon' \| 'night'` — matches `plan-place/types.ts`'s `TimeSlot` structurally but is a separate nominal type for the DB row shape |

`src/features/my-plan/create-plan/savePlan.ts` adapts these DB-row types into the `my-plan` wizard's own `SavedPlan`/`PlannedPlace` shapes — see `src/features/my-plan/create-plan/CREATE-PLAN.md`.

## Stub type files (not yet populated)

| File | Intended purpose |
|---|---|
| `import.ts` | Import payload and response types (used by `importService.ts`) |
| `user.ts` | User profile type |
