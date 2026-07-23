# Add Place Feature

## Overview

`AddPlace` is a general-purpose full-height overlay panel that lets a user search and multi-select from their saved places; any feature can open it via `HomeContext.setOverlay({ kind: 'addPlace', onSelect })` and receive the selection through the `onSelect` callback.

## File Structure

```
src/features/add-place/
  AddPlace.tsx    ← panel component
  ADD-PLACE.md    ← this document
```

## Behaviour

- Renders inside `ContentPanel` with `zIndex={50}` (highest in the stack).
- Joins the `home-main` `ContentPanel` snap group (same as `HomePanel` and `PlaceDetail`) and forwards `onHeightChange`, so it gets the same settled-snap inheritance and map camera-padding treatment as the rest of the panel stack — see `HOME.md` Behaviour. `HomeScreen` owns wiring both; callers elsewhere don't pass these props themselves. Passes `minSnap="default"` since it has no `compactContent` — see `CONTENT-PANEL.md` Snap Groups for why a panel without one needs a floor.
- **Data source** — lists the caller's saved places (`useHome().savedPlaces`, offline-first local-cache-backed, see `LOCAL.md`), adapted to `PlaceDetail` via `toPlaceDetail()`. When `excludeIds` is passed, places whose id appears in it are hidden entirely rather than shown as disabled/pre-checked — callers that want duplicates selectable (e.g. the plan flow, where revisiting a place is valid) simply omit it.
- **Search** — filters by name/subtitle in real time.
- **Filter pills** — `Recommended`, `Best for Summer`, `Nearby`, `Not Yet Visited`. Toggle-to-deselect; currently cosmetic (actual filtering not wired).
- **Multi-select** — each row has a checkbox. Selection is tracked in local `Set<string>`.
- **Confirm button** — disabled when no places selected; label reads `"Add N Place(s)"`. On press, calls `onSelect` with the selected `PlaceDetail[]`.
- On both confirm and dismiss, `HomeScreen` restores `overlay` to the `addPlace` overlay's `returnTo` (falling back to `{ kind: 'none' }` if omitted) instead of always going to `none` — so confirming or cancelling returns the caller to whatever panel opened `AddPlace`, not to the home screen. Callers must pass their own current overlay state as `returnTo` (see Integration below).
- Panel state (`search`, `activeFilter`, `selected`) is reset via `ContentPanel.onHidden` after the slide-out animation completes.
- Empty saved-places list renders a "No saved places yet" placeholder row.

## API

```ts
type AddPlaceProps = {
  visible: boolean;                          // controls slide-in / slide-out animation
  onDismiss: () => void;                     // user tapped close without confirming
  onSelect: (places: PlaceDetail[]) => void; // user confirmed; receives selected places
  snapGroup?: string;                        // ContentPanel snap group; HomeScreen passes 'home-main'
  onHeightChange?: (height: number) => void; // forwarded to ContentPanel for map camera padding
  excludeIds?: string[];                     // place ids to hide from the picker; omit to show every saved place
};
```

## Integration via HomeContext

This is the only correct way to open `AddPlace`:

```ts
const { setOverlay } = useHome();

setOverlay({
  kind: 'addPlace',
  returnTo: { kind: 'atlasDetail', atlasId },  // whatever overlay state got the user here
  onSelect: (places) => {
    // places: PlaceDetail[] — adapt to whatever shape the caller needs.
    // Don't call setOverlay here — HomeScreen restores `returnTo` automatically.
  },
});
```

`HomeScreen` owns the `<AddPlace>` instance and wires `onSelect` → `overlay.onSelect(places)` + `setOverlay(overlay.returnTo ?? { kind: 'none' })` automatically, on both confirm and dismiss. Callers that need a different shape (e.g. `my-plan`'s `PlannedPlace`) convert the returned `PlaceDetail[]` themselves — see `PlanPlace.tsx` for an example that maps into `newPlannedPlace()`, or `AtlasDetail.tsx` for an example that passes the selected place ids straight into `addPlacesToAtlas()`. Omitting `returnTo` lands back on the home screen (`{ kind: 'none' }`) instead of the caller's panel — always pass it unless that's the desired behavior.

## Related docs

- [HOME.md](../home/HOME.md) — `Overlay` union and `setOverlay` contract
- [SERVICES.md](../../services/SERVICES.md) — `placeService.toPlaceDetail()` / `fetchSavedPlaces()`
- [LOCAL.md](../../services/local/LOCAL.md) — offline-first local cache backing `savedPlaces`
