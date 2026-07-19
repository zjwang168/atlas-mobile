# Atlas

## Overview

The "Atlas" sub-tab in the MyPlaces panel — a scrollable row of category filter pills (with a list-view icon pinned to its right edge) above curated atlas cards (emoji on top, title below) laid out three per row, wrapping to additional rows.

## Behaviour

### Status

- **Empty**: `mockAtlases` is empty — shows the placeholder message "Your curated atlas will appear here."
- **Populated**: a `CategoryPillsRow` (this file) — a static, horizontally scrolling row of category `Badge` pills (`CATEGORY_PILLS`, `All` shown pressed/selected with a filled primary background) with a fixed `list-outline` icon pinned to the right, outside the scroll area — pinned above the card grid so it does not scroll with the rest of the content, unlike the `AtlasCard` (`AtlasCard.tsx`) grid below it, which scrolls independently in its own `ScrollView` (one card per entry in `mock-data/mockAtlases.ts`'s `mockAtlases`, wrapping three per row). Neither the pills nor the list icon are wired to any filtering/view-toggle behavior yet. `AtlasCard` is a small memoized component rendering `Atlas.emoji` centered in a square with `Atlas.title` below it; tapping it calls `useHome().setOverlay({ kind: 'atlasDetail', atlasId })` to open `AtlasDetail`.

The atlas cards themselves (`mockAtlases`) are a static fixture, not a service or `HomeContext`, so the tab renders without any auth/session/fetch dependency. Their place lists are not — see `AtlasDetail` below.

`AtlasPlaceCard.tsx` (square thumbnail + place name) exists in this directory but is not rendered by `Atlas.tsx` — `AtlasDetail.tsx` renders its own row layout instead (see below).

No props.

## `AtlasDetail`

A `ContentPanel` overlay — modeled on `PlaceDetail` (`../../place-detail/PlaceDetail.tsx`) — that lists every place inside one atlas. `HomeScreen` mounts a single always-present instance and drives it from `HomeContext`'s `atlasDetail` overlay kind, the same pattern as `PlaceDetail`/`PlanDetail`.

### Status

- **Hidden**: `atlasId` is `null` — panel slides out.
- **Shown**: looks the atlas up in `mock-data/mockAtlases.ts`'s `mockAtlases`. Header shows the atlas emoji + title with a dismiss button, matching `PlaceDetail`'s `PlaceHeader`; compact snap shows a condensed row (emoji + title + dismiss), matching `PlaceCompactView`. `AtlasHeader` sits outside/above the list, fixed; `AtlasOverviewSection.tsx` (this directory) is passed as the list's `ListHeaderComponent`, so it scrolls away with the rest of the content instead of staying pinned — modeled on `PlaceOverviewSection`, showing a place count + description on the left with share/edit/more action buttons, and the atlas emoji in a square (in place of a thumbnail) on the right. Neither the atlas action buttons nor place count are wired to real behavior yet.

The place list mirrors `AllPlaces`' `FlatList` layout: same row `ItemSeparator` divider, same `ListEmptyComponent` styling ("No places in this atlas yet." in place of `AllPlaces`' empty copy), memoized `renderItem`/`keyExtractor`, and `onScroll` wired to `reportScrollY` for `ContentPanel` drag-gesture coordination. Unlike `AllPlaces` there's no pagination/pull-to-refresh (`AllPlaces`' `PAGE_SIZE` paging and `onRefresh` — not needed since an atlas's place count is small and static). `ListHeaderComponent` always renders (even when the list is empty), so the overview section stays visible above the empty-state message.

There's no real `atlas_places` join yet, so each atlas's places aren't fabricated records — `mockAtlasPlaceCounts` (`mock-data/mockAtlases.ts`) says how many places each mock atlas should show, and `AtlasDetail` fills that count with a non-overlapping slice of `HomeContext.savedPlaces` (the current local cache), offset per atlas and wrapping via modulo when there aren't enough saved places to go around. Every row is therefore always a real, resolvable saved place — `toPlaceDetail()` is the only adapter needed, the same one `AllPlaces` uses.

- **Empty**: the atlas has no places, or `savedPlaces` hasn't loaded/is empty — `ListEmptyComponent` shows "No places in this atlas yet."
- **Populated**: each place is rendered directly with `AllPlaces`' own `PlaceCard` (`../all-places/PlaceCard.tsx`) — full row layout, swipe-to-delete, and tap-to-open `PlaceDetail`, unchanged from that component, including swipe-to-delete calling `HomeContext.deleteSavedPlace` the same as `AllPlaces`.

### API

```ts
type AtlasDetailProps = {
  atlasId: string | null;         // null = hidden; non-null = slide up and show
  onDismiss: () => void;
  onHeightChange?: (height: number) => void;  // reports live panel height, same as PlaceDetail
};
```

## Related docs

- [MY-PLACES.md](../MY-PLACES.md) — parent feature that renders this tab
