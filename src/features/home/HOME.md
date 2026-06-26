# Home Feature

## Overview

The home screen is the root of the app. It layers a full-screen map, a draggable content panel, a place-detail overlay, and a bottom navigation bar. All state that needs to cross these layers (active tab, parse results, selected place) lives in `HomeScreen` and is passed down as props.

## File Structure

```
src/features/home/
  HomeScreen.tsx   ← root screen: map + panel + place detail + bottom bar
  HomePanel.tsx    ← content panel switcher: My Places vs Plan Mode
```

## Component Hierarchy

```
HomeScreen
├── MapboxMap               ← full-screen, behind everything
├── HomePanel               ← draggable bottom content panel
│   ├── MyPlaces            ← active when tab = 'myPlaces'
│   └── PlanMode            ← active when tab = 'travelPlan'
├── PlaceDetail             ← overlay, slides up when a place is selected
└── BottomBar               ← tab pill + add-place button, always on top
```

## State Ownership

All shared state lives in `HomeScreen`:

| State | Purpose |
|---|---|
| `selectedPlaceName` | Drives the PlaceDetail overlay (null = hidden) |
| `activeTab` | Switches HomePanel between My Places and Plan Mode |
| `parseResult` | Route data from the backend parse flow |
| `isLoading / error` | Loading and error state for the parse flow |
| `messages` | Chat message thread shown in Plan Mode |

## Parse-Route Flow

The parse flow (submit URL → backend → route on map) is owned by `HomeScreen`. The entry point (currently a placeholder) will live inside `PlanMode`. When a URL is submitted:

1. `PlanMode` calls up via a prop callback
2. `HomeScreen` calls `parseLink()` and updates `parseResult`, `messages`, `isLoading`, `error`
3. The new route is reflected on `MapboxMap` and in `PlanMode`'s message thread

## Navigation

`HomeScreen` receives `onOpenImport` from `App.tsx` to open the import overlay. No router is used — App.tsx manages screen-level overlays directly.
