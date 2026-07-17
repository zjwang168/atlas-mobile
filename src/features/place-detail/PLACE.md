# Place Detail Feature

## Overview

`PlaceDetail` is a floating panel that renders rich information about a single saved place. It is triggered by tapping a map marker or list row, and sits above the map as an independent overlay. The panel has three discrete snap states driven by a drag handle.

## File Structure

```
src/features/place-detail/
  PlaceDetail.tsx                        ← panel container, snap logic, PlaceHeader, PlaceCompactView
  place-detail-sections/
    PlaceOverviewSection.tsx             ← thumbnail, address, open status, action row
    PlaceInfoSection.tsx                 ← tags, summary, visit strategy, links, note
  utils/
    placeHours.ts                        ← getOpenStatus() — derives open/closed at runtime
  PLACE.md                               ← this document
```

Related files outside this directory:
```
src/types/place.ts                         ← canonical types: Place, PlaceDetail, DaySchedule, PlaceTag, PlaceLink
src/services/place/placeService.ts         ← toPlaceDetail(row) adapts a saved-place DB row to PlaceDetail
```

## Data Model

`Place` is the base type — minimal identity used for map markers and list rows. `PlaceDetail` extends it with rich content needed by the detail panel.

```ts
type Place = {
  id: string;
  name: string;
  subtitle: string;       // e.g. "Omakase · Belltown"
  latitude: number;
  longitude: number;
};

type PlaceDetail = Place & {
  address: string;
  thumbnailUrl: string;
  schedule: DaySchedule[];
  tags: PlaceTag[];
  collections?: PlaceTag[];
  summary: string;
  visitStrategy: string;
  note?: string;
  phoneNumber?: string;
  links?: PlaceLink[];
};
```

## Snap States

| State | Height | Content |
|---|---|---|
| `compact` | Dynamic (measured from layout) | `PlaceCompactView` — name, address, share/map/close |
| `default` | 60% of screen | `PlaceHeader` + `PlaceOverviewSection` + `PlaceInfoSection` |
| `full` | 100% of screen | Same as default, with `paddingTop: insets.top` |

## Component Hierarchy

```
PlaceDetail (ContentPanel)
├── [compact snap]
│   └── PlaceCompactView      ← tap anywhere → expand to default
│       ├── name + address
│       └── share / map / dismiss buttons
│
└── [default / full snap]
    ├── PlaceHeader            ← name + dismiss button
    └── ScrollView
        ├── PlaceOverviewSection   ← thumbnail, address, open status, action row
        └── PlaceInfoSection       ← tags, summary, collections, visit strategy, links, note
```

## Behaviour

In `PlaceInfoSection`, **Tags** and **Note** always render their section header regardless of content; every other section (Summary, Collection, Visit Strategy, Links) is hidden entirely when it has no content to show.

## Props

```ts
type PlaceDetailProps = {
  placeId: string | null;        // null = hidden; non-null = slide up and show
  onDismiss: () => void;
  onBack?: () => void;           // when provided, shows a back button instead of leaving the corner empty
  onEdit: (place: PlaceDetail) => void;
  onHeightChange?: (height: number) => void;  // reports live panel height so the caller can pad the map to match, same as HomePanel
};
```

Changing `placeId` from `null → string` triggers the enter animation and looks the place up in `HomeContext.savedPlaces` (converted via `toPlaceDetail`). If no saved place matches the id, a "Place not found" state is shown instead. Changing back to `null` triggers the dismiss animation.

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

## Styling

- NativeWind utility classes for layout and spacing
- `useColorScheme` for icon colors (never hardcode light-mode hex in dark-mode-aware components)
- `expo-blur` `BlurView` for the panel background (iOS system material)
