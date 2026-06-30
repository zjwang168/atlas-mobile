# plan-place/dnd

## Overview

Drag-and-drop system for moving `PlannedPlace` cards between the free pool and dated time-slot sections. Implemented with Reanimated shared values and RNGH `Pan` gesture. The ghost card (floating copy during drag) is rendered inside `DndProvider` to avoid z-index issues.

## File Structure

```
src/features/my-plan/create-plan/plan-place/dnd/
  DndProvider.tsx   ← context + ghost overlay; must wrap the entire plan-place area
  useDragCard.ts    ← pan gesture hook consumed by FlexiblePlaceCard
  DND.md            ← this document
```

## Exports / API

### DndProvider

```ts
type DndProviderProps = {
  children: React.ReactNode;
  onDrop: (from: SlotKey, to: SlotKey, place: PlannedPlace) => void;
  reportScrollYToPanel: (y: number) => void;
};
```

### useDndContext

```ts
export function useDndContext(): DndContextValue
```

Must be called inside `DndProvider`. Consumed by drop zones and `useDragCard`.

### useDragCard

```ts
export function useDragCard(place: PlannedPlace, slotKey: SlotKey): { gesture: PanGesture }
```

Returns a long-press-activated (400 ms) pan gesture. Writes `ghostX`, `ghostY`, and `dragSourceKind` shared values.

### registerDragGhostCard

```ts
export function registerDragGhostCard(c: React.ComponentType<any>): void
```

Called at module level by `FlexiblePlaceCard` to break the circular import with `DndProvider`.

### registerDropZone

```ts
registerDropZone(slotKey: SlotKey, ref: React.RefObject<any>): void
```

Drop zones call this on mount. The rect is measured from `ref` via `measureInWindow` when a drag starts.

## Drop zone hit-test

On drag-start, all drop zones are measured and snapshotted into a `SharedValue<DropZoneRect[]>`. During drag, `useDragCard.onChange` checks the absolute finger position against each rect:

```
absX >= zone.x && absX <= zone.x + zone.width &&
absY >= zone.y && absY <= zone.y + zone.height
```

The first matching zone is the active drop zone; its `slotKey` is passed to `onDrop` when the gesture ends.

## Ghost positioning

Ghost is positioned at `left: ghostX - 32, top: ghostY - 48` (container-relative), centering a 64×96 `FlexiblePlaceCard` ghost under the finger.

## Integration

```tsx
<DndProvider onDrop={handleDrop} reportScrollYToPanel={panelScrollRef}>
  <FlexiblePlaceField ... />   {/* registers { kind: 'free' } drop zone */}
  <DateRangeField ... />       {/* each SlotSection registers { kind: 'dated'; date; timeSlot } */}
</DndProvider>
```

## Related docs

- [../flexible-place-field/FLEXIBLE-PLACE-FIELD.md](../flexible-place-field/FLEXIBLE-PLACE-FIELD.md)
- [../date-range-field/DATE-RANGE-FIELD.md](../date-range-field/DATE-RANGE-FIELD.md)
- [../types.ts](../types.ts) — `SlotKey`, `PlannedPlace`, `TimeSlot`
