# PlaceCover

## Overview

Fallback cover for a place thumbnail with no photo — a category-coloured block with a matching glyph, used wherever a place or plan is shown as a card.

## Behaviour

Stateless. The category decides both the colour and the glyph: attraction, food, outdoors, shopping, lodging, or neutral when the category is absent or unrecognised. Colours come from the `category-*` tokens — see [THEME.md](../../theme/THEME.md).

Bucketing matches whole words, not substrings, because categories arrive as free text — Mapbox's `poi_category` on a search suggestion, the `category` column on a saved place — and substring matching turns "theater" into food and "barber" into a bar. The first bucket with a hit wins, so `coffee_shop` reads as food rather than shopping. `placeCategoryKey` is exported for callers that need the same bucketing for something other than a cover.

Absolutely fills its parent and clips its own content — the caller owns the thumbnail's outer size, corner radius, and shadow. Uses absolute positioning rather than `flex: 1` so it fills correctly regardless of the parent's own `alignItems`/`justifyContent` (a `flex: 1` child only stretches under the parent's default `alignItems: 'stretch'`).

## API

```ts
export type PlaceCategoryKey = 'attraction' | 'food' | 'outdoors' | 'shopping' | 'lodging' | 'neutral';

type PlaceCoverProps = {
  category?: string | null;  // free-text category; absent or unrecognised renders neutral
  iconSize?: number;         // default: 28 — glyph size
};

export function PlaceCover(props: PlaceCoverProps): JSX.Element
export function placeCategoryKey(category?: string | null): PlaceCategoryKey  // the bucketing on its own
```

## Related docs

- [THEME.md](../../theme/THEME.md) — the `category-*` tokens
- [../../features/my-places/all-places/ALL-PLACES.md](../../features/my-places/all-places/ALL-PLACES.md) — `PlaceCard` and the All Places tiles
- [../../features/discover/DISCOVER.md](../../features/discover/DISCOVER.md) — search suggestion cards
- [../../features/place-detail/PLACE.md](../../features/place-detail/PLACE.md) — the detail panel's hero thumbnail
- [../../features/add-place/ADD-PLACE.md](../../features/add-place/ADD-PLACE.md) — the picker's row thumbnails
- [../../features/my-plan/create-plan/CREATE-PLAN.md](../../features/my-plan/create-plan/CREATE-PLAN.md) — plan places, via `PlannedPlace.category`
- [../../features/my-plan/MY-PLAN.md](../../features/my-plan/MY-PLAN.md) — `PlanCard`, which has no category and always renders neutral
