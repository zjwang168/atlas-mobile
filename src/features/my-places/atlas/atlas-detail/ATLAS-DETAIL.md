# AtlasDetail

## Overview

A `ContentPanel` overlay — modeled on `PlaceDetail` (`../../../place-detail/PlaceDetail.tsx`) — that lists every place inside one atlas.

## Behaviour

`HomeScreen` mounts a single always-present instance and drives it from `HomeContext`'s `atlasDetail` overlay kind, the same pattern as `PlaceDetail`/`PlanDetail`.

### Status

- **Hidden**: `atlasId` is `null` — panel slides out.
- **Shown**: looks the atlas up in `useHome().atlases`. Header shows the atlas emoji + title with a dismiss button; compact snap shows a condensed row (emoji + title + dismiss). `AtlasHeader` sits outside/above the list, fixed; `AtlasOverviewSection.tsx` (this directory) is passed as the list's `ListHeaderComponent`, so it scrolls away with the rest of the content instead of staying pinned — showing a place count + description on the left with add/delete/share/edit/more action buttons, and the atlas emoji in a square (in place of a thumbnail) on the right. Add and delete are wired; share/edit/more are still no-ops.

The delete button (`trash-outline`, between edit and more) shows a native `Alert.alert` confirm ("Delete Atlas" / Cancel + destructive-styled Delete). The message states the current place count and clarifies those places stay in My Places and only lose their grouping in this atlas — deleting an atlas never deletes the underlying saved places. Confirming calls `useHome().deleteAtlas(atlasId)` and immediately dismisses the overlay (`setOverlay({ kind: 'none' })`) — there's no panel left to return to once the atlas is gone, so this doesn't go through the `returnTo` mechanism the way opening a sub-panel does.

The place list mirrors `AllPlaces`' `FlatList` layout: same row `ItemSeparator` divider, same `ListEmptyComponent` styling ("No places in this atlas yet."), memoized `renderItem`/`keyExtractor`, and `onScroll` wired to `reportScrollY` for `ContentPanel` drag-gesture coordination. `ListHeaderComponent` always renders (even when the list is empty), so the overview section stays visible above the empty-state message.

The place list is backed by `atlas_places`, sourced from `useHome().atlasPlaces` (loaded once for every atlas by `HomeContext`, same as `savedPlaces`/`atlases` — see `HOME.md`). `AtlasDetail` filters to the current `atlasId`, sorts by `sort_order`, and resolves each `place_id` against `useHome().savedPlaces` via `toPlaceDetail()` — rows whose place isn't in `savedPlaces` (e.g. deleted) are dropped. `PlaceCard` (`../../all-places/PlaceCard.tsx`) `onDelete` calls `useHome().removePlaceFromAtlas(joinRowId)`, which deletes only the `atlas_places` join row — the saved place itself, and its membership in other atlases, is untouched. Tapping a row opens `PlaceDetail` with `returnTo: { kind: 'atlasDetail', atlasId }` (`PlaceCard` captures the current overlay automatically, see `ALL-PLACES.md`/`PLACE.md`), so closing it returns to this atlas rather than the home screen.

The overview section's add button opens the shared `AddPlace` overlay (`useHome().setOverlay({ kind: 'addPlace', onSelect, excludeIds, returnTo: { kind: 'atlasDetail', atlasId } })`, see `ADD-PLACE.md`) with `excludeIds` set to the place ids already in this atlas, so the picker hides places that would just no-op; the selection is added via `useHome().addPlacesToAtlas(atlasId, placeIds)`, which writes local-first (optimistic `atlas_places` rows, visible immediately) and syncs to Supabase, queued for retry like the rest of the offline-first services (`SERVICES.md`, `LOCAL.md`). Both `addPlacesToAtlas` and `removePlaceFromAtlas` surface an `Alert` on failure (see `HOME.md`). `returnTo` sends the user back to this same atlas (rather than the home screen) on confirm or dismiss — `AtlasDetail` itself doesn't need to do anything special for this since it's already an always-mounted instance whose visibility just follows `atlasId` going non-null again.

## API

```ts
type AtlasDetailProps = {
  atlasId: string | null;         // null = hidden; non-null = slide up and show
  onDismiss: () => void;
  onHeightChange?: (height: number) => void;  // reports live panel height, same as PlaceDetail
};
```

`AtlasOverviewSection.tsx` (this directory) takes `{ atlas: Atlas; placeCount: number; onAddPress?: () => void; onDeletePress?: () => void }` and has no other exports.

## Related docs

- [ATLAS.md](../ATLAS.md) — parent feature; renders `AtlasCard`, which opens this overlay
- [MY-PLACES.md](../../MY-PLACES.md) — top-level feature that renders the atlas tab
- [ADD-PLACE.md](../../../add-place/ADD-PLACE.md) — shared overlay opened by the add button
