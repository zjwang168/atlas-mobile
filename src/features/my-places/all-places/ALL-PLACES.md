# AllPlaces

## Overview

"My Places" tab content showing the user's saved places as a scrollable `PlaceCard` list. Currently backed by mock data. Notifies the parent when a place row is tapped so the parent can open `PlaceDetail`.

## Props

```ts
type AllPlacesProps = {
  onPlacePress?: (place: PlaceDetail) => void;
  bottomInset?: number;  // default: 0 — extra bottom padding for safe area
};
```

## Related docs

- [MY-PLACES.md](../MY-PLACES.md) — parent feature that renders this tab
- [PLACE-CARD.md](../../../components/place-card/PLACE-CARD.md) — list row component used here
