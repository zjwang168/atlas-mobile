# AllPlaces

## Overview

"My Places" tab content: a scrollable, swipeable list of the user's saved places, backed by Supabase.

## Behaviour

### Status

- Loading: spinner while `placeService.fetchSavedPlaces()` resolves (newest first).
- Empty: placeholder message when there are no saved places.
- Refreshing: pull-to-refresh re-fetches and resets pagination.

Each row is rendered by this directory's own `PlaceCard` (`PlaceCard.tsx`) — a single memoized component (name, description, thumbnail, tags, swipe-to-delete all in one file). `AtlasDetail` (`../atlas/atlas-detail/AtlasDetail.tsx`) also renders this same `PlaceCard` for its place list, so it's no longer AllPlaces-exclusive despite living in this directory. Tapping a card's text area only notifies the parent (`onPlacePress`) to select and focus that place on the map. Tapping its thumbnail opens the saved-place detail; the thumbnail has a forward-chevron indicator to make that action visible.

The row is wrapped in `ReanimatedSwipeable` (`react-native-gesture-handler`): swiping left reveals a circular delete button fixed at the right edge behind the card (it does not translate with the drag — the card slides over it). There's no open/closed state — the button's scale and opacity track swipe progress directly. Swiping past the button's width rubber-bands and eases back into place on release, like scroll-edge bounce. Tapping the button closes the swipeable and calls `onDelete`.

The tags row is rendered as its own horizontally-scrollable row below the swipeable, outside it — so it never moves during the delete-swipe gesture and can grow to hold any number of tags without affecting the swipeable card's layout.

Rows are adapted from DB shape (`SavedPlace`) to `PlaceDetail` via `toPlaceDetail()`; fields not yet persisted (schedule, visitStrategy, …) get sensible defaults, and the thumbnail falls back to `PlaceCover` (`@/components/place-cover/PlaceCover` — a category-coloured block, not a real Mapbox static image) when there's no real photo.

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
