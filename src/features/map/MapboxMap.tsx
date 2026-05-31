import MapboxGL from '@rnmapbox/maps';
import Constants from 'expo-constants';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native';

/**
 * Mapbox access token retrieval strategy:
 * 1. Primary: Constants.expoConfig.extra.mapboxAccessToken (from app.config.js)
 * 2. Fallback: process.env.MAPBOX_ACCESS_TOKEN (from .env loaded at build time)
 *
 * The token is stored in .env (gitignored) and injected via app.config.js.
 */
const MAPBOX_ACCESS_TOKEN: string =
  (Constants.expoConfig?.extra?.mapboxAccessToken as string) ||
  (process.env.MAPBOX_ACCESS_TOKEN as string) ||
  '';

// ---- Types ----

/** Represents a single marker on the map */
export interface MapMarker {
  /** Unique identifier for the marker */
  id: string;
  /** Latitude coordinate */
  latitude: number;
  /** Longitude coordinate */
  longitude: number;
  /** Display title shown when marker is tapped */
  title?: string;
  /** Optional subtitle/description */
  description?: string;
}

/** Props for the MapboxMap component */
interface MapboxMapProps {
  /** Array of markers to display on the map */
  markers: MapMarker[];
  /** Initial camera center coordinates [longitude, latitude] (Mapbox uses [lng, lat]) */
  centerCoordinate?: [number, number];
  /** Initial zoom level (default: 12) */
  zoomLevel?: number;
  /** Additional styles for the map container */
  style?: ViewStyle;
  /** Callback when a marker is pressed */
  onMarkerPress?: (marker: MapMarker) => void;

  /** Optional GeoJSON LineString to render a route polyline on the map */
  routeGeoJSON?: GeoJSON.Feature<GeoJSON.LineString>;
  /** Optional re-ordered markers to display along the route (overrides `markers` when set) */
  routeMarkers?: MapMarker[];
}

// ---- Component ----

/**
 * A reusable Mapbox-powered map component.
 * Renders a full-screen map with customizable markers.
 */
const MapboxMap: React.FC<MapboxMapProps> = ({
  markers,
  centerCoordinate = [-122.3321, 47.6062], // Default: Seattle [lng, lat]
  zoomLevel = 12,
  style,
  onMarkerPress,
  routeGeoJSON,
  routeMarkers,
}) => {
  // Use routeMarkers if provided, otherwise fall back to the regular markers
  const displayMarkers = routeMarkers ?? markers;
  const { width, height } = useWindowDimensions();
  const cameraRef = useRef<MapboxGL.Camera>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Set Mapbox access token once when the component mounts.
    // Using try/catch to prevent native module initialization failures
    // from crashing the entire JS thread.
    try {
      if (!MAPBOX_ACCESS_TOKEN) {
        const errMsg =
          'Mapbox access token is missing. Please ensure MAPBOX_ACCESS_TOKEN is set in .env and rebuild.';
        console.error('[MapboxMap] ' + errMsg);
        setError(errMsg);
        return;
      }
      MapboxGL.setAccessToken(MAPBOX_ACCESS_TOKEN);
      console.log('[MapboxMap] Access token configured successfully');
      setIsReady(true);
    } catch (err) {
      const errMsg =
        'Failed to set Mapbox access token: ' +
        (err instanceof Error ? err.message : String(err));
      console.error('[MapboxMap]', errMsg);
      setError(errMsg);
    }
  }, []);

  useEffect(() => {
    // Recenter the camera when centerCoordinate changes
    if (cameraRef.current) {
      cameraRef.current.setCamera({
        centerCoordinate,
        zoomLevel,
        animationDuration: 500,
      });
    }
  }, [centerCoordinate, zoomLevel]);

  // Show loading state while Mapbox is initializing
  if (error) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorText}>Map failed to load</Text>
        <Text style={styles.errorDetail}>{error}</Text>
      </View>
    );
  }

  if (!isReady) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading map...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <MapboxGL.MapView
        style={{ width, height }}
        styleURL={MapboxGL.StyleURL.Street}
        compassEnabled={true}
        logoEnabled={false}
        attributionEnabled={true}
      >
        {/* Camera controller for programmatic navigation */}
        <MapboxGL.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate,
            zoomLevel,
          }}
        />

        {/* Render route polyline (if provided) */}
        {routeGeoJSON && (
          <MapboxGL.ShapeSource id="routeSource" shape={routeGeoJSON}>
            <MapboxGL.LineLayer
              id="routeLine"
              style={{
                lineColor: '#007AFF',
                lineWidth: 4,
                lineOpacity: 0.8,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapboxGL.ShapeSource>
        )}

        {/* Render markers (routeMarkers if provided, otherwise markers) */}
        {displayMarkers.map((marker) => (
          <MapboxGL.MarkerView
            key={marker.id}
            coordinate={[marker.longitude, marker.latitude]}
          >
            <View
              style={styles.markerContainer}
              onTouchEnd={() => onMarkerPress?.(marker)}
            >
              <View style={styles.marker} />
            </View>
          </MapboxGL.MarkerView>
        ))}
      </MapboxGL.MapView>
    </View>
  );
};

// ---- Styles ----

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  map: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#007AFF',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  errorDetail: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
    marginHorizontal: 40,
    lineHeight: 18,
  },
  loadingText: {
    fontSize: 14,
    color: '#999',
    marginTop: 12,
  },
});

export default MapboxMap;
