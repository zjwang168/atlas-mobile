# Types

Shared TypeScript types used across features. Import from here — do not re-declare types inline in feature or component files.

## `place.ts` — canonical place types

```ts
import type { Place, PlaceDetail, PlaceTag, PlaceLink, DaySchedule, TimeSlot, DayOfWeek } from '@/types/place';
```

| Type | Used by |
|---|---|
| `Place` | Map markers, list rows — minimal identity + coordinates |
| `PlaceDetail` | Place detail panel, AllPlaces list, AddPlaceToPlan picker |
| `PlaceTag` | PlaceCard tags, PlaceInfoSection, Badge pills |
| `PlaceLink` | PlaceInfoSection link rows |
| `DaySchedule` / `TimeSlot` | `placeHours.ts` utility, PlaceOverviewSection |
| `DayOfWeek` | `placeHours.ts` — `'monday'` … `'sunday'` |

## `route.ts` — parse/route API types

```ts
import type { ParseResult, GeocodedLocation, RouteResult, RouteSegment, ChatMessage } from '@/types/route';
```

| Type | Used by |
|---|---|
| `ParseResult` | `parseLink()` return, `HomeScreen` state |
| `GeocodedLocation` | Map markers for route stops |
| `RouteResult` | GeoJSON polyline construction |
| `ChatMessage` | `HomeScreen` message thread (`role: 'user' \| 'assistant' \| 'system'`) |

## Stub type files (not yet populated)

| File | Intended purpose |
|---|---|
| `atlas.ts` | Atlas / collection types |
| `import.ts` | Import payload and response types (used by `importService.ts`) |
| `user.ts` | User profile type |
