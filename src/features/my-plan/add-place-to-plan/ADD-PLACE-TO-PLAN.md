# Add Place to Plan Feature

## Overview

`AddPlaceToPlan` is a full-height overlay panel that lets users search and multi-select places to add to a plan slot. It is opened exclusively via `HomeContext.setOverlay({ kind: 'addPlaceToPlan', onSelect })` and delivers its result through the `onSelect` callback.

## File Structure

```
src/features/my-plan/add-place-to-plan/
  AddPlaceToPlan.tsx    ← panel component
  ADD-PLACE-TO-PLAN.md  ← this document
```

## Props

```ts
type AddPlaceToPlanProps = {
  visible: boolean;                          // controls slide-in / slide-out animation
  onDismiss: () => void;                     // user tapped close without confirming
  onSelect: (places: PlannedPlace[]) => void; // user confirmed; receives selected places
};
```

## Behaviour

- Renders inside `ContentPanel` with `zIndex={50}` (highest in the stack).
- **Search** — filters `mockPlaceDetails` by name/subtitle in real time.
- **Filter pills** — `Recommended`, `Best for Summer`, `Nearby`, `Not Yet Visited`. Toggle-to-deselect; currently cosmetic (actual filtering not wired).
- **Multi-select** — each row has a checkbox. Selection is tracked in local `Set<string>`.
- **Confirm button** — disabled when no places selected; label reads `"Add N Place(s)"`. On press, converts selected IDs to `PlannedPlace[]` via `newPlannedPlace()` and calls `onSelect`.
- Panel state (`search`, `activeFilter`, `selected`) is reset via `ContentPanel.onHidden` after the slide-out animation completes.

## Integration via HomeContext

This is the only correct way to open `AddPlaceToPlan`:

```ts
const { setOverlay } = useHome();

setOverlay({
  kind: 'addPlaceToPlan',
  onSelect: (places) => {
    // insert places wherever needed (e.g. into a PlanPlace slot)
    setOverlay({ kind: 'none' });
  },
});
```

`HomeScreen` owns the `<AddPlaceToPlan>` instance and wires `onSelect` → `overlay.onSelect(places)` + `setOverlay({ kind: 'none' })` automatically.

## Data Sources

| File | Used for |
|---|---|
| `mock-data/mockPlaceDetails.ts` | The list of places shown in the picker (`results`) |
| `src/types/place.ts` | `PlaceDetail` — the type of each item in `mockPlaceDetails` |
| `src/features/my-plan/create-plan/plan-place/types.ts` | `PlannedPlace`, `newPlannedPlace()` |

## Types

```ts
// from src/types/place.ts
type PlaceDetail = Place & {
  address: string; thumbnailUrl: string; schedule: DaySchedule[];
  tags: PlaceTag[]; summary: string; visitStrategy: string; ...
};

// from src/features/my-plan/create-plan/plan-place/types.ts
type PlannedPlace = {
  id: string;      // unique instance id (not the underlying place id)
  placeId: string; // id of the source PlaceDetail
  name: string;
  subtitle: string;
};
```
