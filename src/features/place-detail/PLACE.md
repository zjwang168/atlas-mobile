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
src/types/place.ts                       ← Place, PlaceDetail, DaySchedule, PlaceTag, PlaceLink
src/data/mockPlaces.ts                   ← Place[] used for map markers
src/data/mockPlaceDetails.ts             ← PlaceDetail[] + findPlaceDetail(name)
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
  summary: string;
  visitStrategy: string;
  priceRange: 1 | 2 | 3 | 4;
  phoneNumber?: string;
  links?: PlaceLink[];
  note?: string;
  collections?: PlaceTag[];
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

## Hours Utility

`getOpenStatus(schedule)` derives open/closed state at runtime from `new Date()` — never stored on the model so it cannot go stale. Returns `{ isOpen, todayLabel, statusLine }`.

## Styling

- NativeWind utility classes for layout and spacing
- `useColorScheme` for icon colors (never hardcode light-mode hex in dark-mode-aware components)
- `expo-blur` `BlurView` for the panel background (iOS system material)
