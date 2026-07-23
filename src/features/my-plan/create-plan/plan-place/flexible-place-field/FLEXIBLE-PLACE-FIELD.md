# flexible-place-field

## Overview

Renders the "Flexible" (undated) pool of planned places inside a bordered container. The border turns green when a card is dragged over it. Card rendering and scroll logic are delegated to `AddPlaceField`.

## File Structure

```
plan-place/flexible-place-field/
  FlexiblePlaceCard.tsx    ← 64×96 card; registers as the DnD ghost component
  FlexiblePlaceField.tsx   ← animated border + drop zone; wraps AddPlaceField
  FLEXIBLE-PLACE-FIELD.md  ← this document
```

## Props

### FlexiblePlaceField

```ts
type FlexiblePlaceFieldProps = {
  places: PlannedPlace[];
  onAdd: () => void;
  onRemove: (id: string) => void;
};
```

### FlexiblePlaceCard

```ts
type FlexiblePlaceCardProps = {
  place: PlannedPlace;
  slotKey?: SlotKey;  // default { kind: 'free' } — passed to useDragCard
  onRemove: (id: string) => void;
  isGhost?: boolean;  // default false — when true, renders without gesture or remove button
};
```

## Behaviour

- `FlexiblePlaceField` owns the `{ kind: 'free' }` DnD drop zone; border and background animate on active hover.
- `FlexiblePlaceCard` self-registers as the global DnD ghost component (`registerDragGhostCard`) at module-load time. DndProvider renders it for all ghost types.
- Drop zone is registered on mount and unregistered on unmount.

## Related docs

- [../add-place-field/ADD-PLACE-FIELD.md](../add-place-field/ADD-PLACE-FIELD.md) — shared card list used inside
- [../dnd/DND.md](../dnd/DND.md) — DnD system
- [../date-range-field/DATE-RANGE-FIELD.md](../date-range-field/DATE-RANGE-FIELD.md) — dated slot counterpart
