# Map Feature

## Overview

`MapboxMap` is a full-screen map component built on `@rnmapbox/maps`. It renders place markers, an optional route polyline, and handles camera positioning. Used exclusively by `HomeScreen`.

## File Structure

```
src/features/map/
  MapboxMap.tsx    ← map component
  MAP.md           ← this document
```

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
}

interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
  description?: string;
}
```

## Access Token

The Mapbox public token is loaded from `.env` (`MAPBOX_ACCESS_TOKEN`) and injected via `app.config.js` into `Constants.expoConfig.extra.mapboxAccessToken`. The `.env` file is gitignored — share the token via the group chat.

Setup:
1. Create `.env` in the project root
2. Add `MAPBOX_ACCESS_TOKEN=pk.eyJ...`
3. Run `npx expo prebuild --clean` (first time only), then `npx expo run:ios`

## Route Rendering

When `routeGeoJSON` is provided, a blue polyline is drawn via `MapboxGL.ShapeSource` + `MapboxGL.LineLayer`. When `routeMarkers` is provided it replaces the default `markers` array — so only route stops are shown while a route is active.

## Camera

The camera is controlled programmatically via a `MapboxGL.Camera` ref. `centerCoordinate` and `zoomLevel` changes trigger a smooth 500ms re-center. `HomeScreen` passes the mean of all route points as `centerCoordinate` when a route is active.

## Map Style

Currently `MapboxGL.StyleURL.Street`. Other options: `Outdoors`, `Light`, `Dark`, `Satellite`, `SatelliteStreet`, or a custom `mapbox://styles/…` URL.

## Marker Customization

Markers are rendered as `MapboxGL.MarkerView` with a custom React Native `View`. Edit the `marker` style in `MapboxMap.tsx` to change size, color, or shape. For large marker counts (>100), switch to `MapboxGL.ShapeSource` + `MapboxGL.SymbolLayer` for better performance.
