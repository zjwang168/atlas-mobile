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

// ── Base ──────────────────────────────────────────────────────────────────────

export type Place = {
  id: string;
  name: string;
  subtitle: string;       // short descriptor, e.g. "Omakase · Belltown"
  latitude: number;
  longitude: number;
};

// ── Hours schedule ────────────────────────────────────────────────────────────

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type TimeSlot = {
  open: string;    // 24-hour "HH:mm", e.g. "11:00"
  close: string;   // 24-hour "HH:mm", e.g. "22:00". "00:00" = midnight close.
};

export type DaySchedule = {
  day: DayOfWeek;
  slots: TimeSlot[]; // [] = closed that day; multiple slots = split shift (e.g. lunch + dinner)
};

// ── Tags ──────────────────────────────────────────────────────────────────────

export type PlaceTag = {
  id: string;
  label: string;   // e.g. "Japanese", "Late Night", "Omakase"
};

// ── Extended detail ───────────────────────────────────────────────────────────

export type PlaceLink = {
  label: string;   // e.g. "Official Website", "Instagram", "Reservations"
  url: string;
};

export type PlaceDetail = Place & {
  address: string;            // human-readable, e.g. "2319 2nd Ave, Seattle, WA"
  thumbnailUrl: string;
  schedule: DaySchedule[];    // always 7 entries, one per DayOfWeek, ordered Mon–Sun
  tags: PlaceTag[];
  summary: string;
  visitStrategy: string;
  priceRange: 1 | 2 | 3 | 4; // $ $$ $$$ $$$$
  phoneNumber?: string;
  links?: PlaceLink[];        // external links shown in the Links info section
};
```

### Hours utility

`isOpenNow` and today's hours string are **never stored in the data** — they are always derived at runtime so they cannot go stale.

```ts
// src/features/place/utils/placeHours.ts

export type OpenStatus = {
  isOpen: boolean;
  todayLabel: string;     // e.g. "11:00 AM – 10:00 PM" or "Closed today"
  statusLine: string;     // e.g. "Open · Closes at 10:00 PM" or "Closed · Opens Fri at 11:00 AM"
};

// Public API — consumed by PlaceHoursRow and PlaceBriefView
export function getOpenStatus(schedule: DaySchedule[]): OpenStatus { ... }

// Internal helper used only inside getOpenStatus
function formatTimeSlot(slot: TimeSlot): string { ... }
// converts { open: "11:00", close: "22:00" } → "11:00 AM – 10:00 PM"
```

`getOpenStatus` reads `new Date()` internally — it should not accept a date param yet. `formatTimeSlot` is not exported; callers should use `getOpenStatus` and consume its formatted strings. The `statusLine` is shown collapsed in `PlaceHoursRow`; `todayLabel` is the per-row string in the expanded schedule list.

---

## File Structure

```
src/
├── types/
│   └── place.ts                        ← Place, PlaceDetail, DaySchedule, PlaceTag, PlaceLink, etc.
├── utils/
├── data/
│   ├── mockPlaces.ts                   ← Place[] (existing; extend to 5 entries to match detail records)
│   └── mockPlaceDetails.ts             ← PlaceDetail[] + findPlaceDetail(name) lookup
└── features/place/
    ├── PLACE.md                        ← this document
    ├── utils/
    │   └── placeHours.ts               ← getOpenStatus() (public); formatTimeSlot() (internal)
    └── place-detail/
        ├── PlaceDetail.tsx             ← animated container, snap logic, header, compact brief view
        └── sections/
            ├── PlaceBriefSection.tsx   ← default/full-snap brief plus hours row
            └── PlaceInfoSection.tsx    ← tags, summary, visit strategy, links
```

---

## Snap States

The panel has three discrete heights, all driven by one `Animated.Value` (`panelHeight`):

| State | Height | Content rendered | Margins / radius |
|---|---|---|---|
| `brief` | 30% of screen | `PlaceBriefView` (dismiss button, thumbnail, name, address, map button) | 4px L/R margin, 8px bottom, `borderRadius: 40` |
| `default` | 70% of screen | `PlaceHeader` + `PlaceFullBrief` + `PlaceInfo` sections | 4px L/R margin, 8px bottom, `borderRadius: 40` |
| `full` | 100% of screen | same as default | 0 margin, `borderRadius` animates to `0` |

`full` snap is **only reachable by dragging the handle to the top area of the screen** — it does not activate from a small upward flick. Concretely: if the gesture `dy` crosses the threshold of `screenHeight * 0.25` (dragged upward by 25% of screen), snap to `full`. Otherwise snap back to `default`.

Transitions between `brief ↔ default`: crossing `screenHeight * 0.15` downward from `default` collapses to `brief`. Tapping anywhere on `PlaceBriefView` expands to `default` — no handle drag required.

---

## Component Hierarchy

```
PlaceDetail                   ← Animated.View (absolute, bottom-anchored)
│
├── Handle                    ← View (36×4 rounded bar) + PanResponder target
│
└── (snap state drives content)
    │
    ├── [brief snap]
    │   └── PlaceBriefView    ← Pressable (tap expands to default)
    │       ├── Pressable     ← dismiss button, top-left, 44×44, calls onDismiss
    │       ├── Image         ← compact thumbnail, 100px tall, full-width, cover
    │       ├── Text          ← place name, 18px bold
    │       ├── Text          ← address, 13px secondary
    │       └── Pressable     ← map icon button, bottom-right
    │                            {/* TODO: open place in external maps app for navigation */}
    │
    └── [default / full snap]
        ├── PlaceHeader       ← View [row] — back button left, edit button right, no title
        │   ├── Pressable     ← ‹ back (44×44), calls onDismiss
        │   └── Pressable     ← ✎ edit (44×44), calls onEdit(place)
        │
        └── ScrollView        ← native ScrollView, bounces, ref forwarded for scroll tracking
            │
            ├── PlaceFullBrief
            │   ├── Image                 ← full-width thumbnail, 180px tall, cover
            │   ├── Text                  ← place name, 22px bold
            │   ├── Text                  ← address, 14px secondary
            │   ├── PlaceHoursRow         ← collapsed: statusLine + chevron
            │   │   └── (expanded) list   ← one row per DaySchedule, animated height
            │   └── Text                  ← price range
            │
            └── PlaceInfo             ← View [column]
                ├── PlaceInfoSection (tags)
                │   └── PlaceTagList
                ├── PlaceInfoSection (summary)
                │   └── Text
                ├── PlaceInfoSection (visit strategy)
                │   └── Text
                └── PlaceInfoSection (links)
                    └── View [column] ← one row per PlaceLink; omitted if links is empty/undefined
```

---

## Panel Behavior

### Presentation

- `Animated.View`, `position: absolute`, bottom-anchored. Not a `Modal` — keeps the map interactive behind the panel.
- Enter animation: slides up from off-screen via `Animated.timing` on `translateY`.
- Dismiss: slides back down, then parent sets `selectedPlace` to `null`.

### Shadow and clipping

`overflow: hidden` clips child content to the rounded corners but also clips the shadow on Android. Use a two-layer wrapper:

```
<View style={shadowStyle}>            ← shadow only, no overflow clip, borderRadius: 40
  <Animated.View style={panelStyle}>  ← overflow: hidden, same borderRadius
    ...content
  </Animated.View>
</View>
```

When snapping to `full`, animate `borderRadius` on both layers simultaneously to `0` and collapse `left`/`right`/`bottom` margins to `0`.

### Props

The panel's external API is a place name string and an active flag. The parent does not manage a `PlaceDetail` object — it only knows the name of the place to show.

```ts
type PlaceDetailProps = {
  placeName: string | null;   // null = panel hidden; non-null = slide up and display this place
  onDismiss: () => void;
  onEdit: (place: PlaceDetail) => void;
};
```

`placeName` changing from `null` → string triggers the slide-up enter animation and a `findPlaceDetail(placeName)` lookup internally. Changing back to `null` triggers the slide-down dismiss animation.

### PlaceHeader (default / full snap only)

- Row, `paddingHorizontal: 16`, `paddingVertical: 12`
- **No title** — place name lives in the content below, no duplication.
- Left: `‹` Pressable (44×44), calls `onDismiss`.
- Right: `✎` Pressable (44×44), calls `onEdit(place)`.
- Not rendered in `brief` snap.

---

## Scroll & Gesture Coordination

This is the hardest implementation problem. Two gesture consumers compete: the panel's snap `PanResponder` and the inner `ScrollView`.

### Rule

| Condition | Who handles the drag |
|---|---|
| Panel is in `brief` snap | No ScrollView active — `PanResponder` on the handle only |
| Panel is in `default`/`full`, scroll position > 0 | `ScrollView` owns the gesture |
| Panel is in `default`/`full`, scroll position = 0, drag direction is **downward** | `PanResponder` captures and collapses panel |
| Dragging the **handle bar** in any state | Always `PanResponder` |

### Implementation

- Track scroll position with `onScroll` on the `ScrollView`, stored in a `scrollY` ref (not state — no re-render needed).
- The `ScrollView`'s `scrollEnabled` prop is derived: `scrollEnabled = (snapState !== 'brief')`.
- On the panel, attach a `PanResponder` that uses `onMoveShouldSetPanResponder`: only capture if `scrollY.current === 0 && gestureState.dy > 0` (scroll at top, dragging down) OR the gesture originates on the handle bar.
- The handle bar has its own dedicated `PanResponder` that always captures — used for the `brief → default → full` upward transitions.

---

## Hours Row Behavior

Implemented inside `sections/PlaceBriefSection.tsx`.

- **Collapsed** (default): one row showing `statusLine` from `getOpenStatus()` (e.g. `"Open · Closes at 10:00 PM"`), chevron `›` on the right.
- **Expanded**: the full `schedule` array rendered beneath, one row per `DaySchedule`. Each row: day name left (bold-weighted if today), formatted slot(s) right. Closed days show `"Closed"` in muted color.
- Animation: `Animated.timing` on `maxHeight` (`0 → measuredHeight`). Chevron rotates 90°, also animated.
- Today's row is highlighted (slightly bolder day label).

Multi-slot days (split shifts): slots are stacked vertically in the right cell, e.g. `"11:00 AM – 2:00 PM"` / `"5:00 PM – 10:00 PM"`.

---

## Layout Spec

### Panel container (shadow wrapper)
- `position: absolute`, `bottom: 8`, `left: 4`, `right: 4`
- `borderRadius: 40`, shadow properties only
- `shadowColor: #000`, `shadowOffset: { width: 0, height: -2 }`, `shadowOpacity: 0.08`, `shadowRadius: 16`, `elevation: 12`

### Inner `Animated.View`
- `overflow: hidden`, `borderRadius: 40` (animates to `0` at full snap)
- `height` driven by `panelHeight` Animated.Value

### Handle
- `width: 36`, `height: 4`, `borderRadius: 2`, centered, `marginTop: 10`, muted color

### PlaceBriefView (brief snap only)
- Entire view is a `Pressable` — tap anywhere to expand to `default` snap.
- **Dismiss button**: `Pressable`, top-left, absolute positioned, 44×44 hit target. `expo-symbols` `chevron.down` icon or `‹` text fallback. Calls `onDismiss`. `zIndex` above the tap-to-expand Pressable.
- Stack: `Image` (compact, 100px tall, full-width, cover) → `Text` name (18px bold) → `Text` address (13px secondary)
- **Map button**: `Pressable`, bottom-right, absolute positioned, 44×44, map icon (`expo-symbols` `map` or `map.fill`).
  ```tsx
  // TODO: open this place in an external maps app for navigation
  // Linking.openURL(`maps://?q=${encodeURIComponent(place.name)}&ll=${place.latitude},${place.longitude}`)
  ```
- Padding: `16px` horizontal

### PlaceFullBrief
- Thumbnail: full-width, `height: 180`, `borderRadius: 12`, cover
- Name: 22px, bold, system font
- Address: 14px, secondary color, leading `⊙` glyph
- Hours row: see PlaceHoursRow above
- Price: 14px, `$` × `priceRange`, muted color

### PlaceInfoSection
- Label: 11px, uppercase, letter-spaced, secondary label color
- 1px hairline divider above content
- `paddingTop: 8`, `paddingBottom: 16`

### PlaceTagList
- Horizontal `ScrollView`, `showsHorizontalScrollIndicator={false}`
- Chip: `paddingHorizontal: 12`, `paddingVertical: 6`, `borderRadius: 999`, tinted background, 13px label

### PlaceInfoSection — Links
- One `Pressable` row per `PlaceLink` entry.
- Row: link label left (14px, primary color), `expo-symbols` `arrow.up.right` chevron right.
- Tapping a row: `Linking.openURL(link.url)` — placeholder for now, actual behavior commented in code.
- Section omitted entirely if `links` is `undefined` or empty array.

---

## Styling Approach

Target iOS-native aesthetic; use native/Expo components before reaching for utility classes.

1. `expo-symbols` for icons (SF Symbols on iOS, Material Symbols on Android).
2. `expo-blur` / `expo-linear-gradient` where they add fidelity (e.g. thumbnail gradient overlay).
3. `StyleSheet.create` for all layout and visual styles.
4. System font — `fontFamily: undefined` (platform default). No custom font for this panel.
5. NativeWind only if a specific utility is simpler than an equivalent StyleSheet entry.

---

## Interaction States

| State | What to render |
|---|---|
| Normal | Full panel content |
| Long place name (>30 chars) | Name wraps to 2 lines in `PlaceFullBrief`, truncated to 1 line in `PlaceBriefView` |
| No tags | `PlaceInfoSection` for tags is omitted entirely |
| No `phoneNumber` | Row omitted — no empty placeholder |
| No `links` / empty `links` | Links section omitted entirely |
| All days closed | `PlaceHoursRow` shows `"Closed"` in statusLine, expanded list shows all days as closed |
| Single-slot vs. split-shift day | Single slot: one time string. Split shift: two time strings stacked in right cell |

Accessibility: all `Pressable` targets are at minimum 44×44. Add `accessibilityLabel` to back button (`"Dismiss place details"`), edit button (`"Edit place"`), and hours toggle (`"Show full schedule"` / `"Hide schedule"`).

---

## Mock Data

### Structure

`mockPlaces.ts` holds the base `Place[]`. `mockPlaceDetails.ts` holds `PlaceDetail[]` with the same `id` values, so the panel can look up detail by `place.id`. This mirrors the real fetch pattern.

```ts
// src/data/mockPlaceDetails.ts
import { PlaceDetail } from '../types/place';
export const mockPlaceDetails: PlaceDetail[] = [ ... ];

// Lookup by name — matches how the external panel API identifies a place
export function findPlaceDetail(name: string): PlaceDetail | undefined {
  return mockPlaceDetails.find(p => p.name === name);
}
```

`mockPlaces.ts` must also be extended to include entries for ids `"3"`, `"4"`, `"5"` so the base list stays consistent with the detail records.

### Records

Five records to cover distinct UI states:

**Record 1 — Noma Restaurant** (id: `"1"`, name: `"Noma Restaurant"`)
- Currently open, single shift Mon–Fri, closed Sat–Sun
- 4 tags, `priceRange: 4`, medium summary, 1-sentence visitStrategy
- `links`: [{ label: "Official Website", url: "..." }, { label: "Reservations", url: "..." }]
- `phoneNumber` present

**Record 2 — Hidden Sushi** (id: `"2"`, name: `"Hidden Sushi"`)
- Currently closed, split-shift schedule (lunch + dinner) every day
- 7 tags (tests horizontal scroll overflow), `priceRange: 3`, 1-sentence summary, 3-sentence visitStrategy
- `links`: empty array (tests omitted links section), no `phoneNumber`

**Record 3 — Coffee Corner** (id: `"3"`, name: `"Coffee Corner"`)
- Open, single all-day slot every day (simplest possible schedule)
- No tags (tests omitted tags section), `priceRange: 1`
- `links`: undefined, no `phoneNumber`

**Record 4 — The Long Name Gastropub & Provisions** (id: `"4"`, name: `"The Long Name Gastropub & Provisions"`)
- Tests name overflow in `PlaceBriefView` (truncated to 1 line) and `PlaceFullBrief` (wraps to 2 lines)
- All days closed (tests all-closed schedule rendering)
- 5 tags, `priceRange: 2`, 4-sentence summary, 3-sentence visitStrategy
- `links`: [{ label: "Instagram", url: "..." }]

**Record 5 — Sakura Ramen** (id: `"5"`, name: `"Sakura Ramen"`)
- Open, irregular schedule: closed Mon/Tue, unique hours per day Wed–Sun (7 individual `DaySchedule` entries)
- 6 tags, `priceRange: 2`
- `links`: [{ label: "Menu", url: "..." }], no `phoneNumber`

---

## Open Questions

- **Full-screen SafeAreaView**: at `full` snap the panel covers the status bar area. Decide whether to render a `SafeAreaView` inside the panel or offset content by `insets.top` from `useSafeAreaInsets`.
