# add-place-field

## Overview

Borderless horizontal card list shared by `FlexiblePlaceField` and each time-slot section in `DateColumn`. Renders draggable `FlexiblePlaceCard` items and a dashed "+" add button. Does not register a DnD drop zone — the parent owns that.

## File Structure

```
plan-place/add-place-field/
  AddPlaceField.tsx      ← scrollable card list + add button
  ADD-PLACE-FIELD.md     ← this document
```

## Props

```ts
type AddPlaceFieldProps = {
  places: PlannedPlace[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  slotKey: SlotKey;      // passed to each card's drag gesture as the drag source
};
```

## Behaviour

- Horizontal `ScrollView` is locked while a drag is active (via `useAnimatedReaction` on `isDragging`).
- Each card receives `slotKey` so the DnD system knows which slot the drag originated from.
- No border or drop zone — callers add both.

## Related docs

- [../flexible-place-field/FLEXIBLE-PLACE-FIELD.md](../flexible-place-field/FLEXIBLE-PLACE-FIELD.md) — wraps this with a border and drop zone
- [../date-range-field/DATE-RANGE-FIELD.md](../date-range-field/DATE-RANGE-FIELD.md) — uses this inside each time-slot section
- [../dnd/DND.md](../dnd/DND.md) — DnD system
