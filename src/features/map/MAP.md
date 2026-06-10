# Mapbox Integration Guide

## Part 1: Changes Summary — Migrating from `react-native-maps` to `@rnmapbox/maps`

The following documents all changes made to replace the original Apple Maps (`react-native-maps`) implementation with Mapbox (`@rnmapbox/maps`).

### Files Created

| File | Purpose |
|------|---------|
| `src/features/map/MapboxMap.tsx` | Reusable Mapbox map component with marker rendering, camera controls, and loading/error states |

### Files Modified

| File | What Changed |
|------|-------------|
| `App.tsx` | Wrapped `HomeScreen` in `MapErrorBoundary` to catch native module rendering errors gracefully |
| `src/features/home/HomeScreen.tsx` | Replaced `<MapView>` / `<Marker>` from `react-native-maps` with `<MapboxMap>` component. Removed `BottomSheet` and profile/action buttons. Added a floating "OurAtlas" info card at the bottom. |
| `app.config.js` | Added `@rnmapbox/maps` plugin config `{ RNMapboxMapsImpl: 'mapbox' }` and `extra.mapboxAccessToken` from `.env` |
| `package.json` | Replaced `react-native-maps` with `@rnmapbox/maps@^10.3.1` |
| `.env` | Added `MAPBOX_ACCESS_TOKEN` (public token for map rendering) |

### Architecture Changes

**Before** (`react-native-maps`):
```
HomeScreen
├── MapView (Apple Maps via react-native-maps)
│   └── Marker (native pin annotations)
├── BottomSheet (draggable list via @gorhom/bottom-sheet)
│   └── place rows list
└── Floating bottom bar (search + profile + import buttons)
```

**After** (`@rnmapbox/maps`):
```
HomeScreen
├── MapboxMap
│   ├── MapboxGL.MapView (Mapbox Streets style)
│   ├── MapboxGL.Camera (programmatic navigation)
│   └── MapboxGL.MarkerView (custom React Native marker views)
└── Floating info card ("OurAtlas — 2 places to explore")
```

### Dependency Changes

- **Removed**: `react-native-maps` (Apple Maps)
- **Added**: `@rnmapbox/maps@^10.3.1` (Mapbox SDK v11.20.1 for iOS)
- **Kept**: `@gorhom/bottom-sheet` (removed from HomeScreen but still available for future use)

### Build & Configuration Changes

1. **`app.config.js`**: Added the `@rnmapbox/maps` Expo plugin with `RNMapboxMapsImpl: 'mapbox'` to use the official Mapbox native SDK
2. **Environment variables**: `MAPBOX_ACCESS_TOKEN` is loaded from `.env` and injected into `Constants.expoConfig.extra.mapboxAccessToken`
3. **iOS native project**: `npx expo prebuild --clean` generates the `ios/` directory with `@rnmapbox/maps` pod dependencies (MapboxCommon, MapboxCoreMaps, MapboxMaps)

---

## Part 2: Customizing Map Markers, Icons & Visual Design

### Current Marker Implementation

Markers in `MapboxMap.tsx` are rendered as `MapboxGL.MarkerView` components — these allow embedding **custom React Native views** directly on the map:

```tsx
<MapboxGL.MarkerView
  key={marker.id}
  coordinate={[marker.longitude, marker.latitude]}
>
  <View style={styles.markerContainer}>
    <View style={styles.marker} />
  </View>
</MapboxGL.MarkerView>
```

### Customizing Marker Appearance

#### 1. Change the Pin Style (Colors, Shape, Shadow)

Edit the `marker` style in `MapboxMap.tsx`:

```tsx
marker: {
  width: 24,           // pin diameter
  height: 24,
  borderRadius: 12,    // circular; use 4 for rounded square
  backgroundColor: '#007AFF', // Mapbox blue
  borderWidth: 3,
  borderColor: '#FFFFFF',
  // Shadow (iOS)
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.3,
  shadowRadius: 4,
  // Shadow (Android)
  elevation: 5,
},
```

#### 2. Add an Icon / Image Inside the Pin

Replace the plain `View` with an image or emoji:

```tsx
<MapboxGL.MarkerView coordinate={[lng, lat]}>
  <View style={markerStyles.pin}>
    <Text style={markerStyles.pinEmoji}>📍</Text>
  </View>
</MapboxGL.MarkerView>
```

Or use a custom image:

```tsx
import { Image } from 'react-native';

<MapboxGL.MarkerView coordinate={[lng, lat]}>
  <Image
    source={require('../../assets/custom-marker.png')}
    style={{ width: 32, height: 32 }}
  />
</MapboxGL.MarkerView>
```

#### 3. Different Marker Styles by Category

```tsx
const getMarkerStyle = (category: string) => {
  switch (category) {
    case 'restaurant':
      return { backgroundColor: '#FF6B6B', emoji: '🍽️' };
    case 'park':
      return { backgroundColor: '#51CF66', emoji: '🌳' };
    case 'museum':
      return { backgroundColor: '#748FFC', emoji: '🏛️' };
    default:
      return { backgroundColor: '#007AFF', emoji: '📍' };
  }
};
```

### Icon / Image Resources

- Use PNG or SVG assets in `assets/` directory
- Recommended marker size: **32×32 to 48×48 points** (retina @2x/@3x)
- For SVG support, the project includes `react-native-svg`

### Using Mapbox Style Layers (Advanced)

For performance with many markers (>100), use `MapboxGL.ShapeSource` + `MapboxGL.SymbolLayer` instead of individual `MarkerView` components:

```tsx
<MapboxGL.ShapeSource id="places" shape={geoJsonData}>
  <MapboxGL.SymbolLayer
    id="place-icons"
    style={{
      iconImage: 'marker-15',
      iconSize: 1.5,
      iconColor: '#007AFF',
      textField: ['get', 'name'],
      textSize: 12,
      textOffset: [0, -2],
    }}
  />
</MapboxGL.ShapeSource>
```

### Changing the Map Style

The current style is `MapboxGL.StyleURL.Street`. Other built-in options:

```tsx
MapboxGL.StyleURL.Street       // default, detailed roads & labels
MapboxGL.StyleURL.Outdoors     // terrain with contour lines
MapboxGL.StyleURL.Light        // subtle, light background
MapboxGL.StyleURL.Dark         // dark mode
MapboxGL.StyleURL.Satellite    // satellite imagery
MapboxGL.StyleURL.SatelliteStreet // satellite + road overlay
```

Or use a custom Mapbox style URL:

```tsx
styleURL="mapbox://styles/your-username/ckxxxxxx"
```

### A lot more design change we can make. To be discovered.

---

## Access Token Setup

> **Note for the team**: The Mapbox access token will be shared in the group chat.
>
> To use it locally:
> 1. Create a `.env` file in the project root (if not present)
> 2. Add the following line:
> ```
> MAPBOX_ACCESS_TOKEN=pk.eyJ...your-token-here
> ```
> 3. Run `npx expo prebuild --clean` (first time only) then `npx expo run:ios`
>
> ⚠️ `.env` is gitignored — do not commit it. Only the public token (`pk.`) is used for rendering; no secret token is needed for local development.
