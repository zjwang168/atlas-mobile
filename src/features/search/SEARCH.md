# Search

## Overview

`SearchPanel` is the full-screen version of place search — it finds places by name and saves the ones the user picks straight into My Places.

> Nothing opens it right now: Discover searches inline instead, and this panel is kept as the revert path if that has to be backed out. `HomeScreen` still renders the `search` overlay and still holds `handleSearchPress`; only the caller is missing.

## Behaviour

Typing is debounced, and each settled query cancels whatever the previous one started so a slower earlier response cannot land on top of a newer one. Queries shorter than `MIN_QUERY_LENGTH` never leave the device.

One search session token is created when the panel mounts and reused for every suggestion request and the final resolve, then discarded when the panel closes — Mapbox bills the session rather than the keystrokes, so reopening the panel is what starts a new one.

Suggestions carry no coordinates. Picking a row resolves it into a full place, saves it through `savePlaces()`, and refreshes My Places; several places can be added without leaving the panel. A failed save is logged and the row returns to its unsaved state rather than blocking the panel.

A picked row settles into one of two resting states, because a save that creates nothing is not the same as one that does: newly saved, or already in My Places when the place matched something already there. Both stop further taps on that row.

A row can also start out in the already-saved state, before any tap, when the place is already in My Places. That check runs on the provider id alone — suggestions have no coordinates for the fuzzy half of place identity — so it misses saved places that carry no id, which is every place saved from a link import. It only ever adds the marking; the save path still decides on tap.

Only `poi` results appear — see [SERVICES.md](../../services/SERVICES.md) for why brands are filtered out and why more results are requested than displayed.

Results are attributed to Mapbox/OpenStreetMap beneath the list, which the provider's terms require wherever they are displayed.

### Status

- **idle** — query too short; shows a prompt.
- **searching** — a request is in flight; spinner in the input.
- **ready** — results rendered, or a "no places found" message.
- **error** — the request failed; the list is cleared and a retry message shown.

## API

```ts
type SearchPanelProps = {
  onClose: () => void;   // dismiss; HomeScreen resets the overlay to 'none'
};
```

## Related docs

- [HOME.md](../home/HOME.md) — owns the `search` overlay kind that renders this panel
- [SERVICES.md](../../services/SERVICES.md) — `usePlaceSearch`, which owns everything on this page except the layout, plus the `placeSearchService` filtering rules behind it
- [DISCOVER.md](../discover/DISCOVER.md) — the search row that opens this panel
- [PLACE-SEARCH-SERVICE.md](../../../backend/services/place_search_service/PLACE-SEARCH-SERVICE.md) — the backend side
