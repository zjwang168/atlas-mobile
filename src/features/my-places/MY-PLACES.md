# My Places Feature

## Overview

My Places is the primary tab of the home content panel. It shows the user's saved places — personal collection of locations they've bookmarked or imported.

## File Structure

```
src/features/my-places/
  MyPlaces.tsx     ← root component rendered inside HomePanel
  MY-PLACES.md     ← this document
```

## Props

```ts
type MyPlacesProps = {
  onPlacePress?: (place: Place) => void;  // tap a row → HomeScreen opens PlaceDetail
  onScroll?: (y: number) => void;         // scroll Y reported to ContentPanel for gesture coordination
  bottomInset?: number;                   // safe-area + bottom-bar clearance for scroll padding
};
```

## Status

Skeleton. Content to be designed and implemented.
