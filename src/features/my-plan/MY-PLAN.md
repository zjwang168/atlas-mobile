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
  /** ContentPanel's imperative snap function, threaded down from HomePanel — called
      directly so the panel-height animation starts in the same tick as the content
      cross-fade rather than behind a state/prop round trip */
  snapTo?: (state: SnapState, animated?: boolean) => void;
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

Activated when the user taps the "Create a plan" card. The grid and the `CreatePlan` wizard are both permanently mounted as overlapping absolute-positioned layers (mirroring `ContentPanel`'s own compact/default crossfade), each with its own opacity, so there's never an unmount/remount at the swap point. The transition is a strict timeline rather than a simultaneous crossfade: 160ms fade out → 60ms pause → content swap (+ `CreatePlan`'s `reset()` imperative handle, since it no longer remounts to pick up a fresh mount-effect reset) → 60ms pause → 160ms fade in.

The panel-height change (`snapTo('full')` / `snapTo('default')`) is called directly and synchronously alongside the fade — not via a state prop into `ContentPanel` — so both animations start in the same tick instead of the height change lagging a render behind. They still run on independent timelines (fixed 160ms fade vs. `ContentPanel`'s spring, whose settle time depends on distance) and aren't synchronized to finish together.

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
