# Place Detail Panel — Engineering Document

---

## Overview

`PlaceDetail` is a floating panel that renders rich information about a single place. It is triggered by tapping any place entry (map marker or list row) and sits above the map as an independent overlay. The panel has three discrete snap states controlled by a drag handle at the top.

---

## Data Model

### Type hierarchy

`Place` is the base type — minimal identity used everywhere (map markers, list rows, search results). `PlaceDetail` extends it with the rich content needed by the detail panel. This mirrors a real fetch pattern: the map loads `Place[]` cheaply, then the panel fetches the full `PlaceDetail` on demand.

```ts
// src/types/place.ts

export type Place = {
  id: string;
  name: string;
  subtitle: string;       // short descriptor, e.g. "Omakase · Belltown"
  latitude: number;
  longitude: number;
};

export type DayOfWeek =
  | 'monday' | 'tuesday' | 'wednesday' | 'thursday'
  | 'friday' | 'saturday' | 'sunday';

export type TimeSlot = {
  open: string;    // 24-hour "HH:mm", e.g. "11:00"
  close: string;   // 24-hour "HH:mm". "00:00" = midnight close.
};

export type DaySchedule = {
  day: DayOfWeek;
  slots: TimeSlot[]; // [] = closed; multiple slots = split shift
};

export type PlaceTag = {
  id: string;
  label: string;
};

export type PlaceLink = {
  label: string;
  url: string;
};

export type PlaceDetail = Place & {
  address: string;
  thumbnailUrl: string;
  schedule: DaySchedule[];    // 7 entries, one per DayOfWeek, ordered Mon–Sun
  tags: PlaceTag[];
  summary: string;
  visitStrategy: string;
  priceRange: 1 | 2 | 3 | 4;
  phoneNumber?: string;
  links?: PlaceLink[];
};
```

### Hours utility

`isOpenNow` and today's hours string are always derived at runtime — never stored — so they cannot go stale.

```ts
// src/features/place/utils/placeHours.ts

export type OpenStatus = {
  isOpen: boolean;
  todayLabel: string;   // e.g. "11:00 AM – 10:00 PM" or "Closed today"
  statusLine: string;   // e.g. "Open · Closes at 10:00 PM"
};

export function getOpenStatus(schedule: DaySchedule[]): OpenStatus { ... }
```

`getOpenStatus` reads `new Date()` internally. `formatTimeSlot` is an internal helper — not exported.

---

## File Structure

```
src/
├── types/
│   └── place.ts                        ← Place, PlaceDetail, DaySchedule, PlaceTag, PlaceLink
├── data/
│   ├── mockPlaces.ts                   ← Place[] base list
│   └── mockPlaceDetails.ts             ← PlaceDetail[] + findPlaceDetail(name)
└── features/place/
    ├── PLACE.md                        ← this document
    ├── utils/
    │   └── placeHours.ts               ← getOpenStatus() (public); formatTimeSlot() (internal)
    └── place-detail/
        ├── PlaceDetail.tsx             ← animated container, snap logic, PlaceHeader
        ├── PlaceCompactView.tsx        ← brief-snap compact row (name, address, action buttons)
        └── sections/
            ├── PlaceOverviewSection.tsx ← thumbnail, address, open status, action buttons row
            └── PlaceInfoSection.tsx    ← tags, summary, visit strategy, links
```

---

## Snap States

The panel has three discrete heights driven by one `Animated.Value` (`panelHeight`):

| State | Height | Content rendered | Margins / radius |
|---|---|---|---|
| `brief` | Dynamic (measured from `PlaceCompactView` content) | `PlaceCompactView` (name, address, share/map/close buttons) | 8px L/R margin, 8px bottom, `borderRadius: 40` |
| `default` | 60% of screen | `PlaceHeader` + `PlaceOverviewSection` + `PlaceInfoSection` | 8px L/R margin, 8px bottom, `borderRadius: 40` |
| `full` | 100% of screen | Same as default, with `paddingTop: insets.top` | 0 margin, `borderRadius` animates to `0` |

`full` snap is only reachable by dragging up more than 45% of screen height. `brief → default` requires dragging up more than 5% of screen. `default → brief` requires dragging down more than 15% of screen.

---

## Component Hierarchy

```
PlaceDetail                       ← Animated.View (absolute, bottom-anchored)
│
├── Handle bar                    ← View (48×4 pill) — handlePanResponder (always captures)
│
└── (snap state drives content)
    │
    ├── [brief snap]
    │   └── PlaceCompactView      ← Pressable row; tap anywhere → expand to default
    │       ├── Text              ← place name (1 line, truncated)
    │       ├── Text              ← address (1 line, truncated)
    │       ├── Pressable         ← share button (44×44)
    │       ├── Pressable         ← open in maps button (44×44)
    │       └── Pressable         ← dismiss (44×44), calls onDismiss
    │
    └── [default / full snap]
        ├── PlaceHeader           ← View [row] — place name + dismiss button
        │   ├── Text              ← place name (flex-1, truncated)
        │   └── Pressable         ← close button (48×48), calls onDismiss
        │
        └── ScrollView
            ├── PlaceOverviewSection
            │   ├── View [column] ← address text, open status text
            │   ├── View [row]    ← navigate / share / save / more action buttons
            │   └── Image         ← 112×112 thumbnail, rounded-xl
            │
            └── PlaceInfoSection
                ├── Tags          ← horizontal ScrollView of chip pills (omitted if empty)
                ├── Summary       ← Text block with pencil edit action
                ├── Visit Strategy← Text block with pencil edit action
                └── Links         ← one Pressable row per PlaceLink (omitted if empty)
```

---

## Panel Behavior

### Presentation

- `Animated.View`, `position: absolute`, bottom-anchored. Not a `Modal` — keeps the map interactive behind the panel.
- Enter: slides up from off-screen via `translateY` animation (260ms).
- Dismiss: slides back down (220ms), then `place` state cleared.

### Shadow and clipping

Two-layer wrapper: outer `Animated.View` carries shadow styles only (no `overflow` clip), inner `Animated.View` has `overflow: hidden`. Both animate `borderRadius` together when snapping to `full`.

### Props

```ts
type PlaceDetailProps = {
  placeName: string | null;   // null = hidden; non-null = slide up and show this place
  onDismiss: () => void;
  onEdit: (place: PlaceDetail) => void;
  onOpenImport: () => void;
};
```

`placeName` changing `null → string` triggers the enter animation and `findPlaceDetail` lookup. Changing back to `null` triggers the dismiss animation.

---

## Scroll & Gesture Coordination

Two gesture consumers compete: the panel's snap `PanResponder` and the inner `ScrollView`.

| Condition | Who handles the drag |
|---|---|
| Scroll position > 0 | `ScrollView` owns the gesture |
| Scroll position = 0, drag **downward** | `panelPanResponder` captures — collapses panel |
| Dragging the handle bar | `handlePanResponder` always captures |

- `scrollY` is tracked in a ref (not state) via `onScroll` with `scrollEventThrottle={16}`.
- `panelPanResponder` uses `onMoveShouldSetPanResponder`: only captures when `scrollY.current <= 0 && dy > 4`.
- `handlePanResponder` always sets itself as responder — used for upward snaps (`default → full`).
- Both responders call `resolveSnap` / `dragToHeight` via stable refs to avoid stale closures.

---

## Hours Row Behavior

Implemented inside `PlaceOverviewSection.tsx` via `getOpenStatus`.

- Displays `status.statusLine` (e.g. `"Open · Closes at 10:00 PM"`) in green when open, muted when closed.
- Full expanded schedule lives in a separate expandable component (not yet implemented).

---

## Styling Approach

- NativeWind utility classes for layout and spacing.
- `useColorScheme` for icon colors — never hardcode light-mode-only hex values.
- `expo-blur` `BlurView` for the panel background (iOS system material).
- System font — no custom typeface in this panel.

---

## Interaction States

| State | Behavior |
|---|---|
| No tags | Tags section omitted entirely |
| No `links` / empty array | Links section omitted entirely |
| No `phoneNumber` | Row omitted — no empty placeholder |
| Long place name | Truncated to 1 line in `PlaceCompactView`; 1 line in `PlaceHeader` |
| `full` snap | Panel extends to top of screen; `paddingTop: insets.top` applied |

All `Pressable` targets are minimum 40×40. `accessibilityLabel` set on share, map, and dismiss buttons.

---

## Mock Data

Five records in `mockPlaceDetails.ts` covering distinct UI states:

| Record | Key test case |
|---|---|
| Noma Restaurant | Open, single shift, all links + phone |
| Hidden Sushi | Closed, split-shift schedule, 7 tags, empty links |
| Coffee Corner | Open, no tags, no links, `priceRange: 1` |
| The Long Name Gastropub & Provisions | Name overflow, all days closed |
| Sakura Ramen | Irregular weekly schedule, closed Mon/Tue |
