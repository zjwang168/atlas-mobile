import MapboxGL from '@rnmapbox/maps';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { interpolate, interpolateColor, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

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
  labelHint?: string;
  ai?: boolean;
  tone?: 'saved' | 'focused' | 'atlas' | 'recommended';
  /** Number shown inside a saved Atlas route pin. */
  order?: number;
  /** Animates a marker when an Atlas item is added. */
  entering?: boolean;
  /** Shows the small save-progress pulse around an Atlas marker. */
  pulsing?: boolean;
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
  /** Forces a fresh fit when the geographic bounds are intentionally unchanged. */
  cameraKey?: string;
  style?: ViewStyle;
  onMarkerPress?: (marker: MapMarker) => void;
  routeGeoJSON?: GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>;
  /** Static-size labels projected onto the current map viewport. */
  routeDistanceLabels?: Array<{ id: string; coordinate: [number, number]; text: string }>;
  routeMarkers?: MapMarker[];
  /** Camera padding to offset the map center (e.g., when a bottom panel is visible) */
  padding?: MapPadding;
  /** Duration for prop-driven camera changes. The Save screen needs a brief
      settle after its sheet enters; the home map keeps its slower transition. */
  cameraAnimationDurationMs?: number;
  selectedMarkerId?: string | null;
  /** Draw the current-position puck. Only pass true once location permission
      is granted — see the render site. */
  showUserLocation?: boolean;
  deletingMarkerId?: string | null;
  onMapPress?: () => void;
  onViewportChanged?: (center: [number, number], zoom: number) => void;
  compassEnabled?: boolean;
  markerPopup?: { markerId: string; content: React.ReactNode } | null;
}

// Small ease applied to every live padding update so the map visibly trails
// the panel edge by a beat instead of snapping to it 1:1 every frame.
const PADDING_FOLLOW_DURATION_MS = 300;
// Labels remain useful across a compact country or a large US state. This is
// based on the visible geographic footprint, not an arbitrary Mapbox zoom.
const LABEL_MAX_VIEWPORT_KM = 1900;
const MARKER_COLLISION_PADDING = 2;
const LABEL_POINT_CLEARANCE = 4;

/** Close enough to read street names when recentring on the user. */
const LOCATE_ZOOM_LEVEL = 15;
const LOCATE_ANIMATION_MS = 800;

type MapViewport = {
  center: [number, number];
  zoom: number;
  bounds?: { ne: [number, number]; sw: [number, number] };
};
type ScreenRect = { left: number; top: number; right: number; bottom: number };
type ScreenMarker = { marker: MapMarker; x: number; y: number; dotRect: ScreenRect };
type LabelOwnerGroups = Map<string, ScreenMarker[]>;
type CameraState = {
  properties: {
    center: GeoJSON.Position;
    zoom: number;
    bounds: { ne: GeoJSON.Position; sw: GeoJSON.Position };
  };
};

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

function expandRect(rect: ScreenRect, padding: number): ScreenRect {
  return { left: rect.left - padding, top: rect.top - padding, right: rect.right + padding, bottom: rect.bottom + padding };
}

function labelWidthForTitle(title: string): number {
  // Keep long place names readable without letting one label consume an
  // entire city view. The text still ellipsizes inside this stable width.
  return Math.min(230, Math.max(96, title.length * 7.4 + 24));
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

function viewportFromCamera(state: CameraState): MapViewport {
  const [longitude, latitude] = state.properties.center;
  return {
    center: [longitude, latitude],
    zoom: state.properties.zoom,
    bounds: {
      ne: [state.properties.bounds.ne[0], state.properties.bounds.ne[1]],
      sw: [state.properties.bounds.sw[0], state.properties.bounds.sw[1]],
    },
  };
}

function screenMarkers(markers: MapMarker[], viewport: MapViewport, width: number, height: number): ScreenMarker[] {
  if (!viewport.bounds) return [];
  const center = projectToWorld(viewport.center, viewport.zoom);
  return markers.map((marker) => {
    const point = projectToWorld([marker.longitude, marker.latitude], viewport.zoom);
    const x = point[0] - center[0] + width / 2;
    const y = point[1] - center[1] + height / 2;
    return { marker, x, y, dotRect: { left: x - 10, top: y - 10, right: x + 10, bottom: y + 10 } };
  }).filter((point) => point.x >= -12 && point.x <= width + 12 && point.y >= -12 && point.y <= height + 12);
}

/** Pick one label owner for each connected visual dot collision group. */
function labelOwnerPoints(points: ScreenMarker[], width: number, height: number, selectedMarkerId?: string | null, deletingMarkerId?: string | null, popupMarkerId?: string | null): LabelOwnerGroups {
  const candidates = [...points].sort((a, b) => {
    const score = (point: ScreenMarker) =>
      (point.marker.id === popupMarkerId ? 3000 : 0) +
      (point.marker.id === selectedMarkerId ? 2000 : 0) +
      (point.marker.id === deletingMarkerId ? 1000 : 0) +
      (point.marker.tone === 'focused' ? 800 : 0) +
      (point.marker.tone === 'atlas' ? 700 : 0);
    return score(b) - score(a) ||
      Math.abs(a.x - width / 2) + Math.abs(a.y - height / 2) - (Math.abs(b.x - width / 2) + Math.abs(b.y - height / 2)) ||
      a.y - b.y || a.x - b.x || a.marker.id.localeCompare(b.marker.id);
  });
  const groups: ScreenMarker[][] = [];
  for (const candidate of candidates) {
    const matchingGroups = groups.filter((group) => group.some((member) =>
      overlaps(expandRect(candidate.dotRect, MARKER_COLLISION_PADDING), expandRect(member.dotRect, MARKER_COLLISION_PADDING)),
    ));
    if (matchingGroups.length === 0) {
      groups.push([candidate]);
      continue;
    }
    const primaryGroup = matchingGroups[0];
    primaryGroup.push(candidate);
    for (const matchingGroup of matchingGroups.slice(1)) {
      primaryGroup.push(...matchingGroup);
      const index = groups.indexOf(matchingGroup);
      if (index >= 0) groups.splice(index, 1);
    }
  }
  const visible: LabelOwnerGroups = new Map();
  groups.forEach((group) => {
    const representative = group[0];
    visible.set(representative.marker.id, group);
  });
  return visible;
}

/** Labels stay above their marker; label-to-label overlap remains permitted. */
function visibleLabelIds(
  labelOwners: ReadonlyMap<string, ScreenMarker[]>,
  viewport: MapViewport,
  width: number,
  height: number,
  popupMarkerId?: string | null,
  selectedMarkerId?: string | null,
): Set<string> {
  if (!viewportIsLocal(viewport)) return new Set();
  const labels = new Set<string>();
  const representatives = new Map(Array.from(labelOwners.entries()).map(([id, group]) => [id, group[0]]));
  for (const [id, point] of representatives) {
    const title = point.marker.title;
    if (!title || id === popupMarkerId || point.x < 0 || point.x > width || point.y < 0 || point.y > height) continue;
    const labelWidth = labelWidthForTitle(title);
    const labelRect = { left: point.x - labelWidth / 2, right: point.x + labelWidth / 2, top: point.y - 47, bottom: point.y - 25 };
    const group = labelOwners.get(id) ?? [];
    if (labelRect.left < 0 || labelRect.right > width || labelRect.top < 0 || labelRect.bottom > height) continue;
    if (Array.from(representatives.values()).some((other) => other.marker.id !== id && overlaps(labelRect, expandRect(other.dotRect, LABEL_POINT_CLEARANCE)))) continue;
    group.forEach((member) => labels.add(member.marker.id));
  }
  // A point the user deliberately tapped must always retain its identifying
  // label, even when its normal collision candidate would be rejected.
  const selected = Array.from(labelOwners.values()).flat().find((point) => point.marker.id === selectedMarkerId);
  if (selected?.marker.title && selected.marker.id !== popupMarkerId) labels.add(selected.marker.id);
  return labels;
}

function MarkerLabel({
  title,
  hint,
  ai,
  visible,
  selected,
}: {
  title: string;
  hint?: string;
  ai?: boolean;
  visible: boolean;
  selected: boolean;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    animationRef.current?.stop();
    animationRef.current = Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: visible ? 175 : 130, useNativeDriver: true });
    animationRef.current.start();
    return () => animationRef.current?.stop();
  }, [opacity, visible]);

  const width = labelWidthForTitle(title);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.markerLabel,
        selected && styles.markerLabelSelected,
        { width, marginLeft: -width / 2, opacity: selected ? 1 : opacity },
      ]}
    >
      <View style={styles.markerLabelContent}>
        {ai ? <Ionicons name="sparkles" size={12} color="#885CF6" style={styles.markerAiIcon} /> : null}
        <View style={styles.markerLabelCopy}>
          <Text numberOfLines={2} ellipsizeMode="tail" style={styles.markerLabelText}>{title}</Text>
          {hint ? <Text numberOfLines={1} ellipsizeMode="tail" style={styles.markerLabelHint}>{hint}</Text> : null}
        </View>
      </View>
    </Animated.View>
  );
}

function MarkerDot({
  selected,
  deleting,
  tone = 'saved',
  order,
  hasActiveSelection,
  entering = false,
  pulsing = false,
}: {
  selected: boolean;
  deleting: boolean;
  tone?: MapMarker['tone'];
  order?: number;
  hasActiveSelection: boolean;
  entering?: boolean;
  pulsing?: boolean;
}) {
  const exit = useSharedValue(0);
  const entry = useSharedValue(entering ? 0 : 1);
  const pulse = useSharedValue(0);
  const selectedProgress = useSharedValue(selected || tone === 'focused' ? 1 : 0);
  useEffect(() => {
    exit.value = deleting ? withTiming(1, { duration: 440 }) : withTiming(0, { duration: 160 });
  }, [deleting, exit]);
  useEffect(() => {
    entry.value = entering ? withTiming(1, { duration: 420 }) : 1;
  }, [entering, entry]);
  useEffect(() => {
    pulse.value = pulsing ? withRepeat(withTiming(1, { duration: 3600 }), -1, false) : withTiming(0, { duration: 280 });
  }, [pulse, pulsing]);
  useEffect(() => {
    const isFocused = selected || tone === 'focused';
    // Switching directly from one point to another should never leave two
    // green pins on screen. Only a true deselect animates the outgoing pin.
    const duration = isFocused ? 140 : hasActiveSelection ? 0 : 220;
    selectedProgress.value = withTiming(isFocused ? 1 : 0, { duration });
  }, [hasActiveSelection, selected, selectedProgress, tone]);
  const animatedStyle = useAnimatedStyle(() => {
    const baseColor = tone === 'atlas' ? '#E77B32' : tone === 'recommended' ? '#885CF6' : '#007AFF';
    const selectedColor = tone === 'atlas' ? '#E77B32' : tone === 'recommended' ? '#885CF6' : '#12C170';
    return {
    opacity: (1 - exit.value) * entry.value,
    backgroundColor: interpolateColor(
      exit.value,
      [0, 1],
      [
        interpolateColor(selectedProgress.value, [0, 1], [baseColor, selectedColor]),
        '#DC2626',
      ],
    ),
    transform: [{ scale: (1 + selectedProgress.value * 0.5) * (1 - exit.value * 0.76) * (0.82 + entry.value * 0.18) }],
    };
  });
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulsing ? interpolate(pulse.value, [0, 0.82, 1], [0.72, 0.12, 0]) : 0,
    transform: [{ scale: pulsing ? interpolate(pulse.value, [0, 1], [1, 1.78]) : 1 }],
  }));
  return (
    <View style={styles.markerDotWrap}>
      {pulsing && tone === 'atlas' ? <Reanimated.View pointerEvents="none" style={[styles.markerSavingPulse, pulseStyle]} /> : null}
      <Reanimated.View style={[styles.marker, selected && styles.markerSelectedLayer, tone === 'atlas' && styles.markerAtlas, tone === 'recommended' && styles.markerRecommended, selected && tone === 'atlas' && styles.markerAtlasSelected, animatedStyle]}>
        {order ? <Text style={styles.markerOrder}>{order}</Text> : null}
      </Reanimated.View>
    </View>
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
  /**
   * Recenter on a coordinate as a one-off. Imperative for the same reason as
   * `setPaddingBottom`: a "locate me" tap is an event, not a piece of state,
   * and routing it through `centerCoordinate` would make a repeat tap on an
   * unchanged coordinate do nothing.
   */
  flyTo: (coordinate: [number, number], zoomLevel?: number) => void;
  /** Same idea as `flyTo` but tuned for the atlas camera — a much shorter
      animation, and no prop-diffing bookkeeping. */
  focusCoordinate: (coordinate: [number, number], zoomLevel?: number, durationMs?: number) => void;
}

const MapboxMap = forwardRef<MapboxMapHandle, MapboxMapProps>(function MapboxMap({
  markers,
  centerCoordinate = [-122.3321, 47.6062],
  zoomLevel = 12,
  bounds,
  cameraKey,
  style,
  onMarkerPress,
  routeGeoJSON,
  routeDistanceLabels,
  routeMarkers,
  padding,
  cameraAnimationDurationMs = 2000,
  selectedMarkerId,
  showUserLocation = false,
  deletingMarkerId,
  onMapPress,
  onViewportChanged,
  compassEnabled = true,
  markerPopup,
}, ref) {
  const displayMarkers = routeMarkers ?? markers;
  const renderedMarkers = useMemo(
    () => {
      // A marker can be present in more than one source (for example a saved
      // place that is also already in an Atlas). Native MarkerView requires
      // one stable key per id, so collapse duplicates before rendering.
      const unique = new Map<string, MapMarker>();
      displayMarkers.forEach((marker) => unique.set(marker.id, marker));
      const list = [...unique.values()];
      const markerPriority = (marker: MapMarker) => (marker.tone === 'atlas' ? 30 : marker.id === selectedMarkerId ? 20 : marker.tone === 'recommended' ? 10 : 0);
      return list.sort((a, b) => markerPriority(a) - markerPriority(b));
    },
    [displayMarkers, selectedMarkerId],
  );
  const { width, height } = useWindowDimensions();
  const { top: safeTop } = useSafeAreaInsets();
  // Dormant — the compass is disabled below, so nothing renders at this
  // position. Kept so re-enabling it drops the compass clear of the top
  // overlay row instead of underneath it.
  const compassTop = safeTop + 48;
  const cameraRef = useRef<MapboxGL.Camera>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<MapViewport>({ center: centerCoordinate, zoom: zoomLevel });
  const pendingViewportRef = useRef<MapViewport | null>(null);
  const cameraFrameRef = useRef<number | null>(null);
  const lastCameraStateKeyRef = useRef<string | null>(null);
  const markerPressTimestampRef = useRef(0);
  const screenMarkerPoints = useMemo(
    () => screenMarkers(renderedMarkers, viewport, width, height),
    [height, renderedMarkers, viewport, width],
  );
  const labelOwnerMarkerPoints = useMemo(
    () => labelOwnerPoints(screenMarkerPoints, width, height, selectedMarkerId, deletingMarkerId, markerPopup?.markerId),
    [deletingMarkerId, height, markerPopup?.markerId, screenMarkerPoints, selectedMarkerId, width],
  );
  const labelIds = useMemo(
    () => visibleLabelIds(labelOwnerMarkerPoints, viewport, width, height, markerPopup?.markerId, selectedMarkerId),
    [height, labelOwnerMarkerPoints, markerPopup?.markerId, selectedMarkerId, viewport, width],
  );
  const routeDistanceGeoJSON = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => ({
    type: 'FeatureCollection',
    features: (routeDistanceLabels ?? []).map((label) => ({ type: 'Feature', properties: { label: label.text }, geometry: { type: 'Point', coordinates: label.coordinate } })),
  }), [routeDistanceLabels]);

  const handleMapPress = () => {
    if (Date.now() - markerPressTimestampRef.current < 180) return;
    onMapPress?.();
  };

  const queueViewportUpdate = (state: CameraState) => {
    const nextViewport = viewportFromCamera(state);
    // Mapbox can send duplicate camera events after an idle render. Ignore
    // them so the exact-coordinate cache cannot oscillate with its fallback.
    const nextCameraStateKey = [
      ...nextViewport.center.map((value) => value.toFixed(5)),
      nextViewport.zoom.toFixed(3),
      ...(nextViewport.bounds ? [...nextViewport.bounds.ne, ...nextViewport.bounds.sw].map((value) => value.toFixed(4)) : []),
    ].join(':');
    if (nextCameraStateKey === lastCameraStateKeyRef.current) return;
    lastCameraStateKeyRef.current = nextCameraStateKey;
    pendingViewportRef.current = nextViewport;
    if (cameraFrameRef.current !== null) return;
    cameraFrameRef.current = requestAnimationFrame(() => {
      cameraFrameRef.current = null;
      const next = pendingViewportRef.current;
      if (!next) return;
      pendingViewportRef.current = null;
      setViewport(next);
      onViewportChanged?.(next.center, next.zoom);
    });
  };

  useEffect(() => () => {
    if (cameraFrameRef.current !== null) cancelAnimationFrame(cameraFrameRef.current);
  }, []);

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
  const prevCameraKeyRef = useRef(cameraKey);
  const previousBoundsRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bounds) {
      previousBoundsRef.current = null;
      return;
    }
    if (!isReady) return;
    // A panel can report many height changes while entering. Re-fitting the
    // same geographic bounds for every padding update repeatedly restarts the
    // camera animation and makes an Atlas feel slow to open. Bounds changes
    // own zoom; padding-only changes are handled by the camera effect below.
    const nextBounds = `${cameraKey ?? ''}:${bounds.ne.join(',')}:${bounds.sw.join(',')}`;
    if (nextBounds === previousBoundsRef.current) return;
    previousBoundsRef.current = nextBounds;
    const fitPadding: [number, number, number, number] = [
      Math.max(48, padding?.paddingTop ?? 0),
      Math.max(24, padding?.paddingRight ?? 0),
      Math.max(24, padding?.paddingBottom ?? 0),
      Math.max(24, padding?.paddingLeft ?? 0),
    ];
    cameraRef.current?.fitBounds(bounds.ne, bounds.sw, fitPadding, cameraAnimationDurationMs);
  }, [bounds, cameraAnimationDurationMs, cameraKey, isReady, padding]);
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
    const cameraKeyChanged = cameraKey !== prevCameraKeyRef.current;
    if (bounds) {
      prevCenterRef.current = centerCoordinate;
      prevZoomRef.current = zoomLevel;
      prevPaddingRef.current = padding;
      prevCameraKeyRef.current = cameraKey;
      if (paddingChanged) cameraRef.current?.setCamera({ padding, animationDuration: cameraAnimationDurationMs });
      return;
    }
    if (!centerChanged && !zoomChanged && !paddingChanged && !cameraKeyChanged) return;
    prevCenterRef.current = centerCoordinate;
    prevZoomRef.current = zoomLevel;
    prevPaddingRef.current = padding;
    prevCameraKeyRef.current = cameraKey;
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
        onPress={handleMapPress}
        onCameraChanged={queueViewportUpdate}
        onMapIdle={queueViewportUpdate}
      >
        <MapboxGL.Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate, zoomLevel, padding }}
        />

        {/* Gated on the caller having permission already. Rendering the puck
            without it makes Mapbox raise its own permission request, which
            would bypass locationService and its fallback. */}
        {showUserLocation && <MapboxGL.LocationPuck puckBearing="heading" pulsing={{ isEnabled: true }} />}

        {routeGeoJSON && (
          <MapboxGL.ShapeSource id="routeSource" shape={routeGeoJSON}>
            <MapboxGL.LineLayer
              id="routeCasing"
              style={{
                lineColor: '#C9693C',
                lineWidth: 13,
                lineOpacity: 0.12,
                lineOffset: 2,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <MapboxGL.LineLayer
              id="routeLine"
              style={{
                lineColor: '#F29A69',
                lineWidth: 8,
                lineOpacity: 0.9,
                lineOffset: 2,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapboxGL.ShapeSource>
        )}
        {routeDistanceLabels?.length ? <MapboxGL.ShapeSource id="routeDistanceSource" shape={routeDistanceGeoJSON}><MapboxGL.SymbolLayer id="routeDistanceLabels" style={{ textField: ['get', 'label'], textSize: 10, textColor: '#475569', textHaloColor: 'rgba(255,255,255,0.99)', textHaloWidth: 2.5, textOffset: [0, -0.9], textAllowOverlap: true, textIgnorePlacement: true, textAnchor: 'center' }} /></MapboxGL.ShapeSource> : null}

        {renderedMarkers.map((marker) => (
          <MapboxGL.MarkerView
            // MarkerView does not reliably re-evaluate native collision after
            // allowOverlap changes. Remount only the marker whose focused
            // state changed so a deselected green pin immediately returns to
            // the normal blue-pin collision set without requiring a pan/zoom.
            key={`${marker.id}:${marker.id === selectedMarkerId ? 'focused' : 'normal'}`}
            coordinate={[marker.longitude, marker.latitude]}
            style={[styles.markerAnnotation, selectedMarkerId === marker.id && styles.markerAnnotationSelected, marker.tone === 'atlas' && styles.markerAnnotationAtlas]}
            // A focused point is an explicit user choice. Let its annotation
            // render above nearby markers so its mandatory label cannot be
            // discarded by native collision handling.
            // AI recommendations must remain discoverable even when they sit
            // near a saved point; native MarkerView collision would otherwise
            // hide the purple pin before the user can select it.
            allowOverlap={selectedMarkerId === marker.id || marker.tone === 'recommended' || marker.tone === 'atlas'}
          >
            <View
              style={styles.markerContainer}
              onTouchEnd={() => {
                markerPressTimestampRef.current = Date.now();
                onMarkerPress?.(marker);
              }}
            >
              <MarkerDot
                selected={selectedMarkerId === marker.id}
                deleting={deletingMarkerId === marker.id}
                tone={marker.tone}
                order={marker.order}
                hasActiveSelection={Boolean(selectedMarkerId)}
                entering={marker.entering}
                pulsing={marker.pulsing}
              />
              {marker.title ? (
                <MarkerLabel
                  title={marker.title}
                  hint={marker.labelHint}
                  ai={marker.ai}
                  visible={selectedMarkerId === marker.id || labelIds.has(marker.id)}
                  selected={selectedMarkerId === marker.id}
                />
              ) : null}
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
  markerAnnotation: {
    width: 20,
    height: 20,
  },
  markerAnnotationSelected: {
    zIndex: 70,
    elevation: 70,
  },
  markerAnnotationAtlas: {
    zIndex: 140,
    elevation: 140,
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
    bottom: 28,
    left: '50%',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15,23,42,0.24)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  markerLabelSelected: {
    bottom: 33,
    zIndex: 100,
    elevation: 100,
  },
  markerLabelContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  markerAiIcon: {
    marginRight: 4,
  },
  markerLabelCopy: {
    flex: 1,
    minWidth: 0,
  },
  markerLabelText: {
    flex: 1,
    color: '#1F2937',
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0,
    textAlign: 'center',
  },
  markerLabelHint: {
    color: '#171717',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '500',
    marginTop: 1,
    textAlign: 'center',
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
  markerDotWrap: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerSavingPulse: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  markerSelectedLayer: {
    zIndex: 100,
    elevation: 100,
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
  markerRecommended: {
    backgroundColor: '#885CF6',
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
