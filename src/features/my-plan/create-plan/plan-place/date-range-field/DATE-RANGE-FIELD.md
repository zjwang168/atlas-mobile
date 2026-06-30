# date-range-field

## Overview

Renders one `DateColumn` per date in the plan's date range. Each column shows four time-slot sections (Morning / Noon / Afternoon / Night), each acting as an independent DnD drop zone for `PlannedPlace` cards. In compact mode (column height < 160 px) slots are laid out side by side with vertical dividers; in tall mode they stack vertically with horizontal dividers.

## File Structure

```
plan-place/date-range-field/
  DateRangeField.tsx    ← horizontal FlatList of DateColumn; top-level entry point
  DateColumn.tsx        ← per-date component; header + bordered slot container
  DATE-RANGE-FIELD.md   ← this document
```

## Props

### DateRangeField

```ts
type DateRangeFieldProps = {
  range: DateRange;
  byDate: Record<string, PlannedPlace[]>;          // all places for the date; each has timeSlot set
  onAdd: (date: string, timeSlot: TimeSlot) => void;
  onRemove: (date: string, id: string) => void;
};
```

### DateColumn

```ts
type DateColumnProps = {
  date: string;
  places: PlannedPlace[];
  onAdd: (timeSlot: TimeSlot) => void;
  onRemove: (id: string) => void;
};
```

## Behaviour

### Time slots

Each date is divided into four named slots:

| Slot        | Label      |
|-------------|------------|
| `morning`   | Morning    |
| `noon`      | Noon       |
| `afternoon` | Afternoon  |
| `night`     | Night      |

Places are filtered into their slot using `place.timeSlot`.

### View switching

`DateColumn` measures its own layout height via `onLayout`. While height is `null` (first frame), nothing is rendered. Above `COMPACT_THRESHOLD = 160 px`, the vertical layout is used (slots stacked); below it, the horizontal layout (slots side by side).

### Drop zones

Each `SlotSection` inside `DateColumn` registers a `{ kind: 'dated'; date; timeSlot }` drop zone with `DndProvider`. It highlights with a green background (`#e9fbf1`) when a card hovers over it.

## Related docs

- [../add-place-field/ADD-PLACE-FIELD.md](../add-place-field/ADD-PLACE-FIELD.md) — shared card list used inside each slot
- [../flexible-place-field/FLEXIBLE-PLACE-FIELD.md](../flexible-place-field/FLEXIBLE-PLACE-FIELD.md) — free pool
- [../dnd/DND.md](../dnd/DND.md) — DnD system
