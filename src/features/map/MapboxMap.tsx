import MapboxGL from '@rnmapbox/maps';
import Constants from 'expo-constants';
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MAPBOX_ACCESS_TOKEN: string =
  (Constants.expoConfig?.extra?.mapboxAccessToken as string) ||
  (process.env.MAPBOX_ACCESS_TOKEN as string) ||
  '';

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
  description?: string;
}

export type MapPadding = {
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
};

interface MapboxMapProps {
  markers: MapMarker[];
  centerCoordinate?: [number, number];
  zoomLevel?: number;
  style?: ViewStyle;
  onMarkerPress?: (marker: MapMarker) => void;
  routeGeoJSON?: GeoJSON.Feature<GeoJSON.LineString>;
  routeMarkers?: MapMarker[];
  /** Camera padding to offset the map center (e.g., when a bottom panel is visible) */
  padding?: MapPadding;
  selectedMarkerId?: string | null;
  /** Draw the current-position puck. Only pass true once location permission
      is granted — see the render site. */
  showUserLocation?: boolean;
}

// Small ease applied to every live padding update so the map visibly trails
// the panel edge by a beat instead of snapping to it 1:1 every frame.
const PADDING_FOLLOW_DURATION_MS = 300;

/** Close enough to read street names when recentring on the user. */
const LOCATE_ZOOM_LEVEL = 15;
const LOCATE_ANIMATION_MS = 800;

export interface MapboxMapHandle {
  /**
   * Update bottom camera padding directly via the camera ref, bypassing React
   * state/re-render entirely. Used for per-frame panel-drag tracking, where
   * pushing every frame through props would re-render the whole map tree.
   * Each call re-targets a short (300ms) ease, so rapid successive calls
   * naturally produce a lagging "follow" motion rather than an instant jump.
   */
  setPaddingBottom: (paddingBottom: number, durationMs?: number) => void;
  /**
   * Recenter on a coordinate as a one-off. Imperative for the same reason as
   * `setPaddingBottom`: a "locate me" tap is an event, not a piece of state,
   * and routing it through `centerCoordinate` would make a repeat tap on an
   * unchanged coordinate do nothing.
   */
  flyTo: (coordinate: [number, number], zoomLevel?: number) => void;
}

const MapboxMap = forwardRef<MapboxMapHandle, MapboxMapProps>(function MapboxMap({
  markers,
  centerCoordinate = [-122.3321, 47.6062],
  zoomLevel = 12,
  style,
  onMarkerPress,
  routeGeoJSON,
  routeMarkers,
  padding,
  selectedMarkerId,
  showUserLocation = false,
}, ref) {
  const displayMarkers = routeMarkers ?? markers;
  const { width, height } = useWindowDimensions();
  const { top: safeTop } = useSafeAreaInsets();
  // Dormant — the compass is disabled below, so nothing renders at this
  // position. Kept so re-enabling it drops the compass clear of the top
  // overlay row instead of underneath it.
  const compassTop = safeTop + 48;
  const cameraRef = useRef<MapboxGL.Camera>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (!MAPBOX_ACCESS_TOKEN) {
        setError('Mapbox access token is missing. Check MAPBOX_ACCESS_TOKEN in .env and rebuild.');
        return;
      }
      MapboxGL.setAccessToken(MAPBOX_ACCESS_TOKEN);
      setIsReady(true);
    } catch (err) {
      setError('Failed to initialise Mapbox: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, []);

  const prevCenterRef = useRef(centerCoordinate);
  const prevZoomRef = useRef(zoomLevel);
  const prevPaddingRef = useRef(padding);
  useEffect(() => {
    const [lng, lat] = centerCoordinate;
    const [prevLng, prevLat] = prevCenterRef.current;
    const centerChanged = lng !== prevLng || lat !== prevLat;
    const zoomChanged = zoomLevel !== prevZoomRef.current;
    const paddingChanged =
      padding?.paddingBottom !== prevPaddingRef.current?.paddingBottom ||
      padding?.paddingTop !== prevPaddingRef.current?.paddingTop ||
      padding?.paddingLeft !== prevPaddingRef.current?.paddingLeft ||
      padding?.paddingRight !== prevPaddingRef.current?.paddingRight;
    if (!centerChanged && !zoomChanged && !paddingChanged) return;
    prevCenterRef.current = centerCoordinate;
    prevZoomRef.current = zoomLevel;
    prevPaddingRef.current = padding;
    cameraRef.current?.setCamera({
      centerCoordinate,
      zoomLevel,
      animationDuration: 2000,
      padding,
    });
  }, [centerCoordinate, zoomLevel, padding]);

  useImperativeHandle(ref, () => ({
    setPaddingBottom: (paddingBottom, durationMs = PADDING_FOLLOW_DURATION_MS) => {
      const nextPadding: MapPadding = { paddingTop: 0, paddingBottom, paddingLeft: 0, paddingRight: 0 };
      prevPaddingRef.current = nextPadding;
      cameraRef.current?.setCamera({
        padding: nextPadding,
        animationDuration: durationMs,
      });
    },
    flyTo: (coordinate, zoom = LOCATE_ZOOM_LEVEL) => {
      // Keep the prop-diffing refs in step, or the next `centerCoordinate`
      // change would compare against a stale centre and skip its own recenter.
      prevCenterRef.current = coordinate;
      prevZoomRef.current = zoom;
      cameraRef.current?.setCamera({
        centerCoordinate: coordinate,
        zoomLevel: zoom,
        animationDuration: LOCATE_ANIMATION_MS,
        padding: prevPaddingRef.current,
      });
    },
  }), []);

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
        compassEnabled={false}
        compassPosition={{ top: compassTop, right: 16 }}
        logoEnabled={false}
        attributionEnabled={false}
        scaleBarEnabled={false}
      >
        <MapboxGL.Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate, zoomLevel }}
        />

        {/* Gated on the caller having permission already. Rendering the puck
            without it makes Mapbox raise its own permission request, which
            would bypass locationService and its fallback. */}
        {showUserLocation && <MapboxGL.LocationPuck puckBearing="heading" pulsing={{ isEnabled: true }} />}

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

        {displayMarkers.map((marker) => (
          <MapboxGL.MarkerView
            key={marker.id}
            coordinate={[marker.longitude, marker.latitude]}
          >
            <View style={styles.markerContainer} onTouchEnd={() => onMarkerPress?.(marker)}>
              <View style={[
                styles.marker,
                selectedMarkerId === marker.id && styles.markerSelected,
              ]} />
            </View>
          </MapboxGL.MarkerView>
        ))}
      </MapboxGL.MapView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
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
  markerSelected: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#12C170',
    borderWidth: 4,
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

export default React.memo(MapboxMap);
