# Discover

## Overview

The second mode of the places bottom sheet — a browsable list of nearby places, sitting beside My Places under the `TopNav` Saved/Discover switch.

## Behaviour

The list is sample data, not a live feed. Nothing here reaches a service yet; the three filter menus (sort, category, trending) sort and filter that fixed set in place.

The search row is a **button, not a text input**. Tapping it calls `onSearchPress`, which `HomeScreen` routes to the `search` overlay — `SearchPanel` is what actually reaches Mapbox. Discover has no search field of its own, so nothing typed here filters the list.

The bottom sheet keeps both mode panes mounted and hides the inactive one rather than unmounting it, so `active` — not mount state — is what tells Discover whether it is the pane the user can see. The search hand-off is gated on it.

## API

```ts
type DiscoverProps = {
  bottomInset?: number;              // default: 0 — extra list padding to clear the sheet's bottom bar
  onScroll?: (y: number) => void;    // vertical offset, for the host sheet
  verticalScrollEnabled?: boolean;   // default: true — hosts disable it at the shorter sheet detents
  active?: boolean;                  // default: true — whether this pane is the visible one
  onSearchPress?: () => void;        // tap on the search row; opens SearchPanel via HomeScreen
};
```

## Related docs

- [SEARCH.md](../search/SEARCH.md) — `SearchPanel`, the Mapbox-backed search this hands off to
- [HOME.md](../home/HOME.md) — owns the `search` overlay and passes `onSearchPress` down through `HomePanel`
- [MY-PLACES.md](../my-places/MY-PLACES.md) — the other pane of the same sheet
