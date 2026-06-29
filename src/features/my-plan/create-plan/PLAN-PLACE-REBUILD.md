# PlanPlace Rebuild — Implementation Plan

Replaces the `plan-place/components/` folder with two purpose-built folders:
`flexible-place-field/` and `date-range-field/`. Removes `VisitSlot` entirely.
Introduces a free-position time grid with user-resizable cards.

---

## Target File Structure

```
plan-place/
  PlanPlace.tsx                          ← updated
  types.ts                               ← updated (see Step 1)
  utils.ts                               ← unchanged
  flexible-place-field/
    FlexiblePlaceField.tsx               ← new
    FlexiblePlaceCard.tsx                ← new
    FLEXIBLE-PLACE-FIELD.md              ← new
  date-range-field/
    DateRangeField.tsx                   ← new
    DateColumn.tsx                       ← new
    HorizontalTimeView.tsx               ← new
    VerticalTimeView.tsx                 ← new
    timeGrid.ts                          ← new
    DATE-RANGE-FIELD.md                  ← new
  dnd/
    DndProvider.tsx                      ← updated
    useDragCard.ts                       ← unchanged
    DND.md                               ← unchanged
  components/                            ← DELETED
    AddPlaceField.tsx
    AddPlaceInDate.tsx
    PlaceSlotCard.tsx
    COMPONENTS.md
```

---

## Step 1 — Update `types.ts`

**Remove:** `VisitSlot`, `VISIT_SLOTS`, nested `byDate: Record<string, Record<VisitSlot, PlannedPlace[]>>`.

**New `PlannedPlace`:**
```ts
export type PlannedPlace = {
  id: string;
  placeId: string;
  name: string;
  subtitle: string;
  imageUrl?: string;
  startMinute: number;      // minutes from midnight; 0=12AM, -60=11PM, 1500=1AM next day
  durationMinutes: number;  // user-resizable; default 120
};
```

**New `SlotKey`** — no sub-slot division within a date:
```ts
export type SlotKey =
  | { kind: 'free' }
  | { kind: 'dated'; date: string };
```

**New `PlacesState`** — flat array per date, sorted by `startMinute`:
```ts
export type PlacesState = {
  free: PlannedPlace[];
  byDate: Record<string, PlannedPlace[]>;
};
```

`startMinute` / `durationMinutes` are stored on every `PlannedPlace` but ignored while the card sits in the free pool. When a free card is first dropped onto a date it defaults to `startMinute: 540` (9 AM), `durationMinutes: 120`.

Update `newPlannedPlace` to accept `imageUrl?` and set the two new numeric fields.

---

## Step 2 — Create `date-range-field/timeGrid.ts`

Shared constants and helpers consumed by both time views.

```ts
export const TIME_START_MINUTE  = -60;   // 11 PM prior day
export const TIME_END_MINUTE    = 1500;  // 1 AM next day
export const TIME_TOTAL_MINUTES = 1560;  // 26 hours; 12 AM–12 AM always in view

// Fraction [0, 1] along the total timeline for a given minute value
export function minuteToFraction(minute: number): number {
  return (minute - TIME_START_MINUTE) / TIME_TOTAL_MINUTES;
}

// Minute value from a pixel offset, given the total axis length in pixels
export function pixelToMinute(px: number, totalPx: number): number {
  return Math.round((px / totalPx) * TIME_TOTAL_MINUTES) + TIME_START_MINUTE;
}

// Whole-hour tick values: -1 (11 PM), 0 (12 AM), 1 (1 AM), ..., 25 (1 AM next day)
export const HOUR_TICKS: number[] = Array.from({ length: 27 }, (_, i) => i - 1);
```

---

## Step 3 — Create `flexible-place-field/`

### `FlexiblePlaceCard.tsx`
- Container: 64 × 96 (image 56×56 + name label below)
- `rounded-[16px]` image with layered drop shadow matching Figma spec
- Long-press (400 ms) activates `useDragCard` pan gesture
- When `isGhost={true}`: gesture detector replaced with a static icon, remove button hidden

Props:
```ts
type FlexiblePlaceCardProps = {
  place: PlannedPlace;
  onRemove: (id: string) => void;
  isGhost?: boolean;
};
```

### `FlexiblePlaceField.tsx`
- Horizontal `ScrollView` of `FlexiblePlaceCard`s
- `+` add button at the end; calls `onAdd` which opens the place picker via `setOverlay`
- Registers as `{ kind: 'free' }` drop zone with `DndProvider` on mount
- `scrollEnabled={false}` while `isDragging` is true (via `useAnimatedReaction`)

Props:
```ts
type FlexiblePlaceFieldProps = {
  places: PlannedPlace[];
  onAdd: () => void;
  onRemove: (id: string) => void;
};
```

---

## Step 4 — Create `date-range-field/HorizontalTimeView.tsx`

Active when `DateColumn` height is **below** `COMPACT_THRESHOLD`.

Layout:
- Outer horizontally scrollable canvas
- Total canvas width = `TIME_TOTAL_MINUTES × PX_PER_MINUTE` (default `PX_PER_MINUTE = 4` → 6 240 px, tunable constant)
- Hour tick marks: a vertical line + label at `minuteToFraction(hour × 60) × totalWidth` for each value in `HOUR_TICKS`
- Place cards: `position: absolute`
  - `left  = minuteToFraction(place.startMinute) × totalWidth`
  - `width = (place.durationMinutes / TIME_TOTAL_MINUTES) × totalWidth`
  - `height` fills the component's measured height

**Overlap compression:** Group cards whose time ranges intersect. Within a group of N cards, each card gets `height / N` and a stacked `top` offset so they share the vertical space without clipping.

**User resize:** Each card has a right-edge drag handle (separate `PanGesture`, does not conflict with the long-press DnD). Dragging it calls `onResize(id, newDurationMinutes)`.

**Drop zone:** Registers `{ kind: 'dated'; date }`. On drop, `pixelToMinute(dropLocal.x, totalWidth)` sets the new `startMinute`.

Props:
```ts
type HorizontalTimeViewProps = {
  date: string;
  places: PlannedPlace[];
  fieldHeight: number;    // measured height of DateColumn container
  onRemove: (id: string) => void;
  onResize: (id: string, durationMinutes: number) => void;
};
```

---

## Step 5 — Create `date-range-field/VerticalTimeView.tsx`

Active when `DateColumn` height is **at or above** `COMPACT_THRESHOLD`.

Layout:
- Vertically scrollable canvas
- Total canvas height = `TIME_TOTAL_MINUTES × PX_PER_MINUTE_VERTICAL` (default `PX_PER_MINUTE_VERTICAL = 2` → 3 120 px, tunable constant)
- Hour tick marks: a horizontal line + label at `minuteToFraction(hour × 60) × totalHeight`
- Place cards: `position: absolute`
  - `top    = minuteToFraction(place.startMinute) × totalHeight`
  - `height = (place.durationMinutes / TIME_TOTAL_MINUTES) × totalHeight`
  - `width` fills the container width

**Overlap compression:** Cards with intersecting time ranges divide the container width equally (`width / N`, side-by-side `left` offsets).

**User resize:** Bottom-edge drag handle adjusts `durationMinutes`; calls `onResize`.

**Drop zone:** Same `{ kind: 'dated'; date }`. On drop, `pixelToMinute(dropLocal.y, totalHeight)` sets `startMinute`.

Props: same shape as `HorizontalTimeViewProps`.

---

## Step 6 — Create `date-range-field/DateColumn.tsx`

Self-contained per-date component. Uses `onLayout` to measure its own height and switches views at `COMPACT_THRESHOLD = 160` (named constant at top of file — no parent prop needed).

```tsx
const [columnHeight, setColumnHeight] = useState(0);
const isCompact = columnHeight < COMPACT_THRESHOLD;

<View onLayout={e => setColumnHeight(e.nativeEvent.layout.height)}>
  <Text>{formatDate(date)}</Text>
  {isCompact
    ? <HorizontalTimeView date={date} places={places} fieldHeight={columnHeight} ... />
    : <VerticalTimeView   date={date} places={places} ... />
  }
</View>
```

Props:
```ts
type DateColumnProps = {
  date: string;
  places: PlannedPlace[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onResize: (id: string, durationMinutes: number) => void;
};
```

---

## Step 7 — Create `date-range-field/DateRangeField.tsx`

Replaces `AddPlaceInDate`. Renders a horizontal `ScrollView` of `DateColumn`s derived from `enumerateDates(range)`. Column width: `Dimensions.get('window').width * 0.78` (same as current). Outer scroll locked while `isDragging`.

Props:
```ts
type DateRangeFieldProps = {
  range: DateRange;
  byDate: Record<string, PlannedPlace[]>;
  onAdd: (date: string) => void;
  onRemove: (date: string, id: string) => void;
  onResize: (date: string, id: string, durationMinutes: number) => void;
};
```

---

## Step 8 — Update `dnd/DndProvider.tsx`

Three targeted changes; everything else stays the same.

### a) 2D drop zone rect

```ts
// Before
export type DropZoneRect = { key: string; slotKey: SlotKey; y: number; height: number };

// After
export type DropZoneRect = {
  key: string; slotKey: SlotKey;
  x: number; width: number;
  y: number; height: number;
};
```

`finishDrag` picks the zone whose rect contains the ghost's center `(ghostX, ghostY)` — 2D containment check instead of 1D y-range.

### b) `dropLocal` in `onDrop` callback

```ts
// Before
onDrop: (from: SlotKey, to: SlotKey, place: PlannedPlace, targetIndex?: number) => void

// After
onDrop: (from: SlotKey, to: SlotKey, place: PlannedPlace, dropLocal: { x: number; y: number }) => void
```

`dropLocal` is the ghost center position relative to the matched drop zone's origin. `PlanPlace.handleDrop` uses `dropLocal.x` (horizontal view) or `dropLocal.y` (vertical view) to compute `startMinute` via `pixelToMinute`.

### c) Ghost shape

Add `dragSourceKind: SharedValue<'free' | 'dated'>` to `DndContextValue`. Set it in `startDrag`. The ghost renderer checks this value:
- `'free'` → render `FlexiblePlaceCard` at 64 × 96
- `'dated'` → render a timeline card at the dragged card's original dimensions

Maintain the existing `registerPlaceSlotCard` pattern: rename to `registerDragGhostCard` and register two variants (free-ghost and dated-ghost).

---

## Step 9 — Update `PlanPlace.tsx`

- Remove all `VisitSlot` / `VISIT_SLOTS` imports and usages
- Replace `byDate: Record<string, Record<VisitSlot, PlannedPlace[]>>` with `byDate: Record<string, PlannedPlace[]>`
- Replace `openForSlot(date, slot)` with `openForDate(date)` — one add handler per date
- Add `handleResize(date, id, durationMinutes)` — updates `durationMinutes` on the matched card in `byDate[date]`
- `handleDrop` now receives `dropLocal` instead of `targetIndex`; computes `startMinute = pixelToMinute(dropLocal.x or .y, totalPx)` and inserts the card at the correct position (sorted by `startMinute`)
- Replace `<AddPlaceField>` + `<AddPlaceInDate>` with `<FlexiblePlaceField>` + `<DateRangeField>`

---

## Step 10 — Update `savePlan.ts`

- Remove `VisitSlot` import
- Change `PlanDateSlot.slots: Partial<Record<VisitSlot, PlannedPlace[]>>` to `PlanDateSlot.places: PlannedPlace[]`
- Update `buildSchedule` to work with `byDate: Record<string, PlannedPlace[]>` — strip empty arrays, sort by date
- Update `countPlaces` — `byDate` values are now flat arrays

---

## Step 11 — Delete `components/`

Remove:
- `plan-place/components/AddPlaceField.tsx`
- `plan-place/components/AddPlaceInDate.tsx`
- `plan-place/components/PlaceSlotCard.tsx`
- `plan-place/components/COMPONENTS.md`

---

## Step 12 — Create docs

- `plan-place/flexible-place-field/FLEXIBLE-PLACE-FIELD.md`
- `plan-place/date-range-field/DATE-RANGE-FIELD.md`
- Update `plan-place/dnd/DND.md` — reflect 2D rect, `dropLocal`, ghost variants

---

## Known risks

| Area | Risk | Note |
|---|---|---|
| `PX_PER_MINUTE` value | Medium | 4 px/min → 6 240 px canvas; feels right but needs device testing |
| Overlap interval detection | Medium | Requires a sweep-line or sort-and-merge pass over `PlannedPlace[]` per render |
| Resize handle vs. DnD long-press | Medium | Two separate `PanGesture`s on the same card; use `simultaneousHandlers` or mark resize as `exclusiveHandlers` over the handle area |
| `dropLocal` accuracy | Low | Ghost absolute position minus zone origin rect; straightforward after `measureInWindow` |

---

## Recommendations (pre-build corrections)

### R1 — `ghostX` is missing from DndProvider

The current `DndProvider` only tracks `ghostY` (shared value) and the hit-test in `useDragCard.onChange` is 1D (`absoluteY >= zone.y`). The plan requires a 2D hit-test and `dropLocal.x`, but `ghostX` is never stored.

**Fix:** Add `ghostX: SharedValue<number>` alongside `ghostY` in both `DndProvider` and `DndContextValue`. Update `useDragCard.onStart` / `.onChange` to write `ghostX.value = e.absoluteX`. Update the hit-test to check both axes. Update the ghost's `useAnimatedStyle` to use `left: ghostX.value` instead of `left: 16, right: 16`.

---

### R2 — `dropLocal.x` is wrong when the horizontal canvas is scrolled

`HorizontalTimeView` wraps its absolute-positioned canvas in a horizontal `ScrollView`. Drop zones are measured via `measureInWindow` at drag-start, which returns *screen* coordinates. After the user has scrolled the canvas, the ghost's screen X still maps correctly to the zone's screen rect — but `dropLocal.x = ghostX - zone.x` gives the offset from the *visible left edge* of the canvas, not the absolute canvas position. So `pixelToMinute(dropLocal.x, totalWidth)` produces the wrong minute.

**Fix:** `HorizontalTimeView` stores its horizontal scroll offset in a plain ref (`scrollOffsetRef`). When `DndProvider` calls `onDrop`, `PlanPlace.handleDrop` calls `pixelToMinute(dropLocal.x + scrollOffsetRef.current, totalWidth)`. Pass `scrollOffsetRef` as a prop from `HorizontalTimeView` up to `PlanPlace` via the existing `onResize` / `onRemove` callback chain, or expose it on a forwarded ref. The same issue does not affect `VerticalTimeView` because the outer `DateRangeField` scroll is horizontal-only and each date column's vertical canvas scroll is separate — handle symmetrically.

---

### R3 — Resize gesture needs SharedValue, not setState

The plan says "drag the edge handle, call `onResize(id, durationMinutes)`". If `onResize` triggers `setState` in `PlanPlace` on every frame, React re-renders the entire tree at 60 fps during the drag. This is too slow.

**Fix:** Keep a `widthSv: SharedValue<number>` (horizontal) or `heightSv: SharedValue<number>` (vertical) local to each card. The resize `PanGesture.onChange` writes to it in the worklet; `useAnimatedStyle` reads it to resize the card visually. Only `onEnd` calls `onResize(id, finalDurationMinutes)` to commit. This is the standard Reanimated pattern for drag-resize.

---

### R4 — `onLayout` cold-start causes a horizontal→vertical flash

`DateColumn` initialises `columnHeight = 0`. Zero is below `COMPACT_THRESHOLD` (160), so every column renders `HorizontalTimeView` on the first frame. When `onLayout` fires (next frame), columns that are actually tall switch to `VerticalTimeView`. This produces a visible flash.

**Fix:** Initialise `columnHeight` with `null` instead of `0`. While `columnHeight === null`, render nothing (or a skeleton). Switch to the real view only after the first `onLayout`. The layout paint is fast enough that users won't see the skeleton on a real device.

---

### R5 — Initial viewport should show a meaningful time window without scrolling

A fixed `PX_PER_MINUTE = 4` on a 390 px wide column means the column's visible window shows `390 / 4 = 97 minutes` — less than 2 hours. The user would have to scroll immediately to see most of the day.

**Fix:** Add a `VISIBLE_HOURS = 12` constant in `timeGrid.ts`. Compute `PX_PER_MINUTE` at render time from the measured column width: `PX_PER_MINUTE = columnWidth / (VISIBLE_HOURS * 60)`. This ensures the initial viewport always shows 12 hours. The canvas total width then = `TIME_TOTAL_MINUTES * PX_PER_MINUTE`. Pass `columnWidth` from `DateColumn` (already measuring via `onLayout`) down to `HorizontalTimeView`.

---

### R6 — Step ordering: type changes break everything at once

Step 1 changes `PlannedPlace`, `SlotKey`, and `PlacesState`. Every file that imports from `types.ts` breaks immediately, including `DndProvider`, `useDragCard`, `PlanPlace`, and `savePlan`. Building step-by-step from 1→12 means the project is uncompilable for most of the process.

**Fix:** Reorder the build sequence:

1. `types.ts` — new types (Step 1)
2. `savePlan.ts` — update to new `PlacesState` shape (Step 10)
3. `dnd/DndProvider.tsx` — update signatures, add `ghostX`, 2D hit-test (Step 8)
4. `timeGrid.ts` — pure constants, no dependencies (Step 2)
5. `flexible-place-field/` — new files (Step 3)
6. `date-range-field/` — new files (Steps 4–7)
7. `PlanPlace.tsx` — wire everything together (Step 9)
8. Delete `components/` (Step 11)
9. Docs (Step 12)
