# My Places Feature

## Overview

`MyPlaces` is the first tab of the home content panel. It displays the user's saved places with two sub-tabs: **All Places** (a scrollable list) and **Atlas** (a curated view, placeholder).

## File Structure

```
src/features/my-places/
  MyPlaces.tsx           ← root component rendered inside HomePanel
  all-places/
    AllPlaces.tsx        ← scrollable FlatList of place cards
  atlas/
    Atlas.tsx            ← curated atlas view (placeholder)
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

### Modes

**Full mode** (default): renders the header row (title + share button + avatar), a segmented control to switch sub-tabs, and the active sub-tab content.

**Compact mode** (`compact={true}`): renders only the title and action buttons. Used by `ContentPanel`'s compact snap content in `HomePanel`.

---

## `AllPlaces`

Scrollable `FlatList` of `PlaceCard` items sourced from `mockPlaceDetails`. Shows a "Recent pins" header with a chevron.

### Props

```ts
type AllPlacesProps = {
  onPlacePress?: (place: PlaceDetail) => void;
  bottomInset?: number;
};
```

> **Scroll reporting gap** — `MyPlaces` has an `onScroll` prop but does not forward it to `AllPlaces`. Scroll position is not currently reported to `ContentPanel` from this tab. Wire `onScroll` through `AllPlaces` when implementing proper gesture coordination.

---

## `Atlas`

Placeholder sub-tab. Renders the message "Your curated atlas will appear here."

No props.
