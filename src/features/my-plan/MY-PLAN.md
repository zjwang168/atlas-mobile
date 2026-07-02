# My Plan Feature

## Overview

`MyPlan` is the second tab of the home content panel. It shows the user's saved travel plans in a two-column grid and hosts the Create Plan wizard inline. Tapping a plan card opens the `PlanDetail` overlay via `HomeContext`.

## File Structure

```
src/features/my-plan/
  MyPlan.tsx      ← root component rendered inside HomePanel
  MY-PLAN.md      ← this document
```

## Props

```ts
type MyPlanProps = {
  onAvatarPress?: () => void;
  onScroll?: (y: number) => void;        // scroll Y reported to ContentPanel for gesture coordination
  bottomInset?: number;                  // safe-area + bottom-bar clearance for scroll padding
  /** Renders a condensed header only — used when the panel is in compact snap state */
  compact?: boolean;
  /** Called when create-plan mode is entered or exited, so the parent can adjust panel height */
  onCreateModeChange?: (active: boolean) => void;
};
```

## Modes

### Grid mode (default)

- Two-column `FlatList` of `PlanCard` items.
- First item is always the "Create a plan" card (`create` prop on `PlanCard`).
- Edit mode (`toggleEditMode`) shows a delete badge on each plan card.
- Deletion triggers `usePlanDelete.requestDelete()` which shows a confirmation alert.
- Tapping a real plan card calls `setOverlay({ kind: 'planDetail', planId })`.

### Create mode

Activated when the user taps the "Create a plan" card. The grid is replaced by the `CreatePlan` wizard inline (no new screen push). `onCreateModeChange(true)` is emitted so `HomePanel` can expand the panel to `PANEL_HEIGHT.createPlan`.

On `onPlanCreated`:
1. The new plan is prepended to the grid via `usePlanDelete.addPlan()`.
2. Create mode is dismissed.
3. `PlanDetail` overlay is opened immediately for the new plan.

### Compact mode

When `compact={true}`, renders only a two-element header row (title + avatar). Used by `ContentPanel`'s compact snap state in `HomePanel`.

## Related Docs

When working on `MyPlan`, these docs cover the two major flows it hosts inline:

- **Create Plan wizard** → `src/features/my-plan/create-plan/CREATE-PLAN.md`
- **Plan Detail overlay** → `src/features/my-plan/plan-detail/PLAN-DETAIL.md`
- **Add Place to Plan overlay** → `src/features/my-plan/add-place-to-plan/ADD-PLACE-TO-PLAN.md`

## Dependencies

| Import | Purpose |
|---|---|
| `usePlanDelete` | Plan list state, edit mode, deletion, add |
| `CreatePlan` | Inline wizard |
| `useHome` | Open `PlanDetail` overlay |
| `mockPlans` | Initial plan data (replace with API) |
