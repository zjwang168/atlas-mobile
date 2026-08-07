# TopNav Component

## Overview

Absolute-positioned overlay above the map holding the search button, the My Places view switch, the profile avatar, and a separately-placed globe/navigate pill.

## Files

```
src/components/top-nav/
  TopNav.tsx               ← container; positions the top row and the map-control pill
  left-nav/LeftNav.tsx     ← search button (single icon pill)
  right-nav/RightNav.tsx   ← globe + navigate stacked vertical pill
```

## Behaviour

`showPlacesMode` gates the view switch and the avatar together — it's on only while the My Places tab is active, and when off the avatar is replaced by a spacer so the search button keeps its position. The switch additionally renders only when `onPlacesViewChange` is supplied, so a caller that reads `placesView` without handling changes gets no dead control.

The globe/navigate pill is not part of the top row: it sits in its own container positioned down the screen as a map control, so it is unaffected by the top row's layout.

`TopNav` is memoised — pass it stable callbacks (`useCallback`) or the memo does nothing.

## API

```ts
type TopNavProps = {
  onSearchPress?: () => void;                        // search button in the top-left
  onGlobePress?: () => void;                         // globe icon — language / region filter
  onNavigatePress?: () => void;                      // navigate icon — recentres the map on the user
  onAvatarPress?: () => void;                        // profile avatar in the top-right
  placesView?: PlacesView;                           // default: 'allPlaces' — selected segment of the view switch
  onPlacesViewChange?: (view: PlacesView) => void;   // omit to hide the switch entirely
  showPlacesMode?: boolean;                          // default: true — shows the view switch and avatar
};

type LeftNavProps = {
  onSearchPress?: () => void;
};

type RightNavProps = {
  onGlobePress?: () => void;     // globe icon — language / region filter
  onNavigatePress?: () => void;  // navigate icon — route / directions
};
```

`PlacesView` is exported from `@/features/my-places/MyPlaces`.

## Styling Notes

- All three components render `expo-glass-effect`'s `GlassView` where liquid glass is available, falling back to an `expo-blur` `BlurView` otherwise.
- The glass shadow (`glassShadow`) constant is defined locally in each file.

## Related docs

- [MY-PLACES.md](../../features/my-places/MY-PLACES.md) — owns the `PlacesView` type the switch drives
