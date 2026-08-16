# Place Detail Feature

## Overview

`PlaceDetail` is a floating panel that renders what we know about a single saved place — the AI's summary, the posts it was parsed out of, the user's own note — triggered by tapping a map marker or list row, and sitting above the map as an independent overlay.

## File Structure

```
src/features/place-detail/
  PlaceDetail.tsx                        ← panel container; composes the header and the card stack
  place-detail-sections/
    DetailCard.tsx                       ← shared card shell + row divider
    PlaceDetailHeader.tsx                ← thumbnail, name, chips, dismiss
    PlaceAboutCard.tsx                   ← AI summary + photos
    PlaceSourcesCard.tsx                 ← the posts this place came from
    PlaceNoteCard.tsx                    ← the user's own note
    PlaceCommunityNotesCard.tsx          ← what other people said (no data yet)
    PlaceLocationCard.tsx                ← address / phone rows
    sourceMeta.ts                        ← source_type → platform label, logo, colour
  utils/
    placeHours.ts                        ← getOpenStatus() — derives open/closed at runtime
    usePlaceSources.ts                   ← loads a place's provenance
  PLACE.md                               ← this document
```

Related files outside this directory:
```
src/types/place.ts                         ← canonical types: Place, PlaceDetail, DaySchedule, PlaceTag, PlaceLink
src/services/place/placeService.ts         ← toPlaceDetail(row), fetchPlaceSources(placeId)
```

## Data Model

`Place` is the base type — minimal identity used for map markers and list rows. `PlaceDetail` extends it with the rich content this panel renders. See [TYPES.md](../../types/TYPES.md).

Not everything on `PlaceDetail` is populated. `summary` (`places.description`), `address`, `note`, `category` and the thumbnail are real; `schedule`, `visitStrategy`, `links`, `phoneNumber` and `rating` have nothing writing to them yet. Sections gate on their own data rather than rendering empty frames — see [PLACE-DETAIL-SECTIONS.md](place-detail-sections/PLACE-DETAIL-SECTIONS.md).

Provenance is loaded separately from the place row: `usePlaceSources(placeId)` reads `place_sources`, which is one row per post a place was parsed out of, each carrying that post's own AI summary. This is the one-to-many that makes "several posts describing the same place from different angles" expressible.

## Component Hierarchy

```
PlaceDetail (ContentPanel)
├── PlaceDetailHeader          ← fixed; thumbnail, name, chips, dismiss
├── ScrollView                 ← the card stack
│   ├── PlaceAboutCard
│   ├── PlaceSourcesCard
│   ├── PlaceNoteCard
│   ├── PlaceCommunityNotesCard
│   └── PlaceLocationCard
└── TopBlurFade (edge="bottom")  ← fades the stack out at the sheet's bottom edge
```

## Behaviour

The header stays fixed while the card stack scrolls under it, so dismiss is always reachable.

`usePlaceSources` clears before each read, so the previous place's sources never linger under a new place's name. It returns `[]` for both "no provenance" and "not loaded yet" — `fetchPlaceSources` never throws — so sections treat `[]` as nothing to show rather than as a loading state.

Per-section states (sources expand/collapse, name and note editing) are documented in [PLACE-DETAIL-SECTIONS.md](place-detail-sections/PLACE-DETAIL-SECTIONS.md).

## API

```ts
type PlaceDetailProps = {
  placeId: string | null;        // null = hidden; non-null = slide up and show
  onDismiss: () => void;
  onEdit: (place: PlaceDetail) => void;
  snapGroup?: string;            // shared settled-snap memory, see CONTENT-PANEL.md
  onHeightChange?: (height: number) => void;  // live panel height, so the caller can pad the map to match
};
```

Changing `placeId` from `null → string` triggers the enter animation and looks the place up in `HomeContext.savedPlaces` (converted via `toPlaceDetail`). If no saved place matches the id, a "Place not found" state is shown instead. Changing back to `null` triggers the dismiss animation.

`PlaceDetail` is opened via `HomeContext`'s `placeDetail` overlay (`{ kind: 'placeDetail'; placeId; returnTo?: Overlay }`, see `HOME.md`). `HomeScreen` owns the single `<PlaceDetail>` instance and restores `overlay` to `returnTo` on dismiss instead of always going to `{ kind: 'none' }`, so closing the panel returns to whichever panel opened it (e.g. `AtlasDetail`) rather than the home screen. The trigger is responsible for passing its own current overlay as `returnTo` — see `PlaceCard.tsx` (`../my-places/all-places/PlaceCard.tsx`), the only place that opens this overlay. Dismissing all the way back to the home screen also resets the shared snap group to `default`, so a panel the user dragged to full height doesn't leave the home panel stuck full-screen; dismissing into another overlay leaves the group alone.

## Hours Utility (`utils/placeHours.ts`)

```ts
type OpenStatus = {
  isOpen: boolean;
  todayLabel: string;   // e.g. "9:00 AM – 10:00 PM"
  statusLine: string;   // e.g. "Open · Closes at 10:00 PM" or "Closed · Opens Mon at 9:00 AM"
};

// Derives open/closed state at runtime from new Date() — never stored so it can't go stale
export function getOpenStatus(schedule: DaySchedule[]): OpenStatus

// Formats a TimeSlot[] into a human-readable hours string
export function formatDaySlots(slots: TimeSlot[]): string

// Mon-indexed day order used for schedule lookup
export const orderedDays: DayOfWeek[]
```

No section calls this today: nothing populates `schedule`, and an empty one makes `getOpenStatus` report every place as closed. The utility is kept for the day hours are persisted.

## Sources Hook (`utils/usePlaceSources.ts`)

```ts
// A place's recorded origins, newest first; [] until the read lands, and [] for a place with none
export function usePlaceSources(placeId: string | null): PlaceSource[]
```

## Styling

- NativeWind token classes for colour; `src/theme/typography.ts` tokens for type
- `useColorScheme` for icon colours (never hardcode light-mode hex in dark-mode-aware components)
- `expo-blur` `BlurView` for the panel background, via `ContentPanel`

## Related docs

- [PLACE-DETAIL-SECTIONS.md](place-detail-sections/PLACE-DETAIL-SECTIONS.md) — the header and every card
- [CONTENT-PANEL.md](../../components/content-panel/CONTENT-PANEL.md) — the sheet this renders into
- [SERVICES.md](../../services/SERVICES.md) — `toPlaceDetail`, `fetchPlaceSources`
