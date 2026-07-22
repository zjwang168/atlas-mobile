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

## Camera

The camera is controlled programmatically via a `MapboxGL.Camera` ref. `centerCoordinate` and `zoomLevel` changes trigger a smooth 500ms re-center. `HomeScreen` passes the mean of all route points as `centerCoordinate` when a route is active.

`HomeScreen` derives the `padding` prop's `paddingBottom` from the active bottom panel's last settled snap group state (via `ContentPanel`'s exported `SNAP_HEIGHTS`), not a fixed constant — so a discrete recenter (e.g. selecting a different marker while `PlaceDetail` is open at a non-default snap height) keeps the map's visible focus matched to whatever height the panel currently occupies, whether `compact`, `default`, or `full`. Continuous drag tracking still goes through `setPaddingBottom` on the ref.

## Map Style

Currently `MapboxGL.StyleURL.Street`. Other options: `Outdoors`, `Light`, `Dark`, `Satellite`, `SatelliteStreet`, or a custom `mapbox://styles/…` URL.

## Marker Customization

Markers are rendered as `MapboxGL.MarkerView` with a custom React Native `View`. Edit the `marker` style in `MapboxMap.tsx` to change size, color, or shape. For large marker counts (>100), switch to `MapboxGL.ShapeSource` + `MapboxGL.SymbolLayer` for better performance.
