# plan-place/dnd

## Overview

Drag-and-drop system for reordering `PlannedPlace` cards between time slots. Implemented with Reanimated shared values and RNGH `Pan` gesture. The ghost card (floating copy during drag) is rendered inside `DndProvider` to avoid z-index issues.

Does not handle list reordering within a single slot — drops always move to a different (or same) target slot at the end of its list.

## File Structure

```
src/features/my-plan/create-plan/plan-place/dnd/
  DndProvider.tsx   ← context + ghost overlay; must wrap the entire plan-place area
  useDragCard.ts    ← pan gesture hook consumed by PlaceSlotCard
  DND.md            ← this document
```

## Exports / API

### DndProvider

```ts
type DndProviderProps = {
  children: React.ReactNode;
  onDrop: (from: SlotKey, to: SlotKey, place: PlannedPlace, targetIndex?: number) => void;
  reportScrollYToPanel: (y: number) => void; // called with 1 on drag start to lock panel scroll, restored on drop
};
```

### useDndContext

```ts
export function useDndContext(): DndContextValue
```

Must be called inside `DndProvider`. Consumed by `AddPlaceField` (drop zone registration) and `useDragCard` (gesture values).

### useDragCard

```ts
export function useDragCard(place: PlannedPlace, slotKey: SlotKey): { gesture: PanGesture }
```

Returns a long-press-activated pan gesture to attach to a `GestureDetector`. Activates after 400 ms to avoid conflicting with scroll.

### registerPlaceSlotCard

```ts
export function registerPlaceSlotCard(c: React.ComponentType<any>): void
```

Called at module level by `PlaceSlotCard` to break the circular import with `DndProvider` (DndProvider renders PlaceSlotCard as the ghost, but PlaceSlotCard imports useDragCard which imports DndProvider).

## Integration

```tsx
<DndProvider onDrop={handleDrop} reportScrollYToPanel={panelScrollRef}>
  <AddPlaceInDate ... />
</DndProvider>
```

Drop zones (`AddPlaceField`) register themselves on mount via `useDndContext().registerDropZone`. Their screen positions are snapshotted at drag-start via `measureInWindow`.

## Related docs

- [COMPONENTS.md](../components/COMPONENTS.md) — PlaceSlotCard and AddPlaceField that plug into this system
- [../types.ts](../types.ts) — `SlotKey`, `PlannedPlace`
