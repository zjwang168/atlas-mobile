# Place Detail Feature

## Overview

`PlaceDetail` is a floating panel that renders rich information about a single saved place. It is triggered by tapping a map marker or list row, and sits above the map as an independent overlay. The panel has three discrete snap states driven by a drag handle.

## File Structure

```
src/features/place-detail/
  PlaceDetail.tsx                        ← panel container, snap logic, PlaceHeader
  PlaceCompactView.tsx                   ← compact snap: name, address, action buttons
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
mock-data/mockPlaces.ts                    ← Place[] used for map markers
mock-data/mockPlaceDetails.ts              ← PlaceDetail[] + findPlaceDetail(name) + findPlaceDetailById(id)
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
| `compact` | Dynamic (from `PlaceCompactView` layout) | `PlaceCompactView` — name, address, share/map/close |
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
        └── PlaceInfoSection       ← tags, collections, summary, visit strategy, links, note
```

## Props

```ts
type PlaceDetailProps = {
  placeName: string | null;      // null = hidden; non-null = slide up and show
  onDismiss: () => void;
  onEdit: (place: PlaceDetail) => void;
};
```

Changing `placeName` from `null → string` triggers the enter animation and `findPlaceDetail` lookup. Changing back to `null` triggers the dismiss animation.

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
