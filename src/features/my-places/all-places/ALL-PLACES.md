# AllPlaces

## Overview

"My Places" tab content: a scrollable, swipeable list of the user's saved places, backed by Supabase.

## Behaviour

### Status

- Loading: spinner while `placeService.fetchSavedPlaces()` resolves (newest first).
- Empty: placeholder message when there are no saved places.
- Refreshing: pull-to-refresh re-fetches and resets pagination.

Rows are rendered by components defined inside `AllPlaces.tsx` itself: `SavedPlaceListItem` for the full places list (thumbnail, name, two-line description, and up to two `PlaceTagChip`s), `PlaceTile` for the home sheet's horizontal card strip, and `AtlasRow` for the atlas list. Tapping any of them notifies the parent (`onPlacePress` / `onAtlasPress`).

> **`PlaceCard.tsx` in this directory is unused** — nothing imports it. It is an older row shape (thumbnail on the right, a Google Maps shortcut, swipe-to-delete) kept around but not on screen. Do not treat it as the saved-place row when styling this feature.

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
