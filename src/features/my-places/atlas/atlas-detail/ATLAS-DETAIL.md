# AtlasDetail

## Overview

A `ContentPanel` overlay — modeled on `PlaceDetail` (`../../../place-detail/PlaceDetail.tsx`) — that lists every place inside one atlas.

## Behaviour

`HomeScreen` mounts a single always-present instance and drives it from `HomeContext`'s `atlasDetail` overlay kind, the same pattern as `PlaceDetail`/`PlanDetail`.

### Status

- **Hidden**: `atlasId` is `null` — panel slides out.
- **Shown**: looks the atlas up in `useHome().atlases`. The sheet reads as a trip: a fixed header carrying a cover, the title, and a `N days · M places` summary, then the day switcher, then the itinerary. Back and Edit are published to the shared map as `AtlasMapState.overlay` rather than living in the sheet, which frees the sheet's top row for the cover and title; Share sits in the header, and the route toggle stays in the panel because it changes what the list means, not just the camera. Compact snap shows a condensed row (emoji + title + dismiss).

An Atlas has no cover of its own, so the first stop with a photo stands in for one.

### Days

Stops are grouped by `timeline_day` into ordered day tabs, with undated stops last. The grouping decides the whole layout:

- **More than one group** — a tab row appears. Overview lists one summary card per day (badge, city, distance and place count, a strip of that day's photos); tapping a card opens that day's tab, which lists its stops as a numbered sequence.
- **One group** — there is nothing to switch between, so the tab row is hidden and the stops are listed directly. A single-day trip never shows a "Day 1" tab it could not leave.

A day's city is the one most of its stops name, and its distance is the straight-line path through them in order — not the driving distance, which only exists after the user asks for a route.

Stops render a category chip only when the stop is also a saved place: `atlas_places` stores no category, so it is resolved from `savedPlaces` via `place_id` and a stop added straight from search has none. The same is true of the city a day is labelled with. `AtlasHeader` sits outside/above the list, fixed; `AtlasOverviewSection.tsx` (this directory) is passed as the list's `ListHeaderComponent`, so it scrolls away with the rest of the content instead of staying pinned — showing a place count + description on the left with add/delete/share/edit/more action buttons, and the atlas emoji in a square (in place of a thumbnail) on the right. Add and delete are wired; share/edit/more are still no-ops.

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

The sheet is composed from four co-located components and one derivation module:

```ts
// atlasItinerary.ts — the shape of a stop, and everything derived from the list
export type AtlasDisplayPlace   // a stop's renderable fields; category/city are null unless it is also a saved place
export type ItineraryItem       // one atlas_places row resolved against savedPlaces
export type DayGroup            // one tab: day, label, city, items, distanceKm
export function groupItemsByDay(items: ItineraryItem[]): DayGroup[]   // numbered days in order, undated last
export function pathDistanceKm(items: ItineraryItem[]): number        // straight-line path through the stops
export function atlasCoverUri(items: ItineraryItem[]): string | null  // first stop with a photo
export function tripSummary(groups: DayGroup[], count: number): string  // "5 days · 8 places"
export function formatDistanceKm(km: number): string

export function AtlasDetailHeader(props: { title: string; summary: string; coverUri: string | null; onShare?: () => void })
export function AtlasDayTabs(props: { tabs: AtlasTab[]; activeKey: string; onSelect: (key: string) => void })
export function AtlasDayCard(props: { group: DayGroup; onPress: () => void })       // one day, summarised for Overview
export function AtlasStopRow(props: {                                              // one stop in a day
  item: ItineraryItem; index: number; hasNext: boolean; selected: boolean;
  onPress: () => void; onNavigate?: () => void;                                    // onNavigate opens directions to the next stop
})
```

## Related docs

- [ATLAS.md](../ATLAS.md) — parent feature; renders `AtlasCard`, which opens this overlay
- [MY-PLACES.md](../../MY-PLACES.md) — top-level feature that renders the atlas tab
- [ADD-PLACE.md](../../../add-place/ADD-PLACE.md) — shared overlay opened by the add button
