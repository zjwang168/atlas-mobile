# AllPlaces

## Overview

"My Places" tab content: a scrollable, swipeable list of the user's saved places, backed by Supabase.

## Behaviour

### Status

- Loading: spinner while `placeService.fetchSavedPlaces()` resolves (newest first).
- Empty: placeholder message when there are no saved places.
- Refreshing: pull-to-refresh re-fetches and resets pagination.

Each row is rendered by this directory's own `PlaceCard` (`PlaceCard.tsx`) — a single memoized component (name, description, thumbnail, tags, swipe-to-delete all in one file; no longer split across a shared base component, since it had no other consumers). Tapping the card body notifies the parent (`onPlacePress`), which selects the place on the map; it's a one-shot trigger, not a toggle — the row has no selected/active visual state. Tapping the title + chevron does both: it still fires `onPlacePress` (selecting the place on the map, same as tapping the rest of the card), then also opens `PlaceDetail` via `useHome().setOverlay({ kind: 'placeDetail', placeId })` called directly from `PlaceCard`.

The row is wrapped in `ReanimatedSwipeable` (`react-native-gesture-handler`): swiping left reveals a circular delete button fixed at the right edge behind the card (it does not translate with the drag — the card slides over it). There's no open/closed state — the button's scale and opacity track swipe progress directly. Swiping past the button's width rubber-bands and eases back into place on release, like scroll-edge bounce. Tapping the button closes the swipeable and calls `onDelete`.

The tags row is rendered as its own horizontally-scrollable row below the swipeable, outside it — so it never moves during the delete-swipe gesture and can grow to hold any number of tags without affecting the swipeable card's layout.

Rows are adapted from DB shape (`SavedPlace`) to `PlaceDetail` via `toPlaceDetail()`; fields not yet persisted (schedule, visitStrategy, …) get sensible defaults, and the thumbnail falls back to a Mapbox static-map pin when there's no real photo.

## API

```ts
type AllPlacesProps = {
  onPlacePress?: (place: PlaceDetail) => void;
  bottomInset?: number;   // default: 0 — extra bottom padding for safe area
  onScroll?: (y: number) => void; // reports scroll offset so the panel can gate its drag gesture
};
```

## Data flow

Save side: `SaveScreen` → `App.tsx onSave` → `placeService.savePlaces()` → Supabase `places` (+ `place_sources` provenance).
Read side: this component → `placeService.fetchSavedPlaces()` → Supabase `places`.

## Related docs

- [MY-PLACES.md](../MY-PLACES.md) — parent feature that renders this tab