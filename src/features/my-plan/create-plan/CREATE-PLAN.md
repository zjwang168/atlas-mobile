# Create Plan Feature

## Overview

Create Plan is a two-step wizard rendered inside the `MyPlan` tab when the user taps "Create a plan". Step 1 collects destination and dates; Step 2 builds the place schedule with drag-and-drop reordering. On completion it persists the plan via `savePlan()` and emits the result.

## File Structure

```
src/features/my-plan/create-plan/
  CreatePlan.tsx                         ← wizard shell; owns step navigation
  savePlan.ts                            ← persistence service (mock → real API)
  plan-destination/
    PlanDestination.tsx                  ← step 1: location + date range
    plan-location/PlanLocation.tsx       ← location text field
    plan-date/PlanDate.tsx               ← calendar range picker
  plan-place/
    PlanPlace.tsx                        ← step 2: place builder
    components/
      AddPlaceField.tsx                  ← a drop zone with + button and card list
      AddPlaceInDate.tsx                 ← horizontal date columns, each with slots
      PlaceSlotCard.tsx                  ← draggable place card
    dnd/
      DndProvider.tsx                    ← drag-and-drop context and ghost layer
      useDragCard.ts                     ← pan gesture hook for PlaceSlotCard
    types.ts                             ← PlannedPlace, SlotKey, PlacesState, VisitSlot
    utils.ts                             ← enumerateDates()
  CREATE-PLAN.md                         ← this document
```

---

## `CreatePlan`

Top-level wizard component.

### Props

```ts
type CreatePlanProps = {
  onClose: () => void;                   // user discards the plan
  onPlanCreated?: (plan: SavedPlan) => void; // plan saved successfully
  reportScrollY: (y: number) => void;    // forward to ContentPanel for gesture coordination
};
```

### Steps

| Step | Component | Purpose |
|---|---|---|
| `destination` | `PlanDestination` | Location text + date range calendar |
| `places` | `PlanPlace` | Flexible/dated place slots with drag-and-drop |

### `createPlanCache`

A module-level object that mirrors the wizard's transient state so it survives React unmounts during drag operations:

```ts
export const createPlanCache: {
  location: string;
  range: DateRange;
  places: PlacesState;
};
```

### `DateRange` type

```ts
export type DateRange = { start: string | null; end: string | null }; // 'YYYY-MM-DD'
```

---

## `savePlan` — persistence service

### Public API

```ts
/** Persist a new plan. Returns the saved plan with a generated id. */
export async function savePlan(input: PlanInput): Promise<SavedPlan>

/** Look up a saved plan by id. Returns undefined if not found. */
export async function findSavedPlan(id: string): Promise<SavedPlan | undefined>

/** Seed a plan directly into the store (used by mock data initialisation). */
export function seedPlan(plan: SavedPlan): void
```

### Types

```ts
type PlanInput = {
  location: string;
  range: DateRange;
  places: PlacesState;
};

type SavedPlan = {
  id: string;
  title: string;
  location: string;
  dateRange: DateRange;
  placeCount: number;
  imageUrl?: string;
  freePlaces: PlannedPlace[];
  schedule: PlanDateSlot[];  // sorted by date, empty slots stripped
};

type PlanDateSlot = {
  date: string;  // 'YYYY-MM-DD'
  slots: Partial<Record<VisitSlot, PlannedPlace[]>>;
};
```

To swap for a real API: replace the mock blocks inside `savePlan` and `findSavedPlan` with `fetch()` calls.

---

## `PlanPlace` — step 2

Renders a "Flexible" drop zone and (when dates are set) a horizontal pager of per-day columns. Each column has four time slots: `morning`, `noon`, `afternoon`, `night`.

Places are added by calling `useHome().setOverlay({ kind: 'addPlaceToPlan', onSelect })` — the overlay delivers `PlannedPlace[]` back into the wizard.

### Drag-and-drop

All DnD state is owned by `DndProvider`. Cards get a `GestureDetector` via `useDragCard`, which activates after a 400ms hold (long-press-then-pan). While dragging, a ghost clone floats under the finger and the hovered drop zone gets a blue border.

```
DndProvider           ← context + ghost layer
  AddPlaceField       ← registers as a drop zone, renders cards
    PlaceSlotCard     ← holds the drag handle; calls startDrag / finishDrag
```

> **Circular import break** — `PlaceSlotCard` imports `useDragCard`, which imports `DndProvider`. To avoid a cycle, `DndProvider` does **not** import `PlaceSlotCard` directly. Instead, `PlaceSlotCard.tsx` calls `registerPlaceSlotCard(PlaceSlotCard)` at module level, and `DndProvider` uses the stored reference to render the ghost clone. Never import `PlaceSlotCard` from inside `DndProvider`.

---

## `DndProvider`

### Context (`useDndContext`)

```ts
const {
  isDragging,         // SharedValue<boolean>
  activeZoneKey,      // SharedValue<string>  — key of the currently hovered zone
  registerDropZone,   // (slotKey, ref) => void
  unregisterDropZone, // (slotKey) => void
  startDrag,          // (place, sourceSlot) => void — call on gesture start
  finishDrag,         // (zoneKey | null) => void   — call on gesture end
} = useDndContext();
```

### Props

```ts
type DndProviderProps = {
  children: React.ReactNode;
  onDrop: (from: SlotKey, to: SlotKey, place: PlannedPlace, targetIndex?: number) => void;
  reportScrollYToPanel: (y: number) => void;
};
```

---

## `plan-place/types.ts`

```ts
export type VisitSlot = 'morning' | 'noon' | 'afternoon' | 'night';

export type PlannedPlace = {
  id: string;      // unique instance id
  placeId: string; // source PlaceDetail.id
  name: string;
  subtitle: string;
};

export type SlotKey =
  | { kind: 'free' }
  | { kind: 'dated'; date: string; slot: VisitSlot };

export type PlacesState = {
  free: PlannedPlace[];
  byDate: Record<string, Record<VisitSlot, PlannedPlace[]>>;
};

// Convert a SlotKey to a stable string key for Maps / Sets
export function slotKeyToString(key: SlotKey): string

// Create a new PlannedPlace instance from a PlaceDetail-like source
export function newPlannedPlace(place: { id: string; name: string; subtitle: string }): PlannedPlace
```

---

## `plan-place/utils.ts`

```ts
// Returns every date string in [range.start, range.end] inclusive
export function enumerateDates(range: DateRange): string[]
```
