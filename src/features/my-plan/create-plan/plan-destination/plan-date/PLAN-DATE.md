# PlanDate

## Overview

Controlled calendar component for selecting a trip date range. Uses `react-native-calendars` in period-marking mode. First tap sets `start`; second tap (on or after start) sets `end`. Tapping a date earlier than the current start resets selection to a new single-day start. Dates before today are disabled.

## Props

```ts
type PlanDateProps = {
  range: DateRange;                          // { start: string | null; end: string | null }
  onRangeChange: (range: DateRange) => void;
};
```

`DateRange` is imported from the parent `CreatePlan` module.

## Behaviour

- One tap → start selected, end is `null` (single-day selection shown as a capsule).
- Second tap on a date ≥ start → full range highlighted.
- Tapping a date < current start → resets to a new single-day start.

## Related docs

- [PLAN-DESTINATION.md](../PLAN-DESTINATION.md) — parent step that renders this calendar
