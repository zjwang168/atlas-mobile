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

`CreatePlan` is a `forwardRef` component exposing a `reset()` imperative handle.

```ts
type CreatePlanProps = {
  onClose: () => void;                   // user discards the plan
  onPlanCreated?: (plan: SavedPlan) => void; // plan saved successfully
  reportScrollY: (y: number) => void;    // forward to ContentPanel for gesture coordination
  inline?: boolean;                      // true for MyPlan's permanently-mounted instance; forwarded to PlanPlace, see its Behaviour section
};

export type CreatePlanHandle = {
  reset: () => void;  // clears wizard state + createPlanCache; call before re-showing a permanently-mounted instance
};
```

Resets automatically on mount (for callers that mount/unmount it normally, e.g. `HomeScreen`'s `createPlan` overlay). `MyPlan` keeps `CreatePlan` permanently mounted for a flicker-free cross-fade with the plan grid, so it calls `ref.current.reset()` explicitly each time the user re-enters create mode instead of relying on mount timing, and passes `inline` so `PlanPlace` knows it isn't reachable via `overlay.kind`.

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

Backed by the real Supabase `plans` / `plan_itinerary_place_flexible` / `plan_itinerary_days` / `plan_itinerary_places` tables via `services/plan/planService.ts` and `services/plan/planItineraryService.ts` — this module adapts between the wizard's `PlacesState` shape and those DB-row-shaped services. See `docs/schema.sql`/`docs/erd.dbml` for the schema this maps onto.

### Public API

```ts
/** Persist a new plan. Returns the saved plan with a generated id. */
export async function savePlan(input: PlanInput): Promise<SavedPlan>

/** Look up a saved plan by id. Returns undefined if not found. */
export async function findSavedPlan(id: string): Promise<SavedPlan | undefined>

/** List saved plans for the MyPlan grid. */
export async function listSavedPlans(): Promise<SavedPlan[]>

/** Delete a saved plan. */
export async function deleteSavedPlan(id: string): Promise<void>
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
  schedule: PlanDateSlot[];
};

type PlanDateSlot = {
  date: string;  // 'YYYY-MM-DD'
  places: PlannedPlace[];  // flat list — each place carries its own optional `timeSlot`, not nested by slot
};
```

### Behaviour

`listSavedPlans()` returns each plan's real `placeCount` and a default `imageUrl` (the earliest-added place's thumbnail across both flexible and scheduled places, via `planItineraryService.fetchPlanSummaries()` + `placeService.resolvePlaceThumbnail()`) but empty `freePlaces`/`schedule` — the grid doesn't need the full per-place breakdown, only `findSavedPlan()` (used by `PlanDetail`) loads that. The plan cover keeps `resolvePlaceThumbnail()`'s generated-Mapbox-pin fallback, so a plan whose cover place has no photo still gets a distinct thumbnail. Individual plan places do not: they resolve with no fallback and render a `PlaceCover` instead, matching how the same place looks everywhere else. `plans.image_url`, when explicitly set, takes priority over the derived cover. A place added to a plan lands in exactly one place server-side: `input.places.free` entries become `plan_itinerary_place_flexible` rows, `input.places.byDate` entries become `plan_itinerary_places` rows — there's no row-level link between the two.

---

## `PlanPlace` — step 2

Renders a "Flexible" drop zone and (when dates are set) a horizontal pager of per-day columns. Each column has four time slots: `morning`, `noon`, `afternoon`, `night`.

Places are added by calling `useHome().setOverlay({ kind: 'addPlace', onSelect, returnTo })` — the overlay delivers `PlaceDetail[]` back, which the wizard converts to `PlannedPlace[]` via `newPlannedPlace()`.

`returnTo` depends on the `inline` prop threaded down from `CreatePlan`/`MyPlan`, since `PlanPlace` is shared by two differently-hosted `CreatePlan` instances that must not both react to the same overlay state:
- `inline` false (`HomeScreen`'s `overlay.kind === 'createPlan'` instance): `returnTo: { kind: 'createPlan' }` — this is why `HomeScreen` keeps that `CreatePlan` mounted underneath the `addPlace` overlay instead of unmounting it (see `HOME.md`); `CreatePlan` resets its wizard state (`step`, `location`, `range`, `createPlanCache`) on every mount, so unmounting mid-flow to show `AddPlace` would otherwise wipe the in-progress plan when the user returned.
- `inline` true (`MyPlan`'s permanently-mounted instance): `returnTo: { kind: 'none' }` — this instance's visibility is local `showCreatePlan` state, not `overlay`, so it's never reachable via `overlay.kind`. Using `{ kind: 'createPlan' }` here would make `HomeScreen`'s render condition (`overlay.kind === 'addPlace' && overlay.returnTo?.kind === 'createPlan'`) match too, mounting a *second*, unstyled `CreatePlan` directly over the map on top of `MyPlan`'s own panel-wrapped instance the moment `AddPlace` opened.

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
export type TimeSlot = 'morning' | 'noon' | 'afternoon' | 'night';

export type PlannedPlace = {
  id: string;      // unique instance id
  placeId: string; // source PlaceDetail.id
  name: string;
  subtitle: string;
  imageUrl?: string;
  category?: string;  // picks the PlaceCover colour shown when imageUrl is absent
  timeSlot?: TimeSlot;
};

export type SlotKey =
  | { kind: 'free' }
  | { kind: 'dated'; date: string; timeSlot: TimeSlot };

export type PlacesState = {
  free: PlannedPlace[];
  byDate: Record<string, PlannedPlace[]>;  // flat — each place carries its own optional `timeSlot`, not nested by slot
};

// Convert a SlotKey to a stable string key for Maps / Sets
export function slotKeyToString(key: SlotKey): string

// Create a new PlannedPlace instance from a PlaceDetail-like source
export function newPlannedPlace(place: { id: string; name: string; subtitle: string; imageUrl?: string; category?: string }): PlannedPlace
```

---

## `plan-place/utils.ts`

```ts
// Returns every date string in [range.start, range.end] inclusive
export function enumerateDates(range: DateRange): string[]
```
