import MapboxGL from '@rnmapbox/maps';
import Constants from 'expo-constants';
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

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
  tone?: 'saved' | 'focused' | 'atlas';
  /** Number shown inside a saved Atlas route pin. */
  order?: number;
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
  bounds?: { ne: [number, number]; sw: [number, number] };
  style?: ViewStyle;
  onMarkerPress?: (marker: MapMarker) => void;
  routeGeoJSON?: GeoJSON.Feature<GeoJSON.LineString>;
  routeMarkers?: MapMarker[];
  /** Camera padding to offset the map center (e.g., when a bottom panel is visible) */
  padding?: MapPadding;
  /** Duration for prop-driven camera changes. The Save screen needs a brief
      settle after its sheet enters; the home map keeps its slower transition. */
  cameraAnimationDurationMs?: number;
  selectedMarkerId?: string | null;
  deletingMarkerId?: string | null;
  onMapPress?: () => void;
  compassEnabled?: boolean;
  markerPopup?: { markerId: string; content: React.ReactNode } | null;
}

// Small ease applied to every live padding update so the map visibly trails
// the panel edge by a beat instead of snapping to it 1:1 every frame.
const PADDING_FOLLOW_DURATION_MS = 300;
// Labels become useful at a city or compact-state scale. This is based on the
// visible geographic footprint, not an arbitrary Mapbox zoom number.
const LABEL_MAX_VIEWPORT_KM = 360;

type MapViewport = {
  center: [number, number];
  zoom: number;
  bounds?: { ne: [number, number]; sw: [number, number] };
};
type ScreenRect = { left: number; top: number; right: number; bottom: number };

function projectToWorld([longitude, latitude]: [number, number], zoom: number): [number, number] {
  const worldSize = 512 * 2 ** zoom;
  const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const latitudeRadians = clampedLatitude * Math.PI / 180;
  return [
    (longitude + 180) / 360 * worldSize,
    (1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) / 2 * worldSize,
  ];
}

function overlaps(a: ScreenRect, b: ScreenRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function labelWidthForTitle(title: string): number {
  return Math.min(196, Math.max(72, title.length * 7.4 + 20));
}

function viewportIsLocal(viewport: MapViewport): boolean {
  if (!viewport.bounds) return false;
  const [neLongitude, neLatitude] = viewport.bounds.ne;
  const [swLongitude, swLatitude] = viewport.bounds.sw;
  const latitudeSpanKm = Math.abs(neLatitude - swLatitude) * 111.32;
  const longitudeSpan = Math.abs(neLongitude - swLongitude);
  const longitudeSpanKm = Math.min(longitudeSpan, 360 - longitudeSpan) * 111.32 * Math.cos(((neLatitude + swLatitude) / 2) * Math.PI / 180);
  return Math.max(latitudeSpanKm, longitudeSpanKm) <= LABEL_MAX_VIEWPORT_KM;
}

/**
 * Labels are emitted only if their estimated screen rectangle clears every
 * visible marker and every label accepted earlier in this pass. This keeps a
 * dense area quiet until the user has zoomed far enough into it.
 */
function visibleLabelIds(markers: MapMarker[], viewport: MapViewport, width: number, height: number, selectedMarkerId?: string | null, popupMarkerId?: string | null): Set<string> {
  if (!viewportIsLocal(viewport)) return new Set();
  const center = projectToWorld(viewport.center, viewport.zoom);
  const pointRects = markers.map((marker) => {
    const point = projectToWorld([marker.longitude, marker.latitude], viewport.zoom);
    const x = point[0] - center[0] + width / 2;
    const y = point[1] - center[1] + height / 2;
    return { id: marker.id, x, y, rect: { left: x - 18, top: y - 18, right: x + 18, bottom: y + 18 } };
  }).filter((point) => point.x >= -24 && point.x <= width + 24 && point.y >= -24 && point.y <= height + 24);
  const accepted: ScreenRect[] = [];
  const visible = new Set<string>();
  const priority = [...pointRects].sort((a, b) => Number(b.id === selectedMarkerId) - Number(a.id === selectedMarkerId));
  for (const point of priority) {
    const marker = markers.find((entry) => entry.id === point.id);
    if (!marker?.title || marker.id === popupMarkerId) continue;
    const labelWidth = labelWidthForTitle(marker.title);
    const label: ScreenRect = { left: point.x - labelWidth / 2, right: point.x + labelWidth / 2, top: point.y - 43, bottom: point.y - 21 };
    if (label.left < 8 || label.right > width - 8 || label.top < 8) continue;
    if (pointRects.some((other) => other.id !== point.id && overlaps(label, other.rect))) continue;
    if (accepted.some((other) => overlaps(label, other))) continue;
    accepted.push(label);
    visible.add(marker.id);
  }
  return visible;
}

function MarkerDot({ selected, deleting, tone = 'saved', order }: { selected: boolean; deleting: boolean; tone?: MapMarker['tone']; order?: number }) {
  const exit = useSharedValue(0);
  useEffect(() => {
    exit.value = deleting ? withTiming(1, { duration: 440 }) : withTiming(0, { duration: 160 });
  }, [deleting, exit]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    backgroundColor: interpolateColor(exit.value, [0, 1], [tone === 'atlas' ? '#E77B32' : selected || tone === 'focused' ? '#12C170' : '#007AFF', '#DC2626']),
    transform: [{ scale: 1 - exit.value * 0.76 }],
  }));
  return (
    <Reanimated.View style={[styles.marker, (selected || tone === 'focused') && styles.markerSelected, tone === 'atlas' && styles.markerAtlas, selected && tone === 'atlas' && styles.markerAtlasSelected, animatedStyle]}>
      {order ? <Text style={styles.markerOrder}>{order}</Text> : null}
    </Reanimated.View>
  );
}

export interface MapboxMapHandle {
  /**
   * Update bottom camera padding directly via the camera ref, bypassing React
   * state/re-render entirely. Used for per-frame panel-drag tracking, where
   * pushing every frame through props would re-render the whole map tree.
   * Each call re-targets a short (300ms) ease, so rapid successive calls
   * naturally produce a lagging "follow" motion rather than an instant jump.
   */
  setPaddingBottom: (paddingBottom: number, durationMs?: number) => void;
  focusCoordinate: (coordinate: [number, number], zoomLevel?: number, durationMs?: number) => void;
}

const MapboxMap = forwardRef<MapboxMapHandle, MapboxMapProps>(function MapboxMap({
  markers,
  centerCoordinate = [-122.3321, 47.6062],
  zoomLevel = 12,
  bounds,
  style,
  onMarkerPress,
  routeGeoJSON,
  routeMarkers,
  padding,
  cameraAnimationDurationMs = 2000,
  selectedMarkerId,
  deletingMarkerId,
  onMapPress,
  compassEnabled = true,
  markerPopup,
}, ref) {
  const displayMarkers = routeMarkers ?? markers;
  const { width, height } = useWindowDimensions();
  const { top: safeTop } = useSafeAreaInsets();
  // Position compass just below the RightNav pill (safeTop + 8 offset + 92px pill height + 12px gap)
  const compassTop = safeTop + 48;
  const cameraRef = useRef<MapboxGL.Camera>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<MapViewport>({ center: centerCoordinate, zoom: zoomLevel });
  const labelIds = useMemo(
    () => visibleLabelIds(displayMarkers, viewport, width, height, selectedMarkerId, markerPopup?.markerId),
    [displayMarkers, height, markerPopup?.markerId, selectedMarkerId, viewport, width],
  );

  useEffect(() => {
    try {
      if (!MAPBOX_ACCESS_TOKEN) {
        setError('The map is unavailable right now. Please try again in a moment.');
        return;
      }
      MapboxGL.setAccessToken(MAPBOX_ACCESS_TOKEN);
      setIsReady(true);
    } catch (err) {
      setError('The map is unavailable right now. Please try again in a moment.');
    }
  }, []);

  const prevCenterRef = useRef(centerCoordinate);
  const prevZoomRef = useRef(zoomLevel);
  const prevPaddingRef = useRef(padding);
  const previousBoundsRef = useRef<string | null>(null);
  useEffect(() => {
    const nextBounds = bounds ? `${bounds.ne.join(',')}:${bounds.sw.join(',')}` : null;
    if (!nextBounds || nextBounds === previousBoundsRef.current) return;
    previousBoundsRef.current = nextBounds;
    cameraRef.current?.fitBounds(bounds!.ne, bounds!.sw, [48, 24, 330, 24], cameraAnimationDurationMs);
  }, [bounds, cameraAnimationDurationMs, isReady]);
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
    if (bounds) {
      prevCenterRef.current = centerCoordinate;
      prevZoomRef.current = zoomLevel;
      prevPaddingRef.current = padding;
      if (paddingChanged) cameraRef.current?.setCamera({ padding, animationDuration: cameraAnimationDurationMs });
      return;
    }
    if (!centerChanged && !zoomChanged && !paddingChanged) return;
    prevCenterRef.current = centerCoordinate;
    prevZoomRef.current = zoomLevel;
    prevPaddingRef.current = padding;
    cameraRef.current?.setCamera({
      centerCoordinate,
      zoomLevel,
      animationDuration: cameraAnimationDurationMs,
      padding,
    });
  }, [bounds, cameraAnimationDurationMs, centerCoordinate, zoomLevel, padding]);

  useImperativeHandle(ref, () => ({
    setPaddingBottom: (paddingBottom, durationMs = PADDING_FOLLOW_DURATION_MS) => {
      const nextPadding: MapPadding = { paddingTop: 0, paddingBottom, paddingLeft: 0, paddingRight: 0 };
      prevPaddingRef.current = nextPadding;
      cameraRef.current?.setCamera({
        padding: nextPadding,
        animationDuration: durationMs,
      });
    },
    focusCoordinate: (coordinate, nextZoomLevel = 15, durationMs = 90) => {
      cameraRef.current?.setCamera({
        centerCoordinate: coordinate,
        zoomLevel: nextZoomLevel,
        padding: prevPaddingRef.current,
        animationDuration: durationMs,
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
        compassEnabled={compassEnabled}
        compassPosition={{ top: compassTop, right: 16 }}
        logoEnabled={false}
        attributionEnabled={false}
        scaleBarEnabled={false}
        onPress={onMapPress}
        onMapIdle={(state) => {
          const [longitude, latitude] = state.properties.center;
          setViewport({
            center: [longitude, latitude],
            zoom: state.properties.zoom,
            bounds: {
              ne: [state.properties.bounds.ne[0], state.properties.bounds.ne[1]],
              sw: [state.properties.bounds.sw[0], state.properties.bounds.sw[1]],
            },
          });
        }}
      >
        <MapboxGL.Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate, zoomLevel, padding }}
        />

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
              <MarkerDot selected={selectedMarkerId === marker.id} deleting={deletingMarkerId === marker.id} tone={marker.tone} order={marker.order} />
              {labelIds.has(marker.id) && marker.title ? <View pointerEvents="none" style={[styles.markerLabel, { width: labelWidthForTitle(marker.title), marginLeft: -labelWidthForTitle(marker.title) / 2 }]}><Text numberOfLines={1} ellipsizeMode="tail" style={styles.markerLabelText}>{marker.title}</Text></View> : null}
              {markerPopup?.markerId === marker.id ? <View style={styles.markerPopup}>{markerPopup.content}</View> : null}
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
  markerPopup: {
    position: 'absolute',
    top: 29,
    minWidth: 220,
    maxWidth: 274,
    alignSelf: 'center',
  },
  markerLabel: {
    position: 'absolute',
    bottom: 24,
    left: '50%',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15,23,42,0.12)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.13,
    shadowRadius: 4,
    elevation: 3,
  },
  markerLabelText: {
    color: '#1F2937',
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0,
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerSelected: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#12C170',
    borderWidth: 4,
  },
  markerAtlas: {
    backgroundColor: '#E77B32',
  },
  markerAtlasSelected: {
    borderColor: '#FFFFFF',
  },
  markerOrder: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
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
