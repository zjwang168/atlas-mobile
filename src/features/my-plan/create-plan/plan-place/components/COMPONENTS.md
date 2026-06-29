# plan-place/components

## Overview

UI building blocks for the PlanPlace wizard step. These components compose the day-column layout and individual place slots. They are not exported outside of `plan-place` — callers should use `PlanPlace` instead.

## File Structure

```
src/features/my-plan/create-plan/plan-place/components/
  AddPlaceInDate.tsx   ← horizontal scroll of day columns, each with slot drop zones
  AddPlaceField.tsx    ← single slot drop zone (morning / noon / afternoon / night)
  PlaceSlotCard.tsx    ← draggable place row inside a slot; registers itself with DndProvider
  COMPONENTS.md        ← this document
```

## Component summaries

### AddPlaceInDate

Renders a horizontally scrollable list of date columns derived from the plan's `DateRange`. Each column shows all `VisitSlot` rows via `AddPlaceField`. Scroll is locked while a drag is in progress.

```ts
type AddPlaceInDateProps = {
  range: DateRange;
  byDate: Record<string, Record<VisitSlot, PlannedPlace[]>>;
  onAdd: (date: string, slot: VisitSlot) => void;
  onRemove: (date: string, slot: VisitSlot, id: string) => void;
};
```

### AddPlaceField

A single time-slot drop zone. Registers itself with `DndProvider` on mount. Highlights its border when a drag hovers over it.

```ts
type AddPlaceFieldProps = {
  label?: string;
  places: PlannedPlace[];
  slotKey: SlotKey;
  onAdd: () => void;
  onRemove: (id: string) => void;
};
```

### PlaceSlotCard

Displays a place name + subtitle row with a drag handle and remove button. When `isGhost` is true, the remove button is hidden and the gesture detector is replaced with a static icon — used for the floating drag ghost in `DndProvider`.

```ts
type PlaceSlotCardProps = {
  place: PlannedPlace;
  slotKey: SlotKey;
  onRemove: (id: string) => void;
  isGhost?: boolean;  // default: false
};
```

`PlaceSlotCard` calls `registerPlaceSlotCard` at module level to break the circular import with `DndProvider`.

## Related docs

- [DND.md](../dnd/DND.md) — drag-and-drop context these components plug into
- [../types.ts](../types.ts) — `PlannedPlace`, `SlotKey`, `VisitSlot`
