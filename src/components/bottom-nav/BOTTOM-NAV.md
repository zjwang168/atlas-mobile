# BottomBar Component

## Overview

A floating navigation bar fixed to the bottom of the home screen. Contains a tab switcher for **My Places** / **Travel Plan** and an expandable add button that reveals **Import Places** and **Take Photo** actions.

## File

```
src/components/bottom-nav/BottomBar.tsx
```

## Props

```ts
type BottomBarProps = {
  activeTab?: 'myPlaces' | 'travelPlan';  // default: 'myPlaces'
  onTabChange?: (tab: Tab) => void;
  onAddPlace?: () => void;                // called when "Import Places" is tapped
};
```

## Behaviour

- **Tab pills**: two pressable labels side-by-side; the active one gets `bg-foreground text-background` styling.
- **Add button** (`+`): tapping animates the button to expand into a menu using `Animated.spring`. The menu shows two options:
  - **Import places** → calls `onAddPlace`
  - **Take a photo** → no-op (stub)
  Tapping outside the menu (a transparent overlay covers the screen) collapses it.
- Uses `expo-blur` `BlurView` for the frosted-glass background.
- Positioned via `absolute` at `bottom: 28`.

## Data Flow

```
BottomBar.onAddPlace
  → HomeScreen.onOpenImport
    → ImportScreen (src/features/import-places/import-screen/ImportScreen.tsx)
```

`onAddPlace` is the only prop that crosses the feature boundary. See `IMPORT-PLACES.md` for the full import flow.

## Styling Notes

- The expand animation interpolates `width`, `height`, and `borderRadius` simultaneously for a fluid pill-to-card morph.
- `addOpacity` and `menuOpacity` are separate interpolations so the `+` icon fades out before the menu items appear.
