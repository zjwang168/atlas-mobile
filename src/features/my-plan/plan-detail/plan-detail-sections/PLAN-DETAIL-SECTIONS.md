# plan-detail-sections

## Overview

Section components that compose the `PlanDetail` overlay. Currently contains a single section; more sections will live here as the detail view grows.

## File Structure

```
src/features/my-plan/plan-detail/plan-detail-sections/
  PlanScheduleSection.tsx    ← day-by-day schedule with place rows
  PLAN-DETAIL-SECTIONS.md   ← this document
```

## PlanScheduleSection

Renders the full trip schedule from a `SavedPlan`: flexible ("free") places first, then day sections in chronological order. Each day section groups places by visit slot (morning / noon / afternoon / night). Place rows show name, address or subtitle, a 3-line summary, and a tappable "Links ›" entry when links exist.

Place details (address, summary, links) are resolved from mock data by `placeId` — not from the `PlannedPlace` record itself.

```ts
type PlanScheduleSectionProps = {
  plan: SavedPlan;
};
```

## Related docs

- [PLAN-DETAIL.md](../PLAN-DETAIL.md) — parent overlay that renders this section
- [../create-plan/savePlan.ts](../../create-plan/savePlan.ts) — `SavedPlan`, `PlanDateSlot` types
