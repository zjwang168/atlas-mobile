# Atlas Builder

## Overview

`AtlasBuilder` is the full-screen map-first editor for creating or editing an Atlas — search, AI place recommendations, itinerary ordering, and time/transport scheduling, all backed by a shared map surface via `useHome().setAtlasMapState`.

## File Structure

```
src/features/my-plan/atlas-builder/
  AtlasBuilder.tsx        ← orchestration: state, effects, search/save/persist handlers, top-level render
  types.ts                ← DraftPlace, AtlasSavedMapView, SearchResult, FocusArea, AtlasBuilderProps
  constants.ts             ← TRANSPORT_OPTIONS, PLANNING_HOURS, camera/search tuning constants
  utils.ts                 ← pure geo/bounds/text helpers (no React, no component state)
  mappers.ts                ← DraftPlace <-> SavedPlace/AtlasPlace row conversions
  styles.ts                ← shared StyleSheet, imported by every component below
  FocusAreas.tsx            ← auto-scrolling saved-location list on the Create landing screen
  AtlasEmptySkeleton.tsx    ← placeholder/typewriter hint shown before the first place is added
  AtlasCandidateCard.tsx    ← the floating "selected place" card above the list
  AtlasItem.tsx             ← one itinerary row (swipe-to-delete, drag-to-reorder, note button)
  InsertControls.tsx        ← "Add time" / "Add transport" inline row buttons
  TimePickerModal.tsx       ← day/time picker sheet
  TransportPickerModal.tsx  ← transport-mode picker sheet
```

Presentational pieces (`FocusAreas`, `AtlasEmptySkeleton`, `AtlasCandidateCard`, `AtlasItem`, `InsertControls`, the two modals) take only props and read no `AtlasBuilder` state directly — `AtlasBuilder.tsx` itself owns all state, effects, and service calls, and passes data/callbacks down.

## Behaviour

### Status

- **Create landing**: no `atlasId`, not `started`, nothing added yet — shows "Simple Start" plus `FocusAreas`.
- **Started / editing**: search-driven map with the floating `AtlasCandidateCard`, empty-state skeleton until the first place is added, then the itinerary list.
- **Saving**: `savingKind` is `'atlas'` or `'ai'` while `persist()` runs; markers lose their labels and the footer buttons show a spinner.

Two non-blocking suggestion prompts can appear over the map: a "local must-sees" note the first time an AI-recommended pin lands, and a "more nearby must-sees" prompt after idling on a viewport — the two never stack (the must-sees note takes priority and postpones the nearby prompt).

## API

```ts
type AtlasBuilderProps = {
  onClose: () => void;
  onSaved: (atlasId: string, askAI: boolean, mapView?: AtlasSavedMapView) => void;
  atlasId?: string;                          // present when editing an existing Atlas
  initialCandidates?: DraftPlace[];
  initialItems?: DraftPlace[];
  initialCenter?: [number, number];
  initialBounds?: { ne: [number, number]; sw: [number, number] };
  initialLocation?: string;
  started?: boolean;
  autoFocusCreateSearch?: boolean;
  onItemsChange?: (items: DraftPlace[]) => void;
  onFirstPlaceAdded?: () => void;
  onBuildPlan?: (location: string, candidates: DraftPlace[], center?: [number, number], bounds?: { ne: [number, number]; sw: [number, number] }) => void;
  onReturnToCreateSearch?: () => void;
};

export type DraftPlace = /* ...see types.ts */;        // in-progress Atlas place, saved/recommended/search-sourced
export type AtlasSavedMapView = /* ...see types.ts */;  // camera + marker snapshot handed to the completed Atlas on save
```

`DraftPlace` and `AtlasSavedMapView` are re-exported from `AtlasBuilder.tsx` for backward compatibility with existing imports (`MyPlan.tsx` imports both from `./atlas-builder/AtlasBuilder`).

## Related docs

- [MY-PLAN.md](../MY-PLAN.md) — `MyPlan.tsx`, which mounts this editor
- [ATLAS-DETAIL.md](../../my-places/atlas/atlas-detail/ATLAS-DETAIL.md) — the overlay shown immediately after saving
