# Discover

## Overview

The second mode of the places bottom sheet — a browsable list of nearby places plus the app's live place search, sitting beside My Places under the `TopNav` Saved/Discover switch.

## Behaviour

### Status

Two modes, decided by whether the search field has any text in it:

- **browse** — the sample list. It is fixed sample data, not a live feed; the three filter menus sort and filter that fixed set in place.
- **search** — real Mapbox results from `usePlaceSearch`. The filter menus are hidden, because a suggestion carries no rating and no trending flag for them to act on, and results already arrive weighted by proximity.

The first typed character switches modes even though it is shorter than the backend accepts, because leaving the sample list on screen under a half-typed query reads as a result.

Tapping a suggestion resolves and saves it, and the row settles into saved or already-in-My-Places. Results that are already saved are marked before any tap, but only when the saved copy carries the same provider id — see [SERVICES.md](../../services/SERVICES.md). A place saved from a link import has no provider id, so it will not be pre-marked; the tap still reports it correctly, because the save path dedups on more than the id.

The sheet keeps both mode panes mounted and hides the inactive one rather than unmounting it, so `active` — not mount state — is what tells Discover whether the user can see it. Going inactive clears the query and results and starts a new billed search session, which nothing else would do for a pane that never unmounts.

## API

```ts
type DiscoverProps = {
  bottomInset?: number;              // default: 0 — extra list padding to clear the sheet's bottom bar
  onScroll?: (y: number) => void;    // vertical offset, for the host sheet
  verticalScrollEnabled?: boolean;   // default: true — hosts disable it at the shorter sheet detents
  active?: boolean;                  // default: true — whether this pane is the visible one
  onSearchPress?: () => void;        // not rendered; kept plumbed as the revert path to SearchPanel
};
```

## Related docs

- [SERVICES.md](../../services/SERVICES.md) — `usePlaceSearch`, which owns the search behaviour described above
- [SAVE-AFFORDANCE.md](../../components/save-affordance/SAVE-AFFORDANCE.md) — the trailing indicator on a suggestion card
- [SEARCH.md](../search/SEARCH.md) — `SearchPanel`, the same search as a full-screen overlay
- [HOME.md](../home/HOME.md) — passes `onSearchPress` down through `HomePanel`
