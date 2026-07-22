# AtlasDetail

## Overview

A `ContentPanel` overlay — modeled on `PlaceDetail` (`../../../place-detail/PlaceDetail.tsx`) — that lists every place inside one atlas.

## Behaviour

`HomeScreen` mounts a single always-present instance and drives it from `HomeContext`'s `atlasDetail` overlay kind, the same pattern as `PlaceDetail`/`PlanDetail`.

### Status

- **Hidden**: `atlasId` is `null` — panel slides out.
- **Shown**: looks the atlas up in `useHome().atlases`. Header shows the atlas emoji + title with a dismiss button, matching `PlaceDetail`'s `PlaceHeader`; compact snap shows a condensed row (emoji + title + dismiss), matching `PlaceCompactView`. `AtlasHeader` sits outside/above the list, fixed; `AtlasOverviewSection.tsx` (this directory) is passed as the list's `ListHeaderComponent`, so it scrolls away with the rest of the content instead of staying pinned — modeled on `PlaceOverviewSection`, showing a place count + description on the left with share/edit/more action buttons, and the atlas emoji in a square (in place of a thumbnail) on the right. Neither the atlas action buttons nor place count are wired to real behavior yet.

The place list mirrors `AllPlaces`' `FlatList` layout: same row `ItemSeparator` divider, same `ListEmptyComponent` styling ("No places in this atlas yet."), memoized `renderItem`/`keyExtractor`, and `onScroll` wired to `reportScrollY` for `ContentPanel` drag-gesture coordination. `ListHeaderComponent` always renders (even when the list is empty), so the overview section stays visible above the empty-state message.

There's no real `atlas_places` join wired up yet, so every atlas — new or old — always renders with an empty place list (`ListEmptyComponent` always shows). `PlaceCard` (`../../all-places/PlaceCard.tsx`) and `HomeContext.deleteSavedPlace` wiring are already in place for when that join lands.

## API

```ts
type AtlasDetailProps = {
  atlasId: string | null;         // null = hidden; non-null = slide up and show
  onDismiss: () => void;
  onHeightChange?: (height: number) => void;  // reports live panel height, same as PlaceDetail
};
```

`AtlasOverviewSection.tsx` (this directory) takes `{ atlas: Atlas; placeCount: number }` and has no other exports.

## Related docs

- [ATLAS.md](../ATLAS.md) — parent feature; renders `AtlasCard`, which opens this overlay
- [MY-PLACES.md](../../MY-PLACES.md) — top-level feature that renders the atlas tab
