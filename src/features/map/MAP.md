# Map Feature

## Overview

`MapboxMap` is a full-screen map component built on `@rnmapbox/maps`. It renders place markers, an optional route polyline, and handles camera positioning. Used exclusively by `HomeScreen`.

## File Structure

```
src/features/map/
  MapboxMap.tsx    ← map component
  MAP.md           ← this document
```

## Shared Constants

`src/utils/constants.ts` defines the defaults used throughout the map feature. Import from there instead of inlining values:

```ts
import {
  DEFAULT_MAP_CENTER,  // [-122.3321, 47.6062] — Seattle [lng, lat]
  DEFAULT_ZOOM_LEVEL,  // 12
  ROUTE_LINE_COLOR,    // '#007AFF'
  ROUTE_LINE_WIDTH,    // 4
  API_BASE_URL,        // 'http://localhost:8000'
} from '@/utils/constants';
```

> Note: `MapboxMap.tsx` currently inlines these values directly. When touching this file, migrate to the constants import.

## Props

```ts
interface MapboxMapProps {
  markers: MapMarker[];                              // default place markers
  centerCoordinate?: [number, number];               // [longitude, latitude], default: Seattle
  zoomLevel?: number;                                // default: 12
  style?: ViewStyle;
  onMarkerPress?: (marker: MapMarker) => void;
  routeGeoJSON?: GeoJSON.Feature<GeoJSON.LineString>; // draws a polyline when provided
  routeMarkers?: MapMarker[];                        // replaces markers when a route is active
  padding?: MapPadding;                              // camera padding; discrete changes animate over 500ms
  selectedMarkerId?: string | null;
  showUserLocation?: boolean;                        // default: false — draws the current-position puck
}

interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
  description?: string;
}

interface MapboxMapHandle {
  setPaddingBottom: (paddingBottom: number, durationMs?: number) => void; // imperative camera padding update via ref, bypassing React re-render; default 300ms ease
  flyTo: (coordinate: [number, number], zoomLevel?: number) => void;      // one-off recenter
}
```

`MapboxMap` is wrapped in `React.memo` and exposes `MapboxMapHandle` via `forwardRef`. Callers that need to track a fast-changing value (e.g. a draggable panel's height, reported every animation frame) should call `ref.current.setPaddingBottom(value)` directly instead of feeding it through the `padding` prop — pushing a per-frame value through props would re-render the whole component tree and fight the `padding` prop's own 500ms-animated `setCamera` call. See `HomeScreen.tsx`'s `handlePanelHeightChange` for the reference usage: it keeps the panel height in a ref (not state) and only recomputes the `padding` prop on the rare, discrete event of the panel's visibility toggling.

`setPaddingBottom`'s default 300ms ease is intentional: called on every animation frame during a panel drag, each call re-targets the in-flight camera animation before the previous one finishes, so the map visibly trails the panel edge by a beat rather than snapping to it instantly. Pass `durationMs: 0` for an immediate, non-lagging update if a future caller needs 1:1 tracking.

## Access Token

The Mapbox public token is loaded from `.env` (`MAPBOX_ACCESS_TOKEN`) and injected via `app.config.js` into `Constants.expoConfig.extra.mapboxAccessToken`. The `.env` file is gitignored — share the token via the group chat.

Setup:
1. Create `.env` in the project root
2. Add `MAPBOX_ACCESS_TOKEN=pk.eyJ...`
3. Run `npx expo prebuild --clean` (first time only), then `npx expo run:ios`

## Route Data Source

Route data (`ParseResult`, `GeocodedLocation`) comes from `src/services/api/apiService.ts`:

```ts
import { parseLink } from '@/services/api/apiService';
// ParseResult type: src/types/route.ts
```

`HomeScreen` calls `parseLink(url)`, converts the result to `MapMarker[]` and `GeoJSON.LineString`, and passes them as props to `MapboxMap`. See `HOME.md` for the full data flow.

## Route Rendering

When `routeGeoJSON` is provided, a blue polyline is drawn via `MapboxGL.ShapeSource` + `MapboxGL.LineLayer`. When `routeMarkers` is provided it replaces the default `markers` array — so only route stops are shown while a route is active.

## User Location

`showUserLocation` draws `MapboxGL.LocationPuck` — pass it only once location permission is granted. Rendering the puck without permission makes Mapbox raise its own permission request, bypassing `locationService` and the fallback it guarantees. `HomeScreen` gates it on `useHome().locationStatus === 'granted'`.

`flyTo` is imperative rather than a prop because a "locate me" tap is an event, not state: routing it through `centerCoordinate` would make a second tap on an unchanged coordinate do nothing. It keeps the prop-diffing refs in step so a later `centerCoordinate` change still recenters.

## Camera

The camera is controlled programmatically via a `MapboxGL.Camera` ref. `centerCoordinate` and `zoomLevel` changes trigger a smooth 500ms re-center. `HomeScreen` passes the mean of all route points as `centerCoordinate` when a route is active.

`HomeScreen` derives the `padding` prop's `paddingBottom` from the active bottom panel's last settled snap group state (via `ContentPanel`'s exported `SNAP_HEIGHTS`), not a fixed constant — so a discrete recenter (e.g. selecting a different marker while `PlaceDetail` is open at a non-default snap height) keeps the map's visible focus matched to whatever height the panel currently occupies, whether `compact`, `default`, or `full`. Continuous drag tracking still goes through `setPaddingBottom` on the ref.

## Map Style

Currently `MapboxGL.StyleURL.Street`. Other options: `Outdoors`, `Light`, `Dark`, `Satellite`, `SatelliteStreet`, or a custom `mapbox://styles/…` URL.

## Marker Rendering

Markers render in two tiers, and which tier a marker lands in is decided by `rendersAsLayer()` from the marker data alone — never from the camera.

**Layer tier — the ordinary `saved` and `recommended` pins.** A clustered `ShapeSource` feeding two `CircleLayer`s (cluster bubbles and individual dots) and two `SymbolLayer`s (the cluster count and the pin's name). Clustering, placement, and label collision all happen inside the map engine.

**Annotation tier — `MarkerView`, for the few pins a layer cannot express**: the selected pin, the one being deleted, one carrying a popup, the numbered Atlas route pins, the Home/Office/School glyphs, and anything mid-animation (`entering`/`pulsing`). These keep the React `MarkerDot` with its Reanimated transitions.

The split is what fixes the blink and the drift, and both had the same shape of cause. A `MarkerView` is a real native view mounted by React: change its key and React destroys and recreates it, which reads as a pin vanishing and popping back; change its `coordinate` and it moves. The previous implementation clustered in JavaScript from the current viewport, so a pin's key flipped between `point:…` and `cluster:…` whenever the camera crossed a zoom threshold or a member joined a group, and coincident pins were given viewport-derived display coordinates that were recomputed at every settle. A layer has no key and no per-pin view, so neither failure mode exists.

Adding a marker type: if it needs animation, a popup, or a glyph, exclude it in `rendersAsLayer()` so it renders as an annotation. Otherwise let it fall through to the layer tier — that tier scales to thousands of points, and the annotation tier does not.

Tapping is handled per tier: the annotation tier uses `onTouchEnd` on the marker's own view, while the layer tier reads the feature under the finger from `ShapeSource`'s `onPress`. A tapped cluster asks the engine for its expansion zoom rather than fitting bounds computed here. Both stamp the same press timestamp, so a pin tap is not also read as a tap on the map beneath it.

Colour and size live in the layer styles in `MapboxMap.tsx` for the layer tier, and in the `marker` style for the annotation tier. The two are kept visually in step by hand; they are not derived from one source.
