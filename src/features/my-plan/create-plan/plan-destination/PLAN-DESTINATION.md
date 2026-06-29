# PlanDestination

## Overview

Step 1 of the CreatePlan wizard. Collects a destination name (free-text) and a date range, then advances to the next step via `onNext`. Does not persist state — the parent (`CreatePlan`) owns location and range.

## File Structure

```
src/features/my-plan/create-plan/plan-destination/
  PlanDestination.tsx       ← wizard step 1 container
  plan-date/                ← calendar date-range picker
  plan-location/            ← destination text input
  PLAN-DESTINATION.md       ← this document
```

## Props

```ts
type PlanDestinationProps = {
  onNext: () => void;
  bottomInset?: number;         // default: 0 — safe-area inset for the CTA button
  location: string;
  onLocationChange: (value: string) => void;
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
};
```

## Related docs

- [CREATE-PLAN.md](../CREATE-PLAN.md) — parent wizard that owns location/range state
- [PLAN-DATE.md](plan-date/PLAN-DATE.md) — date-range calendar
- [PLAN-LOCATION.md](plan-location/PLAN-LOCATION.md) — destination input
