# PlanCard Component

## Overview

A square grid card representing a single travel plan. Renders either a normal plan card (thumbnail + title + place count) or a special "Create a plan" empty-state card. Used in `MyPlan`'s two-column `FlatList`.

## Files

```
src/components/plan-card/
  PlanCard.tsx       ← card component
  usePlanDelete.ts   ← plan list state + deletion hook
```

---

## `PlanCard`

### Props

```ts
type PlanCardProps = {
  title: string;
  placeCount: number;
  imageUrl?: string;        // shown in the square thumbnail; grey placeholder when absent
  create?: boolean;         // renders the dashed-border "+" empty state instead
  deletionMode?: boolean;   // shows a close badge in the top-right corner
  onPress?: () => void;
  onDeletePress?: () => void; // called when the delete badge is tapped
};
```

### Modes

| `create` | `deletionMode` | Appearance |
|---|---|---|
| `false` | `false` | Thumbnail + title + place count |
| `false` | `true` | + delete badge overlay on the thumbnail |
| `true` | any | Dashed border + `+` icon, no delete badge |

---

## `usePlanDelete`

Hook that manages the plan list, edit mode toggle, and delete confirmation. Used exclusively by `MyPlan`.

### Returns

```ts
{
  plans: MockPlan[];           // current plan list (mirrors mockPlans)
  editMode: boolean;           // whether deletion badges are visible
  toggleEditMode: () => void;  // switch between view/edit mode
  requestDelete: (id: string) => void; // shows Alert; removes on confirm
  addPlan: (plan: MockPlan) => void;   // prepend a newly created plan
}
```

### `MockPlan` type

```ts
type MockPlan = {
  id: string;
  title: string;
  placeCount: number;
  imageUrl?: string;
};
```

> **Side-effect warning** — `requestDelete` mutates the `mockPlans` module-level array directly (`mockPlans.splice(idx, 1)`) in addition to updating local state. This keeps other components that read `mockPlans` in sync, but is a global mutation. When replacing mock data with real state (API / context), remove the `mockPlans.splice` call and update the shared store instead.
