# Home Feature

## Overview

The home screen layers a full-screen map, a native tab bar, a draggable content panel, and overlay panels. All cross-cutting state lives in `HomeContext` — the single API surface for this feature.

```
HomeScreen  (HomeProvider)
├── MapboxMap          ← single instance, full-screen, behind everything
├── TopBlurFade        ← status-bar scrim
├── TopNav             ← search + globe controls
├── HomeTabBar         ← native iOS tab bar; screens are transparent/passthrough
├── HomePanel          ← single ContentPanel; toggles MyPlaces/MyPlan via activeTab
├── AddMenu            ← "+" pop-up menu
├── PlaceDetail        ← slides up when overlay.kind === 'placeDetail'
├── PlanDetail         ← slides up when overlay.kind === 'planDetail'
└── AddPlaceToPlan     ← slides up when overlay.kind === 'addPlaceToPlan'
```

**Single map, single panel:** `HomeTabBar` uses transparent `pointerEvents="none"` screens so touch events fall through to the map. `HomePanel` mounts both tab views and toggles their visibility — snap state and scroll position are preserved when switching tabs.

---

## `HomeContext`

**`src/features/home/HomeContext.tsx`** — the only import consumers need.

### `useHome()`

```ts
const { overlay, setOverlay, tabBarVisible, setTabBarVisible } = useHome();
```

| Value | Type | Description |
|---|---|---|
| `overlay` | `Overlay` | Currently active overlay |
| `setOverlay` | `(o: Overlay) => void` | Opens or closes an overlay |
| `tabBarVisible` | `boolean` | Whether the native tab bar is shown |
| `setTabBarVisible` | `(visible: boolean) => void` | Fade the tab bar in or out (220 ms) |

### `Overlay` type

```ts
type Overlay =
  | { kind: 'none' }
  | { kind: 'placeDetail'; placeName: string }
  | { kind: 'planDetail'; planId: string }
  | { kind: 'addPlaceToPlan'; onSelect: (places: PlannedPlace[]) => void };
```

---

## Usage Examples

### Open place detail
```ts
const { setOverlay } = useHome();

setOverlay({ kind: 'placeDetail', placeName: 'Noma Restaurant' });
```

### Open plan detail
```ts
setOverlay({ kind: 'planDetail', planId: 'plan-abc123' });
```

### Open add-place-to-plan and receive the result
```ts
const { setOverlay } = useHome();

setOverlay({
  kind: 'addPlaceToPlan',
  onSelect: (places) => {
    // places: PlannedPlace[] — insert wherever needed
  },
});
```

`HomeScreen` calls `onSelect` and resets to `{ kind: 'none' }` automatically when the user confirms.

### Dismiss any overlay
```ts
setOverlay({ kind: 'none' });
```

### Read panel height (e.g. to size a sibling panel)
```ts
import { PANEL_HEIGHT } from '@/features/home/HomeContext';

// Pin a panel to the same height as the create-plan panel
<ContentPanel defaultSnapHeight={PANEL_HEIGHT.createPlan} />
```

---

## `HomePanel` visibility rule

`HomePanel` is only visible when `overlay.kind === 'none'`. When any overlay is active, the panel slides out. It slides back in when the overlay closes. Wired via `visible={overlay.kind === 'none'}` in `HomeScreen`.

## `HomeTabBar` tab constants

Tab key strings are exported from `HomeTabBar.tsx` — import them instead of using raw string literals:

```ts
import { TAB_PLACES, TAB_PLAN } from '@/features/home/HomeTabBar';
```

## `HomeProvider`

Wrap the root of the feature tree. Already done inside `HomeScreen` — no setup needed elsewhere.

```tsx
import { HomeProvider } from '@/features/home/HomeContext';

<HomeProvider>
  <HomeScreen />
</HomeProvider>
```
