# Plan Detail Feature

## Overview

`PlanDetail` is a floating panel that renders the full schedule of a saved travel plan. It is triggered by `HomeContext.setOverlay({ kind: 'planDetail', planId })` and loads the plan from `savePlan.findSavedPlan()`.

## File Structure

```
src/features/plan-detail/
  PlanDetail.tsx                              ← panel container + PlanHeader
  PlanCompactView.tsx                         ← compact snap: title, location, action buttons
  plan-detail-sections/
    PlanScheduleSection.tsx                   ← flexible places + day-by-day schedule
  PLAN-DETAIL.md                              ← this document
```

---

## `PlanDetail`

### Props

```ts
type PlanDetailProps = {
  planId: string | null;   // null = hidden; non-null = slide up and load plan
  onDismiss: () => void;   // called after slide-out animation finishes
};
```

Changing `planId` from `null → string` triggers `findSavedPlan(planId)` and the enter animation. Changing back to `null` plays the exit animation then calls `onDismiss`.

### Snap States

| State | Content |
|---|---|
| `compact` | `PlanCompactView` — title, location, share / dismiss |
| `default` | `PlanHeader` + `PlanScheduleSection` in a `ScrollView` |
| `full` | Same as default, with `paddingTop: insets.top` |

---

## `PlanCompactView`

Shown when `ContentPanel` is at the `compact` snap. Tapping anywhere expands to `default`.

### Props

```ts
type PlanCompactViewProps = {
  plan: SavedPlan;
  onDismiss: () => void;
  onExpand: () => void;   // snaps to 'default'
};
```

---

## `PlanScheduleSection`

Renders the full content of a `SavedPlan`:

1. **Flexible places** — list of `freePlaces` with no time slot assignment.
2. **Day sections** — one section per `PlanDateSlot`, grouped by slot order: `morning → noon → afternoon → night`.

Each place row (`PlaceRow`) looks up the full `PlaceDetail` from `mockPlaceDetails` by `placeId` to show the address, summary excerpt, and links.

### Props

```ts
type PlanScheduleSectionProps = {
  plan: SavedPlan;
};
```

---

## Mock Data Seeding

`PlanDetail.tsx` calls `seedMockPlanDetails()` at module load time to populate the `savePlan` in-memory store with the plans from `mock-data/mockPlanDetails.ts`. Remove this call when real API persistence is wired.

---

## Data Model

All types below are **defined in `src/features/create-plan/savePlan.ts`** — import from there, do not re-declare:

```ts
import type { SavedPlan, PlanDateSlot } from '@/features/create-plan/savePlan';
import type { PlannedPlace, VisitSlot } from '@/features/create-plan/plan-place/types';
```

```ts
type SavedPlan = {
  id: string;
  title: string;
  location: string;
  dateRange: { start: string | null; end: string | null };
  placeCount: number;
  imageUrl?: string;
  freePlaces: PlannedPlace[];
  schedule: PlanDateSlot[];
};

type PlanDateSlot = {
  date: string;  // 'YYYY-MM-DD'
  slots: Partial<Record<VisitSlot, PlannedPlace[]>>;
};
```
