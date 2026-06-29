# PlanPlace Feature — Implementation Plan (v3)

## Critique of Previous Plan (Issues Fixed)

| # | Issue | Fix |
|---|-------|-----|
| 1 | `AddPlaceField` placed in `src/components/` imports `PlaceSlotCard` from `plan-place/` — violates COMPONENTS.md rule ("Nothing here shall import from `src/features/`") | Moved to `plan-place/` |
| 2 | Local `TimeSlot` type clashes with `src/types/place.ts`'s exported `TimeSlot` (`{open, close}`) | Renamed to `VisitSlot` |
| 3 | DnD uses `PanResponder` + `Animated.ValueXY` — the old RN API. Project already has `react-native-gesture-handler ~2.31.1` and `react-native-reanimated 4.3.1`, which run on the UI thread with no JS-bridge lag | Replaced with RNGH `GestureDetector` + Reanimated `useSharedValue` |
| 4 | Drop zones use `ref.measure()` — async, returns screen-space coords that go stale when nested scroll moves | Replaced with `onLayout` relative to a shared DnD container ref |
| 5 | `AddPlaceInDate` gives each date column its own vertical `ScrollView` — conflicts with ContentPanel's `PanResponder` and the outer horizontal scroll | Single vertical scroll via PlanPlace's outer `ScrollView`; columns are fixed-height |
| 6 | `AddPlace` nested inside ContentPanel's `overflow: hidden` inner view — absolutely-positioned children get clipped at panel edges | `AddPlace` is a full-cover absolute overlay within PlanPlace, not a nested ContentPanel |
| 7 | `PlacesState` in `PlanPlace` local `useState` — resets when user navigates back to step 1 | Extended into `createPlanCache` |
| 8 | Uses raw `TextInput` for AddPlace search, raw RN `Text` throughout | Use `Input`, `Text`, `Button`, `Badge` primitives everywhere |
| 9 | `AddPlace` results described as `ScrollView + .map()` | Use `FlatList` with `keyExtractor` |
| 10 | Figma design shows filter pills and two-line result rows — plan didn't mention them | Added filter pill row (`Badge`s); `PlaceSlotCard` gets name + subtitle |
| 11 | `onDrop` signature has no `targetIndex` — future within-slot reorder will require an insertion point | Added `targetIndex?: number` now; reorder logic deferred |
| 12 | Ghost rendered inside `PlanPlace`'s ScrollView subtree | Ghost rendered as last child of `DndProvider` (outside ScrollView, inside PlanPlace root) |

---

## File Map

```
src/
├── features/
│   ├── add-place/
│   │   └── AddPlace.tsx                    [NEW] absolute overlay panel: search + filter + multi-select
│   │
│   └── create-plan/
│       ├── CreatePlan.tsx                  [CHANGE] pass location + range to PlanPlace
│       └── plan-place/
│           ├── types.ts                    [NEW] local types (VisitSlot, PlannedPlace, SlotKey, PlacesState)
│           ├── PlanPlace.tsx               [CHANGE] remove Input; header + free field + AddPlaceInDate + AddPlace overlay
│           ├── AddPlaceField.tsx           [NEW] bordered field: label + + button + list of PlaceSlotCards
│           ├── AddPlaceInDate.tsx          [NEW] horizontal date strip, 4 AddPlaceFields per column
│           ├── PlaceSlotCard.tsx           [NEW] name + subtitle + × remove
│           └── dnd/
│               ├── DndProvider.tsx         [NEW] Reanimated shared values + drop zone registry + ghost render
│               └── useDragCard.ts          [NEW] hook: LongPressGesture + PanGesture → startDrag / onDrop
```

No changes to `src/components/` or `ContentPanel`.

---

## Data Model — `plan-place/types.ts`

```ts
import type { DateRange } from '../CreatePlan';

export type VisitSlot = 'morning' | 'noon' | 'afternoon' | 'night';

export const VISIT_SLOTS: VisitSlot[] = ['morning', 'noon', 'afternoon', 'night'];

export type PlannedPlace = {
  id: string;        // unique instance id (nanoid) — same place can exist in multiple slots
  placeId: string;
  name: string;
  subtitle: string;  // address / category shown below name
};

export type SlotKey =
  | { kind: 'free' }
  | { kind: 'dated'; date: string; slot: VisitSlot };

export type PlacesState = {
  free: PlannedPlace[];
  byDate: Record<string, Record<VisitSlot, PlannedPlace[]>>;
};

// Helper: enumerate ISO date strings between start and end (inclusive)
export function enumerateDates(range: DateRange): string[] {
  if (!range.start || !range.end) return range.start ? [range.start] : [];
  const dates: string[] = [];
  const cursor = new Date(range.start);
  const end = new Date(range.end);
  while (cursor <= end) {
    dates.push(cursor.toISOString().split('T')[0]);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
```

`createPlanCache` in `CreatePlan.tsx` is extended:
```ts
export const createPlanCache: {
  location: string;
  range: DateRange;
  places: PlacesState;
} = {
  location: '',
  range: { start: null, end: null },
  places: { free: [], byDate: {} },
};
```

---

## Component Breakdown

---

### `PlaceSlotCard` — `plan-place/PlaceSlotCard.tsx`

Two-line row matching the Figma design. Used inside `AddPlaceField`.

```
┌──────────────────────────────────────────┐
│  ≡  Ichiran Ramen Shibuya           [✕] │
│     1-22-7 Jinnan, Shibuya, Tokyo        │
└──────────────────────────────────────────┘
```

- Left drag handle icon (`≡` or `⠿` via Ionicons `reorder-three`) — long-press here initiates drag.
- Place name (16px, `text-foreground`) + subtitle (13px, `text-muted-foreground`) stacked.
- Right: `Button variant="ghost" size="icon"` with Ionicons `close` — calls `onRemove(place.id)`.
- While being dragged: source card shows reduced opacity (0.3) with a dashed outline placeholder.

```ts
type PlaceSlotCardProps = {
  place: PlannedPlace;
  slotKey: SlotKey;
  onRemove: (id: string) => void;
  isDragSource?: boolean;  // true while this card's ghost is in flight
};
```

Reusable component primitives: `Text`, `Button`.

---

### `AddPlaceField` — `plan-place/AddPlaceField.tsx`

```
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
  Morning                            [+]
  ┌──────────────────────────────────────┐   ← PlaceSlotCard (only shown when places > 0)
  │ ≡  Tsukiji Market           [✕]     │
  │    Tsukiji, Chuo City, Tokyo        │
  └──────────────────────────────────────┘
  [drop zone highlight when dragging over]
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
```

- Rounded border (`border-border rounded-xl`); border turns accent color when a drag hovers over.
- Header row: `Text` label (optional) + `Button variant="ghost" size="icon"` with `add` Ionicon.
- Body: maps `places` → `PlaceSlotCard`. When empty, body has minimum height for drop affordance.
- The field View is registered as a DnD drop zone on mount.

```ts
type AddPlaceFieldProps = {
  label?: string;
  places: PlannedPlace[];
  slotKey: SlotKey;
  onAdd: () => void;
  onRemove: (id: string) => void;
};
```

Reusable component primitives: `Text`, `Button`.

---

### `AddPlace` — `features/add-place/AddPlace.tsx`

**Entry interaction:** Identical visual feel to `PlaceDetail` — slides up and fades in — but implemented as an **absolute overlay inside PlanPlace** (not a nested `ContentPanel`, which would be clipped by the outer panel's `overflow: hidden`).

**Layout (from Figma node 521:3211):**

```
┌────────────────────────────────────────┐
│  ░░░░░░░░░░░  (drag handle)            │
│  [🔍 Search              ] [filter ⊙] │
│  ─────────────────────────────────────  │
│  [ Recommended ] [ Best for Summer ]   │  ← horizontal Badge scroll
│  [ Nearby      ] [ Not Yet Visited ]   │
│  ─────────────────────────────────────  │
│  Ichiran Ramen Shibuya          [✓]   │
│  1-22-7 Jinnan, Shibuya, Tokyo        │
│  ─────────────────────────────────────  │
│  Hamarikyu Garden               [✓]   │
│  ...                                    │
│                                        │
│  [     Add 2 places     ]              │  ← Button disabled when 0 selected
└────────────────────────────────────────┘
```

**Animation:** Reanimated `useSharedValue` for `translateY` + `opacity`. Slides in from bottom when `visible` changes to true; slides out on dismiss. Uses `NativeOnlyAnimatedView` (already in `src/components/ui/`).

**Filter pills:** Horizontal `ScrollView` of `Badge variant="outline"` / `Badge variant="default"` (active). Tapping a pill filters the results list. Placeholder categories: Recommended · Nearby · Not Yet Visited.

**Results list:** `FlatList` with `reportScrollY`-equivalent — `onScroll` tracks scroll position so the outer `PanResponder` in ContentPanel can yield to the inner scroll. Each row:
- Left: name (`Text` 16px) + subtitle (`Text` 13px `text-muted-foreground`)
- Right: `Button variant="ghost" size="icon"` toggling a checkmark Ionicon

**Confirm:** `Button` (full-width, `size="lg"`, `className="rounded-full"`) at bottom. Label: `"Add 1 place"` / `"Add N places"` / `"Done"` (0 selected = disabled).

```ts
type AddPlaceProps = {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (places: PlannedPlace[]) => void;
};
```

Placeholder data: 8 hardcoded entries from `mockPlaceDetails`, filtered client-side by `Input` search value.

Reusable component primitives: `Input`, `Text`, `Button`, `Badge`, `NativeOnlyAnimatedView`.

---

### `AddPlaceInDate` — `plan-place/AddPlaceInDate.tsx`

```
  Jun 28 Sat  │  Jun 29 Sun  │  Jun 30 Mon  →  (horizontal ScrollView, no paging)
 ─────────────┼──────────────┼──────────────
  Morning          Morning        Morning
  [AddPlaceField]  [...]          [...]
  Noon
  [AddPlaceField]
  Afternoon
  [AddPlaceField]
  Night
  [AddPlaceField]
```

- **No vertical scroll per column.** Each column is fixed height — all 4 slots stack. PlanPlace's outer `ScrollView` handles all vertical scrolling. This avoids gesture conflicts with ContentPanel's PanResponder.
- Horizontal `ScrollView` (`scrollEnabled={!isDragging}` — from DnD context).
- Each column: fixed width `Dimensions.get('window').width * 0.78` so next column peeks by ~22%.
- Column header: date formatted as `"Jun 28"` + `"Sat"` (abbreviated weekday).
- A thin vertical divider between columns.
- `onRemove` passes through date + slot key.

```ts
type AddPlaceInDateProps = {
  range: DateRange;
  byDate: Record<string, Record<VisitSlot, PlannedPlace[]>>;
  onAdd: (date: string, slot: VisitSlot) => void;
  onRemove: (date: string, slot: VisitSlot, id: string) => void;
};
```

---

### `PlanPlace` — `plan-place/PlanPlace.tsx`

```
┌──────────────────────────────────────────┐
│  Tokyo · Jun 28 – Jul 3                  │  ← Text, muted, from props
│                                          │
│  ┌ Flexible ──────────────── [+] ┐       │
│  │   (free AddPlaceField)        │       │
│  └────────────────────────────────┘      │
│                                          │
│  [ AddPlaceInDate horizontal grid ]      │
│                                          │
│  [← Back]                                │
│                                          │
│  ╔══════════════════════════════════╗    │  ← AddPlace overlay (position: absolute,
│  ║  AddPlace panel slides up here  ║    │     covers full PlanPlace area,
│  ╚══════════════════════════════════╝    │     visible when addTarget !== null)
└──────────────────────────────────────────┘
```

Props:
```ts
type PlanPlaceProps = {
  onBack: () => void;
  location: string;
  range: DateRange;
};
```

State (initialised from and mirrored to `createPlanCache.places`):
```ts
const [places, setPlaces] = useState<PlacesState>(() => createPlanCache.places);
const [addTarget, setAddTarget] = useState<SlotKey | null>(null);
```

`setPlaces` always mirrors to cache:
```ts
function updatePlaces(updater: (prev: PlacesState) => PlacesState) {
  setPlaces(prev => {
    const next = updater(prev);
    createPlanCache.places = next;
    return next;
  });
}
```

Return structure:
```tsx
<DndProvider onDrop={handleDrop}>
  <ScrollView>
    <Text>{summaryLine}</Text>
    <AddPlaceField label="Flexible" slotKey={{ kind: 'free' }} ... />
    <AddPlaceInDate ... />
    <Button onPress={onBack}>Back</Button>
  </ScrollView>
  {/* Ghost rendered by DndProvider as its last child, outside ScrollView */}
  <AddPlace
    visible={addTarget !== null}
    onDismiss={() => setAddTarget(null)}
    onSelect={handleAddPlaces}
  />
</DndProvider>
```

`CreatePlan.tsx` update:
```tsx
{step === 'places' && (
  <PlanPlace onBack={goBack} location={location} range={range} />
)}
```

---

## Drag-and-Drop Design

### Interaction Spec

```
Long-press card handle (≥400 ms)
  → haptic: light impact
  → source card fades to 0.3 opacity + dashed border placeholder (height preserved)
  → ghost clone appears at card's position (scale: 1.0 → 1.04, shadow deepens)

Drag (Pan gesture, simultaneous with LongPress)
  → ghost translateX/Y follows finger via Reanimated shared values (UI thread, no bridge)
  → hit-test drop zones on every frame via worklet
  → hovered slot: border highlight (accent color)
  → horizontal scroll in AddPlaceInDate locked while isDragging

Release
  → valid drop zone  → spring ghost into slot center (200 ms) → JS-thread state update → ghost hidden
  → invalid zone     → spring ghost back to origin → source card returns to full opacity
  → same-slot drop   → append to end (reorder not yet implemented; targetIndex logged for future use)
```

### Tech Stack

| Layer | API |
|-------|-----|
| Gesture detection | `LongPressGesture().minDuration(400)` + `PanGesture()` composed with `Gesture.Simultaneous()` from `react-native-gesture-handler` |
| Ghost position | `useSharedValue<number>(x/y)` + `useAnimatedStyle` from `react-native-reanimated` 4 |
| JS callbacks from worklet | `runOnJS()` to call `setState` / `onDrop` |
| Ghost view | `NativeOnlyAnimatedView` (already in `src/components/ui/`) |
| Drop zone registration | `onLayout` callback relative to `DndProvider` container — no async `measure()` |

### `DndProvider` — `plan-place/dnd/DndProvider.tsx`

```ts
type DropZoneEntry = {
  slotKey: SlotKey;
  rect: { x: number; y: number; width: number; height: number };
};

type DndContextValue = {
  isDragging: Readonly<SharedValue<boolean>>;
  registerDropZone: (key: SlotKey, rect: DropZoneEntry['rect']) => void;
  unregisterDropZone: (key: SlotKey) => void;
  startDrag: (place: PlannedPlace, sourceSlot: SlotKey) => void;
};
```

The Provider also renders the ghost as its **last child** (rendered after `{children}`, outside any `ScrollView`, inside the PlanPlace root View — which is inside ContentPanel's `overflow: hidden` but that's acceptable since DnD stays within the panel):

```tsx
export function DndProvider({ children, onDrop }: DndProviderProps) {
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);
  const ghostVisible = useSharedValue(false);
  // ...
  return (
    <DndContext.Provider value={...}>
      <View style={{ flex: 1 }} onLayout={captureContainerRect}>
        {children}
        {/* Ghost — always mounted, shown/hidden via opacity worklet */}
        <NativeOnlyAnimatedView pointerEvents="none" style={[ghostStyle, StyleSheet.absoluteFill]}>
          {ghostPlace && (
            <PlaceSlotCard place={ghostPlace} slotKey={{ kind: 'free' }} onRemove={() => {}} />
          )}
        </NativeOnlyAnimatedView>
      </View>
    </DndContext.Provider>
  );
}
```

Drop zone rects are measured relative to the `DndProvider` container via `onLayout` + a ref to the container, so they remain correct as the outer `ScrollView` scrolls (rects are updated on scroll via `onScroll`).

### `useDragCard` — `plan-place/dnd/useDragCard.ts`

```ts
function useDragCard(place: PlannedPlace, slotKey: SlotKey) {
  const { startDrag } = useDndContext();

  const longPress = Gesture.LongPress()
    .minDuration(400)
    .onStart((e) => {
      runOnJS(startDrag)(place, slotKey, { x: e.absoluteX, y: e.absoluteY });
    });

  const pan = Gesture.Pan()
    .onChange((e) => {
      // update ghostX/Y shared values directly in worklet
    })
    .onEnd(() => {
      // hit-test zones, runOnJS(onDrop) or runOnJS(cancelDrag)
    });

  const gesture = Gesture.Simultaneous(longPress, pan);
  return { gesture };  // spread onto <GestureDetector gesture={gesture}>
}
```

### `onDrop` signature (in PlanPlace)

```ts
function handleDrop(
  from: SlotKey,
  to: SlotKey,
  place: PlannedPlace,
  targetIndex?: number,   // reserved for within-slot reorder (deferred)
) {
  updatePlaces(prev => {
    // 1. remove from source
    // 2. insert at targetIndex (or append) in target
    // single setState call
  });
}
```

---

## Implementation Order

1. `plan-place/types.ts` + extend `createPlanCache`
2. `PlaceSlotCard` (leaf, no deps)
3. `AddPlaceField` (depends on PlaceSlotCard)
4. `AddPlace` (standalone overlay, depends on Input/Button/Badge/Text/NativeOnlyAnimatedView)
5. `DndProvider` + `useDragCard` (DnD infrastructure, no UI deps yet)
6. Wire DnD into `PlaceSlotCard` (`GestureDetector` + `isDragSource` fade)
7. Wire drop zone registration into `AddPlaceField` (`onLayout` + `registerDropZone`)
8. `AddPlaceInDate` (depends on AddPlaceField)
9. `PlanPlace` (assembles all, owns state, mounts AddPlace overlay)
10. `CreatePlan` (pass `location` + `range` to PlanPlace)

---

## UI Primitive Checklist

| Usage | Primitive |
|-------|-----------|
| Search bar in AddPlace | `Input` from `@/components/ui/input` |
| + button, × button, drag handle area | `Button variant="ghost" size="icon"` |
| Filter pills (inactive / active) | `Badge variant="outline"` / `Badge variant="default"` |
| All text | `Text` from `@/components/ui/text` |
| Ghost animated view | `NativeOnlyAnimatedView` from `@/components/ui/native-only-animated-view` |
| "Add N places" confirm | `Button size="lg" className="rounded-full"` |

---

## Remaining Architecture Issues

These issues were identified after tracing the full render tree. All must be addressed before or during implementation.

---

### Issue 1 — `reportScrollY` is never threaded to `CreatePlan` or `PlanPlace` [Critical]

**Root cause:** `MyPlan` receives `onScroll` from `HomePanel` (which maps to ContentPanel's `reportScrollY`). When `showCreatePlan` is true, MyPlan renders `<CreatePlan onClose=... bottomInset=... />` — the `onScroll` prop is silently dropped. ContentPanel's `scrollY.current` is stuck at whatever it was when the user opened create-plan mode. If they were at the top of MyPlan (the common case), `scrollY = 0`, and ContentPanel's PanResponder fires on **any downward drag** — collapsing the panel while the user is in PlanPlace.

**Fix:**
- Add `reportScrollY: (y: number) => void` to `MyPlan`'s props and thread it to `CreatePlan`
- Add `reportScrollY` to `CreatePlan`'s props and thread it to `PlanPlace`
- Add `reportScrollY` to `PlanPlace`'s props; call it from the outer `ScrollView`'s `onScroll`
- When `AddPlace` overlay is open, call `reportScrollY(1)` unconditionally to keep ContentPanel locked (prevents collapse while the search UI is open)

```ts
// PlanPlace
<ScrollView
  onScroll={e => {
    const y = addTarget ? 1 : e.nativeEvent.contentOffset.y;
    reportScrollY(y);
  }}
  scrollEventThrottle={16}
>
```

**Affected files:** `MyPlan.tsx`, `CreatePlan.tsx`, `PlanPlace.tsx`

---

### Issue 2 — RNGH `GestureDetector` + ContentPanel `PanResponder` conflict [Critical]

**Root cause:** ContentPanel uses old `PanResponder` for its drag-to-snap gesture. The DnD plan introduces RNGH `GestureDetector` (LongPress + Pan) on each `PlaceSlotCard`. When the user long-presses and then drags downward, ContentPanel's PanResponder (`onMoveShouldSetPanResponder: gs.dy > 4`) can also fire simultaneously, creating a race where the panel collapses mid-drag.

**Fix:** Suppress ContentPanel's PanResponder during a DnD gesture by calling `reportScrollY(1)` when the LongPress activates (keeping `scrollY.current > 0` so the PanResponder's condition fails):

```ts
// useDragCard.ts
const longPress = Gesture.LongPress()
  .minDuration(400)
  .onStart(() => {
    runOnJS(reportScrollY)(1);  // block ContentPanel collapse
    runOnJS(startDrag)(place, slotKey);
  });

// On drag end / cancel:
runOnJS(reportScrollY)(0);  // re-enable ContentPanel gesture
```

`reportScrollY` must be available inside `useDragCard` — either passed as an argument or exposed via `DndContext`.

---

### Issue 3 — Drop zone positions go stale as PlanPlace ScrollView scrolls [Critical]

**Root cause:** `onLayout` gives each `AddPlaceField` its Y offset within the ScrollView's **content** space, not screen space. The ghost's position from RNGH `absoluteY` is in **screen** space. When the user scrolls PlanPlace down 200 px, a drop zone at content-Y=300 is visually at screen-Y=100, but its registered rect still says Y=300. Hit-testing fails.

**Fix:** `DndProvider` must track both:
1. The ScrollView's screen-space Y origin (measure the ScrollView ref once via `ref.measure()` on mount)
2. The current scroll offset (from `onScroll`)

Corrected screen-space Y for a drop zone = `zone.contentY - scrollOffset + scrollViewScreenY`

Expose a `onScrollOffsetChange(y: number)` from `DndProvider` and call it from PlanPlace's `ScrollView.onScroll`. Ghost hit-test worklet reads `scrollOffset` via a SharedValue.

```ts
// DndProvider state
const scrollOffset = useSharedValue(0);

// PlanPlace
<ScrollView onScroll={e => {
  scrollOffset.value = e.nativeEvent.contentOffset.y;
  reportScrollY(addTarget ? 1 : e.nativeEvent.contentOffset.y);
}}>
```

---

### Issue 4 — `isDragging` SharedValue cannot drive `scrollEnabled` prop [Moderate]

**Root cause:** Reanimated `SharedValue` changes happen on the UI thread and do not trigger React re-renders. `scrollEnabled` on a `ScrollView` is a React prop — it only updates on re-render. `scrollEnabled={!isDragging.value}` would read a stale value.

**Fix:** Mirror the SharedValue to a JS-thread boolean state via `useAnimatedReaction`:

```ts
// In AddPlaceInDate (or DndProvider)
const [isScrollLocked, setIsScrollLocked] = useState(false);

useAnimatedReaction(
  () => isDragging.value,
  (dragging) => runOnJS(setIsScrollLocked)(dragging),
);

<ScrollView horizontal scrollEnabled={!isScrollLocked} ...>
```

This adds ~1 JS-thread tick of lag to the scroll lock, which is imperceptible.

---

### Issue 5 — `createPlanCache.places` not reset when CreatePlan reopens [Moderate]

**Root cause:** `createPlanCache` is a module-level singleton. If the user dismisses CreatePlan (e.g. presses "Discard") and opens it again, `createPlanCache.places` still holds the previous session's data. `location` and `range` have the same issue (pre-existing).

**Fix:** Reset in `CreatePlan` on mount:

```ts
useEffect(() => {
  createPlanCache.location = '';
  createPlanCache.range = { start: null, end: null };
  createPlanCache.places = { free: [], byDate: {} };
}, []);
```

---

### Issue 6 — AddPlace overlay covers Input but has no keyboard avoidance [Moderate]

**Root cause:** AddPlace is a `position: absolute` overlay within PlanPlace. When the user taps the `Input` search bar, the soft keyboard rises from the bottom — potentially covering the Input and/or the results list. There is no `KeyboardAvoidingView` wrapping the overlay.

**Fix:** Wrap AddPlace's content in `KeyboardAvoidingView behavior="padding"` on iOS:

```tsx
<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
  <Input ... />
  <FlatList ... />
  <Button>Add N places</Button>
</KeyboardAvoidingView>
```

---

### Issue 7 — No UUID package in `package.json` [Moderate]

**Root cause:** The plan mentions `nanoid` for generating unique instance IDs on `PlannedPlace`, but `nanoid` is not in `package.json`. Installing a new dependency for one function is unnecessary.

**Fix:** Use `crypto.randomUUID()` which is available in React Native's Hermes engine (the project's runtime):

```ts
// plan-place/types.ts
export const newPlannedPlace = (place: PlaceDetail): PlannedPlace => ({
  id: crypto.randomUUID(),
  placeId: place.id,
  name: place.name,
  subtitle: place.subtitle,  // from base Place type — already has this field
});
```

Note: `place.subtitle` comes from the base `Place` type (which `PlaceDetail` extends) — no special mapping needed.

---

### Issue 8 — `enumerateDates` in `types.ts` [Minor]

**Root cause:** `types.ts` should only export type/interface definitions. A runtime utility function doesn't belong there.

**Fix:** Move `enumerateDates` to `plan-place/utils.ts`.

---

## Known Limitations (documented, not blocking)

- **Ghost clipped at ContentPanel edge**: Ghost is inside ContentPanel's `overflow: hidden`. If a card is dragged very near the panel's top edge, it will be clipped. Acceptable for now — DnD stays within the panel. Properly fix later by lifting ghost to HomeScreen via a portal.
- **Within-slot reorder**: Deferred. `targetIndex` is already in the `onDrop` signature; only the insertion logic is missing.
- **State is lost if the app is backgrounded**: `createPlanCache` is in-memory only.
