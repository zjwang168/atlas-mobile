# TopNav Component

## Overview

Absolute-positioned navigation overlay that sits at the top of the map screen. Renders a search button on the left and a two-button globe/navigate pill on the right. All buttons are frosted-glass (`expo-blur`) shapes over the map.

## Files

```
src/components/top-nav/
  TopNav.tsx               ← container; positions LeftNav and RightNav
  left-nav/LeftNav.tsx     ← search button (single icon pill)
  right-nav/RightNav.tsx   ← globe + navigate stacked vertical pill
```

---

## `TopNav`

### Props

```ts
type TopNavProps = {
  onSearchPress?: () => void;
  onGlobePress?: () => void;
  onNavigatePress?: () => void;
};
```

Positioned `absolute left-0 right-0 z-30` with `paddingTop: safeAreaInsets.top + 8`. Uses `pointerEvents="box-none"` so taps on the transparent area fall through to the map.

---

## `LeftNav`

Single circular blur button with a search (magnifier) icon.

### Props

```ts
type LeftNavProps = {
  onPress?: () => void;
};
```

---

## `RightNav`

Vertical rounded-pill blur container with two icon buttons stacked vertically.

### Props

```ts
type RightNavProps = {
  onGlobePress?: () => void;     // globe icon — language / region filter
  onNavigatePress?: () => void;  // navigate icon — route / directions
};
```

---

## Styling Notes

- Both components use `expo-blur` `BlurView` with `intensity={40}` and `tint="light"`.
- The glass shadow (`glassShadow`) constant is defined locally in each file and applies `shadowRadius: 20`.
- Compass position in `MapboxMap` is calculated relative to `RightNav` height to avoid overlap.
