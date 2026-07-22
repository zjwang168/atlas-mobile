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
  /** Shared settled snap memory key. Ignored when snapState is provided. */
  snapGroup?: string;
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
| `short` | `SCREEN_HEIGHT * 0.40` | Low resting position |
| `default` | `SCREEN_HEIGHT * 0.55` | Normal list view; overridable via `defaultSnapHeight` |
| `tall` | `SCREEN_HEIGHT * 0.70` | CreatePlan wizard height |
| `full` | `SCREEN_HEIGHT` | Adds `paddingTop: insets.top` |

`export const SNAP_HEIGHTS: Record<SnapState, number>` exposes this table so callers that need a panel's approximate pixel height from its snap state alone (without mounting a listener) don't hardcode a second copy — see `HomeScreen.tsx`'s map padding sizing.

On release, the panel always snaps to the nearest snap point by absolute pixel distance — there is no free-height zone.

Animated `snapTo` changes update the internal target immediately, but React-visible `snapState` / `onSnapStateChange` are committed after the height spring finishes — this keeps controlled-mode updates from blocking the first frames of a new snap animation. `snapGroup` memory is broadcast one frame later (via `requestAnimationFrame`, not deferred all the way to spring completion): broadcasting synchronously on the same tick that starts the spring forces every other group member to re-render on that tick, which stalls the spring's first frame (its updates run on the JS thread too, since `useNativeDriver: false`); waiting for full settle instead would leave a panel that becomes visible mid-spring reading a stale group value until it cuts over. The one-frame defer splits the difference.

## Snap Groups

`ContentPanelSnapProvider` owns shared snap memory for named panel groups. A `ContentPanel` with `snapGroup="home-main"` initializes from that group's last settled snap state and writes its new target back to the group one frame after `snapTo` is called (see Snap Heights for why not synchronously or at spring completion). This lets sibling panels inherit the same resting state without using React state as the animation driver.

When a *different* panel in the group settles a new snap, the rest of the group resyncs to it instantly (no spring) — only the panel whose own gesture or override actually drove the change animates. This keeps a panel that's about to become visible already caught up, instead of its entrance transition racing a catch-up spring on its height.

Priority order:

1. `snapState` prop, when provided, explicitly controls the panel.
2. `snapGroup`, when provided, inherits and updates the group's last settled snap.
3. `initialSnap` is used when neither controlled state nor group memory exists.

## Mount behaviour

`children` and `compactContent` are **always mounted** simultaneously, stacked absolutely and crossfaded via opacity (not unmounted or `display: 'none'`) — see Visual Behaviour. This preserves the internal state of whichever view is currently faded out — e.g. scroll position, form values, in-progress animations. `pointerEvents` is toggled per-layer (`'auto'`/`'none'`) based on `snapState` so touches only route to the active layer. Do not rely on mount/unmount lifecycle for state resets inside `ContentPanel` children.

## Gesture Coordination

The panel intercepts downward drags **only when** `scrollY === 0` (inner scroll is at the top). The drag handle bar always intercepts all directions. Pass `reportScrollY` to inner `ScrollView`/`FlatList` `onScroll` handlers to keep this in sync.

The content-area drag responder also ignores touch-moves while a `snapTo`-driven animation is in flight, so incidental finger movement during a tap (e.g. on a button that triggers `snapTo`) can't get captured mid-animation and resolve to the wrong snap point on release.

## Visual Behaviour

- Border radius and horizontal margins animate between `default` and `full` via `panelHeight` interpolation, producing a fluid card-to-fullscreen transition.
- `expo-blur` `BlurView` (iOS system thick material) is the background layer.
- When `visible` is provided: enters via `translateY 40→0 + opacity 0→1` (280ms), exits via reverse (220ms).
- `children` and `compactContent` are stacked absolutely on top of each other and crossfade via opacity interpolated from `panelHeight` (over the first 50px above the measured compact height), so the content swap stays in sync with the height spring instead of cutting instantly at the `compact` snap boundary.

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
  snapGroup="home-main"
  visible={isOpen}
  onHidden={onDismiss}
  compactContent={({ snapTo }) => (
    <CompactHeader onExpand={() => snapTo('default')} />
  )}
>
  {({ reportScrollY, bottomInset }) => <FullContent />}
</ContentPanel>
```
