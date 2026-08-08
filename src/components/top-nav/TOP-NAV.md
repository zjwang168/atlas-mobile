# TopNav Component

## Overview

Absolute-positioned overlay above the map holding the search button, the Saved/Discover mode switch, the profile avatar, and a separately-placed globe/navigate pill.

## Files

```
src/components/top-nav/
  TopNav.tsx               ← container; positions the top row and the map-control pill
  left-nav/LeftNav.tsx     ← search button (single icon pill)
  right-nav/RightNav.tsx   ← globe + navigate stacked vertical pill
```

## Behaviour

`showTopMode` gates the mode switch and the avatar together — it's on only while the My Places tab is active, and when off the avatar is replaced by a spacer so the search button keeps its position. The switch additionally renders only when `onTopModeChange` is supplied, so a caller that reads `topMode` without handling changes gets no dead control.

The globe/navigate pill is not part of the top row: it sits in its own container positioned down the screen as a map control, so it is unaffected by the top row's layout.

`TopNav` is memoised — pass it stable callbacks (`useCallback`) or the memo does nothing.

## API

```ts
type TopMode = 'saved' | 'discover';

type TopNavProps = {
  onSearchPress?: () => void;                      // search button in the top-left
  onGlobePress?: () => void;                       // globe icon — language / region filter
  onNavigatePress?: () => void;                    // navigate icon — recentres the map on the user
  onAvatarPress?: () => void;                      // profile avatar in the top-right
  topMode?: TopMode;                               // default: 'saved' — selected segment of the mode switch
  onTopModeChange?: (mode: TopMode) => void;       // omit to hide the switch entirely
  showTopMode?: boolean;                           // default: true — shows the mode switch and avatar
};

type LeftNavProps = {
  onSearchPress?: () => void;
};

type RightNavProps = {
  onGlobePress?: () => void;     // globe icon — language / region filter
  onNavigatePress?: () => void;  // navigate icon — route / directions
};
```

`TopMode` is exported from `TopNav.tsx`.

## Styling Notes

- All three components render `expo-glass-effect`'s `GlassView` where liquid glass is available, falling back to an `expo-blur` `BlurView` otherwise.
- The glass shadow (`glassShadow`) constant is defined locally in each file.

## Related docs

- [MY-PLACES.md](../../features/my-places/MY-PLACES.md) — owns the `PlacesView` type used by bottom-panel tabs
