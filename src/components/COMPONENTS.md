# Shared Components

Reusable components consumed across multiple features. Nothing in this directory should import from `src/features/`.

## Directory Structure

```
src/components/
  bottom-nav/
    BottomBar.tsx          ← tab pill (My Places / Plan Mode) + add-place button
  content-panel/
    ContentPanel.tsx       ← draggable bottom sheet with snap states
  search-bar/
    SearchBar.tsx          ← URL input bar with clipboard detection (currently unmounted)
  ui/
    badge.tsx              ← RN Reusables badge
    button.tsx             ← RN Reusables button
    card.tsx               ← RN Reusables card
    input.tsx              ← RN Reusables input
    text.tsx               ← RN Reusables text
```

## BottomBar

Floating navigation bar fixed to the bottom of the home screen.

**Props**
```ts
type BottomBarProps = {
  activeTab?: 'myPlaces' | 'travelPlan';
  onTabChange?: (tab: Tab) => void;
  onAddPlace?: () => void;
};
```

Uses `expo-blur` for the frosted-glass background. Icons via `@expo/vector-icons/Ionicons`.

## ContentPanel

A draggable bottom sheet that snaps to three heights. Used by both `HomePanel` (always-visible) and `PlaceDetail` (conditionally visible via `visible` prop).

**Snap states**

| State | Default height | Notes |
|---|---|---|
| `compact` | Dynamic (set via `setCompactHeight`) | Only renders compact content |
| `default` | 60% of screen height | Default entry state |
| `full` | 100% of screen height | Adds `paddingTop: insets.top` |

**Render prop API** — children receive:
```ts
{
  snapState: SnapState;
  snapTo: (state: SnapState, animated?: boolean) => void;
  setCompactHeight: (height: number) => void;  // for dynamic compact height
  reportScrollY: (y: number) => void;          // coordinate with scroll gesture
  bottomInset: number;                         // safe-area bottom inset
}
```

**Gesture coordination** — the panel captures downward drags only when `scrollY === 0`. The drag handle always captures. This prevents conflicts with inner `ScrollView` / `FlatList` components.

**Conditional visibility** — pass `visible` + `onHidden` to animate in/out via `translateY`. Omit for always-visible panels.

## SearchBar

URL input bar with clipboard sniffing — detects Reddit links on focus and prompts to paste. Currently unmounted from HomeScreen; kept for future reuse.

## UI Primitives (`ui/`)

Thin wrappers from [RN Reusables](https://rnr-docs.vercel.app/). Drop-in replacements for common RN primitives styled with NativeWind. Use these instead of raw RN components for consistency.
