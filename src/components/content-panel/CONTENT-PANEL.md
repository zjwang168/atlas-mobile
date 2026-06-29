# ContentPanel Component

## Overview

A draggable bottom sheet that snaps to three heights (`compact`, `default`, `full`). Supports conditional visibility (slide-in / slide-out) and an optional separate compact-mode view. Used by `HomePanel`, `PlaceDetail`, `PlanDetail`, and `AddPlace`.

## File

```
src/components/content-panel/ContentPanel.tsx
```

## Props

```ts
type ContentPanelProps = {
  children: (props: ContentPanelRenderProps) => React.ReactNode;
  /**
   * When provided, rendered instead of children when snapState is 'compact'.
   * ContentPanel auto-measures its height and updates the compact snap point.
   */
  compactContent?: (props: CompactContentRenderProps) => React.ReactNode;
  initialSnap?: SnapState;           // default: 'default'
  /**
   * Controlled snap state. Animates to this value when it changes.
   * Internal gestures still work; call onSnapStateChange to sync.
   */
  snapState?: SnapState;
  onSnapStateChange?: (state: SnapState) => void;
  /**
   * When provided, the panel slides in/out based on this value.
   * Omit for always-visible panels.
   */
  visible?: boolean;
  onHidden?: () => void;             // called after slide-out animation finishes
  zIndex?: number;                   // default: 30
  /** Overrides snap-based height; pins the panel to this exact pixel height. */
  height?: number;
  /** Overrides the 'default' snap height and animates to it immediately. */
  defaultSnapHeight?: number;
};
```

## Render Prop API

`children` receives:

```ts
type ContentPanelRenderProps = {
  snapState: SnapState;
  snapTo: (state: SnapState, animated?: boolean) => void;
  setCompactHeight: (height: number) => void;  // update compact snap point dynamically
  reportScrollY: (y: number) => void;          // call from inner scroll views
  bottomInset: number;                         // safe-area bottom inset
};
```

`compactContent` receives:

```ts
type CompactContentRenderProps = {
  snapTo: (state: SnapState, animated?: boolean) => void;
};
```

## Snap Heights

| State | Default height | Notes |
|---|---|---|
| `compact` | `HANDLE_HEIGHT + 40` (dynamic) | Height auto-updated via `setCompactHeight` |
| `default` | `SCREEN_HEIGHT * 0.55` | Overridable via `defaultSnapHeight` |
| `full` | `SCREEN_HEIGHT` | Adds `paddingTop: insets.top` |

Snap thresholds:
- Release above `SCREEN_HEIGHT * 0.75` → snaps to `full`
- Release below `SCREEN_HEIGHT * 0.25` → snaps to `compact`
- In between → stays at dragged height, state becomes `default`

## Mount behaviour

`children` and `compactContent` are **always mounted** simultaneously. The panel uses `display: 'none'` (not unmounting) to hide whichever slot is inactive. This preserves the internal state of whichever view is currently hidden — e.g. scroll position, form values, in-progress animations. Do not rely on mount/unmount lifecycle for state resets inside `ContentPanel` children.

## Gesture Coordination

The panel intercepts downward drags **only when** `scrollY === 0` (inner scroll is at the top). The drag handle bar always intercepts all directions. Pass `reportScrollY` to inner `ScrollView`/`FlatList` `onScroll` handlers to keep this in sync.

## Visual Behaviour

- Border radius and horizontal margins animate between `default` and `full` via `panelHeight` interpolation, producing a fluid card-to-fullscreen transition.
- `expo-blur` `BlurView` (iOS system thick material) is the background layer.
- When `visible` is provided: enters via `translateY 40→0 + opacity 0→1` (280ms), exits via reverse (220ms).

## Usage Examples

### Always-visible panel

```tsx
<ContentPanel initialSnap="default" zIndex={30}>
  {({ reportScrollY, bottomInset }) => (
    <FlatList
      onScroll={(e) => reportScrollY(e.nativeEvent.contentOffset.y)}
      contentContainerStyle={{ paddingBottom: bottomInset }}
      ...
    />
  )}
</ContentPanel>
```

### Conditionally visible panel with compact content

```tsx
<ContentPanel
  visible={isOpen}
  onHidden={onDismiss}
  compactContent={({ snapTo }) => (
    <CompactHeader onExpand={() => snapTo('default')} />
  )}
>
  {({ reportScrollY, bottomInset }) => <FullContent />}
</ContentPanel>
```
