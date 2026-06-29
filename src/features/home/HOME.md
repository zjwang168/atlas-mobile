# Home Feature

## Overview

The home screen layers a full-screen map, a draggable content panel, and overlay panels (place detail, add place). All cross-cutting state lives in `HomeContext` — the single API surface for this feature.

```
HomeScreen  (HomeProvider)
├── MapboxMap          ← full-screen, behind everything
├── HomePanel          ← draggable bottom panel; hidden when any overlay is active
├── PlaceDetail        ← slides up when overlay.kind === 'placeDetail'
├── AddPlaceToPlan     ← slides up when overlay.kind === 'addPlaceToPlan'
└── BottomBar          ← always on top
```

---

## `HomeContext`

**`src/features/home/HomeContext.tsx`** — the only import consumers need.

### `useHome()`

```ts
const { overlay, setOverlay } = useHome();
```

| Value | Type | Description |
|---|---|---|
| `overlay` | `Overlay` | Currently active overlay |
| `setOverlay` | `(o: Overlay) => void` | Opens or closes an overlay |

### `PANEL_HEIGHT`

Static height constants for the bottom panel.

```ts
import { PANEL_HEIGHT } from '@/features/home/HomeContext';

PANEL_HEIGHT.default      // SCREEN_HEIGHT * 0.55
PANEL_HEIGHT.createPlan   // SCREEN_HEIGHT * 0.70
```

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

## Parse-link data flow

`HomeScreen` imports `parseLink` from `src/services/api/apiService.ts` and `ParseResult` / `ChatMessage` from `src/types/route.ts`. When a link is submitted:

1. `HomeScreen.handleSendMessage` calls `parseLink(url)`.
2. On success, `parseResult` state is set, which drives the route polyline and markers on `MapboxMap`.
3. `HomePanel` receives `parseResult`, `isLoading`, `messages`, `onSendMessage`, and `error` as props — these are forwarded to whichever tab is active. They are **not consumed by `HomePanel` itself**; they exist as a pass-through conduit for future tab implementations.

## `HomePanel` visibility rule

`HomePanel` is only visible when `overlay.kind === 'none'`. When any overlay (`placeDetail`, `planDetail`, `addPlace`) is active, `HomePanel` slides out. When the overlay closes, it slides back in automatically. This is wired in `HomePanel` via `visible={overlay.kind === 'none'}`.

## `HomeProvider`

Wrap the root of the feature tree. Already done inside `HomeScreen` — no setup needed elsewhere.

```tsx
import { HomeProvider } from '@/features/home/HomeContext';

<HomeProvider>
  <HomeScreen />
</HomeProvider>
```
