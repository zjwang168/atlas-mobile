# MapPinCover

## Overview

Fallback cover for a place/plan thumbnail with no photo — a stylized map (muted background + faint road lines) with a pin centered on it. Used by `my-places/all-places/PlaceCard.tsx` and `my-plan/PlanCard.tsx`.

## Behaviour

Stateless. Absolutely fills its parent and clips its own content — the caller owns the thumbnail's outer size, corner radius, and shadow. Uses absolute positioning rather than `flex: 1` so it fills correctly regardless of the parent's own `alignItems`/`justifyContent` (a `flex: 1` child only stretches under the parent's default `alignItems: 'stretch'`).

## API

```ts
type MapPinCoverProps = {
  pinSize?: number;  // default: 28 — Ionicons "location" glyph size
};

export function MapPinCover(props: MapPinCoverProps): JSX.Element
```

## Related docs

- [../../features/my-places/all-places/ALL-PLACES.md](../../features/my-places/all-places/ALL-PLACES.md) — `PlaceCard`, one consumer
- [../../features/my-plan/MY-PLAN.md](../../features/my-plan/MY-PLAN.md) — `PlanCard`, the other consumer
