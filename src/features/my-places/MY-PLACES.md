# My Places Feature

## Overview

`MyPlaces` is the first tab of the home content panel. It displays the user's saved places with two sub-tabs: **All Places** (a scrollable list) and **Atlas** (a curated view of places grouped into named atlases).

## File Structure

```
src/features/my-places/
  MyPlaces.tsx           ← root component rendered inside HomePanel
  all-places/
    AllPlaces.tsx        ← scrollable FlatList of place cards
  atlas/
    Atlas.tsx            ← curated atlas view
    AtlasCard.tsx        ← square-emoji + title card used in the horizontal row; opens AtlasDetail
    AtlasDetail.tsx       ← overlay listing the places inside one atlas, triggered via HomeContext
    AtlasOverviewSection.tsx  ← place count/description + emoji, rendered below AtlasDetail's header
    AtlasPlaceCard.tsx   ← square-thumbnail + name card, not currently rendered
  MY-PLACES.md           ← this document
```

---

## `MyPlaces`

### Props

```ts
type MyPlacesProps = {
  onPlacePress?: (place: Place) => void;   // tap a row → HomeScreen opens PlaceDetail
  onScroll?: (y: number) => void;          // scroll Y reported to ContentPanel for gesture coordination
  bottomInset?: number;                    // safe-area + bottom-bar clearance for scroll padding
  avatarUri?: string;                      // user avatar image URL
  avatarFallback?: string;                 // initials shown when image is unavailable
  onAvatarPress?: () => void;
  onSharePress?: () => void;
  /** Renders a condensed header only — used when the panel is in compact snap state */
  compact?: boolean;
};
```

### Status

**Full mode** (default): renders the header row (title + share button + avatar), a segmented control to switch sub-tabs, and both sub-tab bodies. The segmented control is rendered once in a stable tree position above the sub-tab body (not re-parented per tab) so the native control doesn't unmount/remount when switching tabs — it stays pinned rather than scrolling away with the All Places list. `AllPlaces` and `Atlas` are both always mounted and toggled via `display: 'none'` rather than conditional rendering, so switching tabs doesn't re-trigger `AllPlaces`'s fetch and full `FlatList`/row remount.

**Compact mode** (`compact={true}`): renders only the title and action buttons. Used by `ContentPanel`'s compact snap content in `HomePanel`.

---

## `AllPlaces`

Scrollable `FlatList` of `PlaceCard` items sourced from `fetchSavedPlaces` / `HomeContext.savedPlaces`. Shows a "Recent pins" header with a chevron.

### Status

Places are loaded in full from the service/context, but rendered a page at a time (`PAGE_SIZE = 20`): the list only slices in the first page, then reveals more as the user scrolls near the bottom (`onEndReached`), showing a footer spinner while more of the already-fetched data is being paged in. Pull-to-refresh resets back to one page.

### Props

```ts
type AllPlacesProps = {
  onPlacePress?: (place: PlaceDetail) => void;
  bottomInset?: number;
};
```

> **Scroll reporting gap** — `MyPlaces` has an `onScroll` prop but does not forward it to `AllPlaces`. Scroll position is not currently reported to `ContentPanel` from this tab. Wire `onScroll` through `AllPlaces` when implementing proper gesture coordination.

The segmented control is no longer passed in as a list header — it's rendered by `MyPlaces` above the `FlatList` and stays pinned while the list scrolls beneath it.

---

## `Atlas`

Curated sub-tab — shows a horizontal scroll row of atlas cards (emoji + title). See [atlas/ATLAS.md](atlas/ATLAS.md).

No props.
