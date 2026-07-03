# AllPlaces

## Overview

"My Places" tab content showing the user's saved places as a scrollable `PlaceCard` list. Backed by Supabase: rows are read from the `places` table via `placeService.fetchSavedPlaces()` (newest first), with a loading spinner, an empty state, and pull-to-refresh. Each row shows a Mapbox static-map thumbnail centered on the place (placeholder until real photos land). Notifies the parent when a place row is tapped so the parent can open `PlaceDetail`.

Rows are adapted from DB shape (`SavedPlace`) to `PlaceDetail` in `toPlaceDetail()`; fields we don't persist yet (schedule, visitStrategy, …) get sensible defaults.

## Props

```ts
type AllPlacesProps = {
  onPlacePress?: (place: PlaceDetail) => void;
  bottomInset?: number;   // default: 0 — extra bottom padding for safe area
  listHeader?: ReactNode; // rendered at the top of the scroll content (e.g. segmented control)
  onScroll?: (y: number) => void; // reports scroll offset so the panel can gate its drag gesture
};
```

## Data flow

Save side: `SaveScreen` → `App.tsx onSave` → `placeService.savePlaces()` → Supabase `places` (+ `place_sources` provenance).
Read side: this component → `placeService.fetchSavedPlaces()` → Supabase `places`.

## Related docs

- [MY-PLACES.md](../MY-PLACES.md) — parent feature that renders this tab
- [PLACE-CARD.md](../../../components/place-card/PLACE-CARD.md) — list row component used here