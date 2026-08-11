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
  /** Positive values move rendered map content down by this many screen points. */
  cameraScreenOffsetY?: number;
  /** Duration for prop-driven camera changes. The Save screen needs a brief
      settle after its sheet enters; the home map keeps its slower transition. */
  cameraAnimationDurationMs?: number;
  selectedMarkerId?: string | null;
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

function offsetCameraCenter([longitude, latitude]: [number, number], zoom: number, screenOffsetY = 0): [number, number] {
  if (!screenOffsetY) return [longitude, latitude];
  const worldSize = 512 * 2 ** zoom;
  const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const latitudeRadians = clampedLatitude * Math.PI / 180;
  const currentY = (1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) / 2 * worldSize;
  // Moving the camera north moves the rendered map content south on screen.
  const targetY = Math.max(0, Math.min(worldSize, currentY - screenOffsetY));
  const nextLatitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * targetY / worldSize))) * 180 / Math.PI;
  return [longitude, nextLatitude];
}

function mercatorY(latitude: number): number {
  const clampedLatitude = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const radians = clampedLatitude * Math.PI / 180;
  return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2;
}

function latitudeFromMercatorY(y: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
}

function cameraForBounds(
  bounds: NonNullable<MapboxMapProps['bounds']>,
  width: number,
  height: number,
  padding: [number, number, number, number],
): { centerCoordinate: [number, number]; zoomLevel: number } {
  const [west, south] = bounds.sw;
  const [east, north] = bounds.ne;
  const longitudeSpan = Math.max(0.00001, east - west);
  const northY = mercatorY(north);
  const southY = mercatorY(south);
  const latitudeSpan = Math.max(0.00000001, Math.abs(southY - northY));
  const availableWidth = Math.max(1, width - padding[1] - padding[3]);
  const availableHeight = Math.max(1, height - padding[0] - padding[2]);
  const longitudeZoom = Math.log2((availableWidth * 360) / (512 * longitudeSpan));
  const latitudeZoom = Math.log2(availableHeight / (512 * latitudeSpan));
  const zoomLevel = Math.max(1, Math.min(20, Math.min(longitudeZoom, latitudeZoom)));

  return {
    // Camera padding already places this coordinate at the center of the
    // unoccluded map rectangle. Applying the padding offset here as well moves
    // Atlas pins too close to the Dynamic Island.
    centerCoordinate: [(west + east) / 2, latitudeFromMercatorY((northY + southY) / 2)],
    zoomLevel,
  };
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
      (point.marker.tone === 'focused' ? 2200 : 0) +
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

/** Labels stay above their marker and never overlap one another. */
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
  const placedLabelRects: ScreenRect[] = [];
  for (const [id, point] of representatives) {
    const title = point.marker.title;
    if (!title || id === popupMarkerId || point.x < 0 || point.x > width || point.y < 0 || point.y > height) continue;
    const labelWidth = labelWidthForTitle(title);
    const labelRect = { left: point.x - labelWidth / 2, right: point.x + labelWidth / 2, top: point.y - 47, bottom: point.y - 25 };
    const group = labelOwners.get(id) ?? [];
    if (labelRect.left < 0 || labelRect.right > width || labelRect.top < 0 || labelRect.bottom > height) continue;
    if (Array.from(representatives.values()).some((other) => other.marker.id !== id && overlaps(labelRect, expandRect(other.dotRect, LABEL_POINT_CLEARANCE)))) continue;
    if (placedLabelRects.some((placed) => overlaps(labelRect, placed))) continue;
    // A collision group has a single representative. Showing every group
    // member was the source of stacked labels for clustered AI suggestions.
    if (group.length) labels.add(id);
    placedLabelRects.push(labelRect);
  }
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
    const atlasPin = tone === 'atlas';
    const baseColor = tone === 'atlas' ? '#E77B32' : tone === 'recommended' ? '#885CF6' : '#007AFF';
    // Green is the explicit current-choice state in the editor. AI pins stay
    // purple only while unselected; an orange Atlas pin keeps its route color.
    const selectedColor = tone === 'atlas' ? '#E77B32' : '#12C170';
    return {
    // Atlas pins are the active itinerary itself. They never participate in
    // add/focus remount fades; only an explicit delete is allowed to fade one.
    opacity: (1 - exit.value) * (atlasPin ? 1 : entry.value),
    backgroundColor: interpolateColor(
      exit.value,
      [0, 1],
      [
        interpolateColor(selectedProgress.value, [0, 1], [baseColor, selectedColor]),
        '#DC2626',
      ],
    ),
    transform: [{ scale: (1 + selectedProgress.value * 0.5) * (1 - exit.value * 0.76) * (atlasPin ? 1 : (0.82 + entry.value * 0.18)) }],
    };
  });
  const pulseStyle = useAnimatedStyle(() => ({
    // Range control: 3.56 is twice the previous 1.78 maximum scale.
    // Keep the ring solid white through its expansion, then clear it only as
    // the next breath starts so it reads as white padding rather than a glow.
    opacity: pulsing ? interpolate(pulse.value, [0, 0.88, 1], [1, 1, 0]) : 0,
    transform: [{ scale: pulsing ? interpolate(pulse.value, [0, 1], [1, 3.56]) : 1 }],
  }));
  return (
    <View style={[styles.markerDotWrap, tone === 'atlas' && styles.markerDotWrapAtlas]}>
      {pulsing && tone === 'atlas' ? <Reanimated.View pointerEvents="none" style={[styles.markerSavingPulse, styles.markerSavingPulseAtlas, pulseStyle]} /> : null}
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
  cameraScreenOffsetY = 0,
  cameraAnimationDurationMs = 2000,
  selectedMarkerId,
  deletingMarkerId,
  onMapPress,
  onViewportChanged,
  compassEnabled = true,
  markerPopup,
}, ref) {
  const cameraCenterCoordinate = useMemo(
    () => offsetCameraCenter(centerCoordinate, zoomLevel, cameraScreenOffsetY),
    [cameraScreenOffsetY, centerCoordinate, zoomLevel],
  );
  const displayMarkers = routeMarkers ?? markers;
  const renderedMarkers = useMemo(
    () => {
      // A marker can be present in more than one source (for example a saved
      // place that is also already in an Atlas). Native MarkerView requires
      // one stable key per id, so collapse duplicates before rendering.
      const unique = new Map<string, MapMarker>();
      displayMarkers.forEach((marker) => unique.set(marker.id, marker));
      const list = [...unique.values()];
      const markerPriority = (marker: MapMarker) => (
        marker.tone === 'atlas' ? 30
          : marker.tone === 'focused' || marker.id === selectedMarkerId ? 20
            : marker.tone === 'recommended' ? 10
              : 0
      );
      return list.sort((a, b) => markerPriority(a) - markerPriority(b));
    },
    [displayMarkers, selectedMarkerId],
  );
  const { width, height } = useWindowDimensions();
  const { top: safeTop } = useSafeAreaInsets();
  // Position compass just below the RightNav pill (safeTop + 8 offset + 92px pill height + 12px gap)
  const compassTop = safeTop + 48;
  const cameraRef = useRef<MapboxGL.Camera>(null);
  const [isReady, setIsReady] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<MapViewport>({ center: cameraCenterCoordinate, zoom: zoomLevel });
  const pendingViewportRef = useRef<MapViewport | null>(null);
  const cameraFrameRef = useRef<number | null>(null);
  const lastCameraStateKeyRef = useRef<string | null>(null);
  const markerPressTimestampRef = useRef(0);
  const screenMarkerPoints = useMemo(
    () => screenMarkers(renderedMarkers, viewport, width, height),
    [height, renderedMarkers, viewport, width],
  );
  const nativeMarkers = useMemo(() => {
    // MarkerView is a React/native view for every point. Keep the active Atlas
    // pins and selected point, but cull distant saved/recommended views to the
    // current viewport and cap the remainder. This avoids reconciling an
    // entire country's saved places while a local Atlas sheet opens.
    const visibleIds = new Set(screenMarkerPoints.map((point) => point.marker.id));
    const atlas = renderedMarkers.filter((marker) => marker.tone === 'atlas');
    const selected = renderedMarkers.filter((marker) => marker.id === selectedMarkerId && marker.tone !== 'atlas');
    const nearby = screenMarkerPoints
      .filter((point) => point.marker.tone !== 'atlas' && point.marker.id !== selectedMarkerId)
      .sort((a, b) => Math.hypot(a.x - width / 2, a.y - height / 2) - Math.hypot(b.x - width / 2, b.y - height / 2))
      .slice(0, 96)
      .map((point) => point.marker)
      .filter((marker) => visibleIds.has(marker.id));
    return [...new Map([...atlas, ...selected, ...nearby].map((marker) => [marker.id, marker])).values()];
  }, [height, renderedMarkers, screenMarkerPoints, selectedMarkerId, width]);
  const labelOwnerMarkerPoints = useMemo(
    () => labelOwnerPoints(screenMarkerPoints, width, height, selectedMarkerId, deletingMarkerId, markerPopup?.markerId),
    [deletingMarkerId, height, markerPopup?.markerId, screenMarkerPoints, selectedMarkerId, width],
  );
  const labelIds = useMemo(
    () => visibleLabelIds(labelOwnerMarkerPoints, viewport, width, height, markerPopup?.markerId, selectedMarkerId),
    [height, labelOwnerMarkerPoints, markerPopup?.markerId, selectedMarkerId, viewport, width],
  );
  const routeDistanceGeoJSON = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => {
    const seen = new Set<string>();
    return {
      type: 'FeatureCollection',
      features: (routeDistanceLabels ?? []).flatMap((label) => {
        const key = `${label.id}:${label.coordinate[0].toFixed(6)}:${label.coordinate[1].toFixed(6)}:${label.text}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ id: label.id, type: 'Feature' as const, properties: { label: label.text }, geometry: { type: 'Point' as const, coordinates: label.coordinate } }];
      }),
    };
  }, [routeDistanceLabels]);

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

  const prevCenterRef = useRef(cameraCenterCoordinate);
  const prevZoomRef = useRef(zoomLevel);
  const prevPaddingRef = useRef(padding);
  const prevCameraKeyRef = useRef(cameraKey);
  const previousBoundsRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bounds) {
      previousBoundsRef.current = null;
      return;
    }
    if (!isReady || !mapLoaded || !cameraRef.current) return;
    const fitPadding: [number, number, number, number] = [
      Math.max(48, padding?.paddingTop ?? 0),
      Math.max(24, padding?.paddingRight ?? 0),
      Math.max(24, padding?.paddingBottom ?? 0),
      Math.max(24, padding?.paddingLeft ?? 0),
    ];
    // Bounds own both center and zoom. Compute the Web Mercator camera here
    // from the orange-pin bounds and the real remaining map viewport rather
    // than accepting a native fit result that can be superseded by padding.
    const nextBounds = `${cameraKey ?? ''}:${bounds.ne.join(',')}:${bounds.sw.join(',')}:${fitPadding.join(',')}`;
    if (nextBounds === previousBoundsRef.current) return;
    const camera = cameraForBounds(bounds, width, height, fitPadding);
    cameraRef.current.setCamera({
      ...camera,
      padding: {
        paddingTop: fitPadding[0],
        paddingRight: fitPadding[1],
        paddingBottom: fitPadding[2],
        paddingLeft: fitPadding[3],
      },
      animationDuration: cameraAnimationDurationMs,
    });
    previousBoundsRef.current = nextBounds;
  }, [bounds, cameraAnimationDurationMs, cameraKey, height, isReady, mapLoaded, padding, width]);
  useEffect(() => {
    const [lng, lat] = cameraCenterCoordinate;
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
      prevCenterRef.current = cameraCenterCoordinate;
      prevZoomRef.current = zoomLevel;
      prevPaddingRef.current = padding;
      prevCameraKeyRef.current = cameraKey;
      return;
    }
    if (!isReady || !mapLoaded || !cameraRef.current) return;
    if (!centerChanged && !zoomChanged && !paddingChanged && !cameraKeyChanged) return;
    prevCenterRef.current = cameraCenterCoordinate;
    prevZoomRef.current = zoomLevel;
    prevPaddingRef.current = padding;
    prevCameraKeyRef.current = cameraKey;
    cameraRef.current?.setCamera({
      centerCoordinate: cameraCenterCoordinate,
      zoomLevel,
      animationDuration: cameraAnimationDurationMs,
      padding,
    });
  }, [bounds, cameraAnimationDurationMs, cameraCenterCoordinate, zoomLevel, padding, isReady, mapLoaded, cameraKey]);

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
      centerCoordinate: offsetCameraCenter(coordinate, nextZoomLevel, cameraScreenOffsetY),
        zoomLevel: nextZoomLevel,
        padding: prevPaddingRef.current,
        animationDuration: durationMs,
      });
    },
  }), [cameraScreenOffsetY]);

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
        onDidFinishLoadingMap={() => setMapLoaded(true)}
      >
        <MapboxGL.Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: cameraCenterCoordinate, zoomLevel, padding }}
        />

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
        <MapboxGL.ShapeSource id="routeDistanceSource" shape={routeDistanceGeoJSON}>
          <MapboxGL.SymbolLayer id="routeDistanceLabels" style={{ textField: ['get', 'label'], textSize: 10, textColor: '#475569', textHaloColor: 'rgba(255,255,255,0.99)', textHaloWidth: 2.5, textOffset: [0, -0.9], textAllowOverlap: false, textIgnorePlacement: false, textOptional: true, textAnchor: 'center' }} />
        </MapboxGL.ShapeSource>

        {nativeMarkers.map((marker) => (
          <MapboxGL.MarkerView
            // MarkerView does not reliably re-evaluate native collision after
            // allowOverlap changes. Remount only the marker whose focused
            // state changed so a deselected green pin immediately returns to
            // the normal blue-pin collision set without requiring a pan/zoom.
            // MarkerView holds a native child tree. Remount when its visual
            // role changes so a saved blue marker cannot survive into an Atlas
            // orange marker while Mapbox catches up with a prop update.
            // Orange itinerary markers keep a stable native identity. Their
            // number or focus state may change, but neither should unmount a
            // MarkerView and make an active Atlas pin flash or disappear.
            key={marker.tone === 'atlas'
              ? `${marker.id}:atlas`
              : `${marker.id}:${marker.tone ?? 'saved'}:${marker.order ?? 'none'}:${marker.id === selectedMarkerId ? 'focused' : 'normal'}`}
            coordinate={[marker.longitude, marker.latitude]}
            style={[styles.markerAnnotation, selectedMarkerId === marker.id && styles.markerAnnotationSelected, marker.tone === 'atlas' && styles.markerAnnotationAtlas]}
            // A focused point is an explicit user choice. Let its annotation
            // render above nearby markers so its mandatory label cannot be
            // discarded by native collision handling.
            // AI recommendations must remain discoverable even when they sit
            // near a saved point; native MarkerView collision would otherwise
            // hide the purple pin before the user can select it.
            allowOverlap={selectedMarkerId === marker.id || marker.tone === 'focused' || marker.tone === 'recommended' || marker.tone === 'atlas'}
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
    width: 30,
    height: 30,
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
  markerDotWrapAtlas: {
    width: 30,
    height: 30,
  },
  markerSavingPulse: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  markerSavingPulseAtlas: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 4,
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
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 4,
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
    fontSize: 11,
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
