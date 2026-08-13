import MapboxGL from '@rnmapbox/maps';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View, ViewStyle, type LayoutChangeEvent, useWindowDimensions } from 'react-native';
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
  tone?: 'saved' | 'focused' | 'atlas' | 'recommended' | 'location' | 'home' | 'office' | 'school';
  /** Number shown inside a saved Atlas route pin. */
  order?: number;
  /** Animates a marker when an Atlas item is added. */
  entering?: boolean;
  /** Shows the small save-progress pulse around an Atlas marker. */
  pulsing?: boolean;
  /** Keeps this marker's visual tone when it is selected. */
  preserveToneOnSelect?: boolean;
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
  routeVariant?: 'commute';
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
  /** Draw the current-position puck. Only pass true once location permission
      is granted — see the render site. */
  showUserLocation?: boolean;
  deletingMarkerId?: string | null;
  onMapPress?: () => void;
  onViewportChanged?: (center: [number, number], zoom: number) => void;
  /** Called after this map instance applies a bounds-based camera command. */
  onBoundsCameraApplied?: () => void;
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
type RenderMarker = MapMarker & { clusterMembers?: MapMarker[] };
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

function canCluster(marker: MapMarker, selectedMarkerId?: string | null): boolean {
  return marker.id !== selectedMarkerId
    && marker.tone !== 'atlas'
    && marker.tone !== 'location'
    && marker.tone !== 'focused'
    && marker.tone !== 'home'
    && marker.tone !== 'office'
    && marker.tone !== 'school';
}

/** Group ordinary saved/recommended pins in screen space. Native MarkerView
 * stays overlap-safe; this is the visual density policy owned by the app. */
function clusterMarkerPoints(
  points: ScreenMarker[],
  viewport: MapViewport,
  selectedMarkerId?: string | null,
  deletingMarkerId?: string | null,
): RenderMarker[] {
  const radius = viewport.zoom < 9 ? 58 : viewport.zoom < 11 ? 50 : viewport.zoom < 13 ? 44 : viewport.zoom < 15 ? 36 : viewport.zoom < 16 ? 28 : 0;
  const groups: ScreenMarker[][] = [];
  const standalone: ScreenMarker[] = [];
  const candidates = [...points]
    .filter((point) => canCluster(point.marker, selectedMarkerId) && point.marker.id !== deletingMarkerId)
    .sort((a, b) => a.marker.id.localeCompare(b.marker.id));

  for (const point of candidates) {
    const matching = groups.filter((group) => group.some((member) => Math.hypot(member.x - point.x, member.y - point.y) <= radius));
    if (!matching.length) {
      groups.push([point]);
      continue;
    }
    matching[0].push(point);
    for (const other of matching.slice(1)) {
      matching[0].push(...other);
      const index = groups.indexOf(other);
      if (index >= 0) groups.splice(index, 1);
    }
  }

  const result: RenderMarker[] = [];
  groups.forEach((group) => {
    if (group.length === 1) {
      standalone.push(group[0]);
      return;
    }
    const longitude = group.reduce((sum, point) => sum + point.marker.longitude, 0) / group.length;
    const latitude = group.reduce((sum, point) => sum + point.marker.latitude, 0) / group.length;
    const members = group.map((point) => point.marker);
    result.push({
      id: `cluster:${members.map((member) => member.id).sort().join('|')}`,
      longitude,
      latitude,
      tone: 'saved',
      clusterMembers: members,
    });
  });

  // Keep points which must never be hidden (selected, route, and special pins).
  points.forEach((point) => {
    if (!canCluster(point.marker, selectedMarkerId) || point.marker.id === deletingMarkerId) {
      result.push(point.marker);
    }
  });
  result.push(...standalone.map((point) => point.marker));
  return result;
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
  preserveToneOnSelect = false,
}: {
  selected: boolean;
  deleting: boolean;
  tone?: MapMarker['tone'];
  order?: number;
  hasActiveSelection: boolean;
  entering?: boolean;
  pulsing?: boolean;
  preserveToneOnSelect?: boolean;
}) {
  const exit = useSharedValue(0);
  const entry = useSharedValue(entering ? 0 : 1);
  const pulse = useSharedValue(0);
  const selectedProgress = useSharedValue(selected || tone === 'focused' ? 1 : 0);
  const specialPlace = tone === 'home' || tone === 'office' || tone === 'school';
  const hasLocationPulse = pulsing || selected || tone === 'focused';
  const useLocationPulseStyle = tone === 'location' || tone === 'focused';
  useEffect(() => {
    exit.value = deleting ? withTiming(1, { duration: 440 }) : withTiming(0, { duration: 160 });
  }, [deleting, exit]);
  useEffect(() => {
    entry.value = entering ? withTiming(1, { duration: 420 }) : 1;
  }, [entering, entry]);
  useEffect(() => {
    pulse.value = hasLocationPulse
      ? withRepeat(withTiming(1, { duration: useLocationPulseStyle ? 900 : 3600 }), -1, useLocationPulseStyle)
      : withTiming(0, { duration: 280 });
  }, [hasLocationPulse, pulse, useLocationPulseStyle]);
  useEffect(() => {
    const isFocused = selected || tone === 'focused';
    // Switching directly from one point to another should never leave two
    // green pins on screen. Only a true deselect animates the outgoing pin.
    const duration = isFocused ? 140 : hasActiveSelection ? 0 : 220;
    selectedProgress.value = withTiming(isFocused ? 1 : 0, { duration });
  }, [hasActiveSelection, selected, selectedProgress, tone]);
  const animatedStyle = useAnimatedStyle(() => {
    const atlasPin = tone === 'atlas';
    const baseColor = tone === 'atlas' ? '#E77B32' : tone === 'recommended' ? '#885CF6' : tone === 'location' ? '#12C170' : specialPlace ? '#1F2937' : '#007AFF';
    // Green is the explicit current-choice state in the editor. AI pins stay
    // purple only while unselected; an orange Atlas pin keeps its route color.
    const selectedColor = tone === 'atlas'
      ? '#E77B32'
      : tone === 'recommended' && preserveToneOnSelect
        ? '#885CF6'
        : '#12C170';
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
    opacity: hasLocationPulse
      ? useLocationPulseStyle
        ? interpolate(pulse.value, [0, 0.5, 1], [0.86, 0.48, 0.86])
        : interpolate(pulse.value, [0, 0.88, 1], [1, 1, 0])
      : 0,
    transform: [{ scale: hasLocationPulse ? useLocationPulseStyle ? interpolate(pulse.value, [0, 1], [1, 1.2]) : interpolate(pulse.value, [0, 1], [1, 3.56]) : 1 }],
  }));
  return (
    <View style={[styles.markerDotWrap, tone === 'atlas' && styles.markerDotWrapAtlas, tone === 'location' && styles.markerDotWrapLocation, specialPlace && styles.markerDotWrapSpecialPlace]}>
      {hasLocationPulse ? <Reanimated.View pointerEvents="none" style={[styles.markerSavingPulse, tone === 'atlas' && styles.markerSavingPulseAtlas, useLocationPulseStyle && styles.markerLocationPulse, pulseStyle]} /> : null}
      <Reanimated.View style={[styles.marker, selected && styles.markerSelectedLayer, tone === 'atlas' && styles.markerAtlas, tone === 'recommended' && styles.markerRecommended, tone === 'location' && styles.markerLocation, specialPlace && styles.markerSpecialPlace, selected && tone === 'atlas' && styles.markerAtlasSelected, animatedStyle]}>
        {tone === 'home' ? <Ionicons name="home" size={16} color="#FFFFFF" /> : null}
        {tone === 'office' ? <Ionicons name="business" size={16} color="#FFFFFF" /> : null}
        {tone === 'school' ? <Ionicons name="school" size={16} color="#FFFFFF" /> : null}
        {order ? <Text style={styles.markerOrder}>{order}</Text> : null}
      </Reanimated.View>
    </View>
  );
}

function MarkerCluster({ count }: { count: number }) {
  return (
    <View style={styles.clusterOuter}>
      <View style={styles.clusterInner}>
        <Text style={styles.clusterCount}>{count > 99 ? '99+' : count}</Text>
      </View>
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
  routeVariant,
  routeDistanceLabels,
  routeMarkers,
  padding,
  cameraScreenOffsetY = 0,
  cameraAnimationDurationMs = 2000,
  selectedMarkerId,
  showUserLocation = false,
  deletingMarkerId,
  onMapPress,
  onViewportChanged,
  onBoundsCameraApplied,
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
        marker.tone === 'focused' || marker.id === selectedMarkerId ? 40
          : marker.tone === 'atlas' ? 30
            : marker.tone === 'location' ? 25
            : marker.tone === 'recommended' ? 10
              : 0
      );
      return list.sort((a, b) => markerPriority(a) - markerPriority(b));
    },
    [displayMarkers, selectedMarkerId],
  );
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [mapSize, setMapSize] = useState<{ width: number; height: number } | null>(null);
  const width = mapSize?.width ?? windowWidth;
  const height = mapSize?.height ?? windowHeight;
  const { top: safeTop } = useSafeAreaInsets();
  // Dormant — the compass is disabled below, so nothing renders at this
  // position. Kept so re-enabling it drops the compass clear of the top
  // overlay row instead of underneath it.
  const compassTop = safeTop + 48;
  const cameraRef = useRef<MapboxGL.Camera>(null);
  const [isReady, setIsReady] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<MapViewport>({ center: cameraCenterCoordinate, zoom: zoomLevel });
  const [clusterViewport, setClusterViewport] = useState<MapViewport>({ center: cameraCenterCoordinate, zoom: zoomLevel });
  const hasSettledViewportRef = useRef(false);
  const pendingViewportRef = useRef<MapViewport | null>(null);
  const pendingViewportSettledRef = useRef(false);
  const cameraFrameRef = useRef<number | null>(null);
  const markerPressTimestampRef = useRef(0);
  const handleMapLayout = (event: LayoutChangeEvent) => {
    const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
    if (nextWidth <= 0 || nextHeight <= 0) return;
    setMapSize((current) => (
      current && current.width === nextWidth && current.height === nextHeight
        ? current
        : { width: nextWidth, height: nextHeight }
    ));
  };
  const effectiveClusterViewport = hasSettledViewportRef.current ? clusterViewport : viewport;
  const clusterSourceMarkerPoints = useMemo(
    () => screenMarkers(renderedMarkers, effectiveClusterViewport, width, height),
    [effectiveClusterViewport, height, renderedMarkers, width],
  );
  const clusteredMarkers = useMemo(
    () => clusterMarkerPoints(clusterSourceMarkerPoints, effectiveClusterViewport, selectedMarkerId, deletingMarkerId),
    [clusterSourceMarkerPoints, deletingMarkerId, effectiveClusterViewport, selectedMarkerId],
  );
  const clusteredMarkerPoints = useMemo(
    () => screenMarkers(clusteredMarkers, viewport, width, height),
    [clusteredMarkers, height, viewport, width],
  );
  const labelOwnerMarkerPoints = useMemo(
    () => labelOwnerPoints(clusteredMarkerPoints, width, height, selectedMarkerId, deletingMarkerId, markerPopup?.markerId),
    [clusteredMarkerPoints, deletingMarkerId, height, markerPopup?.markerId, selectedMarkerId, width],
  );
  const nativeMarkers = useMemo<RenderMarker[]>(() => {
    // MarkerView is a React/native view for every point. Keep the active Atlas
    // pins and selected point, while retaining every visible cluster. Labels
    // still use their own collision pass, but hiding a cluster would make its
    // count misleading and leave users unable to drill into that area.
    const selected = renderedMarkers.filter((marker) => marker.id === selectedMarkerId);
    const persistent = renderedMarkers.filter((marker) => (
      marker.tone === 'atlas'
      || marker.tone === 'location'
      || marker.tone === 'focused'
      || marker.tone === 'home'
      || marker.tone === 'office'
      || marker.tone === 'school'
    ));
    const nearby = clusteredMarkerPoints
      .filter((point) => point.marker.id !== selectedMarkerId)
      .sort((a, b) => Math.hypot(a.x - width / 2, a.y - height / 2) - Math.hypot(b.x - width / 2, b.y - height / 2))
      .slice(0, 96)
      .map((point) => point.marker)
    return [...new Map([...persistent, ...selected, ...nearby].map((marker) => [marker.id, marker])).values()];
  }, [clusteredMarkerPoints, clusteredMarkers, renderedMarkers, selectedMarkerId, width]);
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

  const queueViewportUpdate = (state: CameraState, settled = false) => {
    const nextViewport = viewportFromCamera(state);
    pendingViewportRef.current = nextViewport;
    pendingViewportSettledRef.current = pendingViewportSettledRef.current || settled;
    if (cameraFrameRef.current !== null) return;
    cameraFrameRef.current = requestAnimationFrame(() => {
      cameraFrameRef.current = null;
      const next = pendingViewportRef.current;
      if (!next) return;
      const didSettle = pendingViewportSettledRef.current;
      pendingViewportRef.current = null;
      pendingViewportSettledRef.current = false;
      setViewport(next);
      if (didSettle) {
        hasSettledViewportRef.current = true;
        setClusterViewport(next);
        onViewportChanged?.(next.center, next.zoom);
      }
    });
  };

  const handleClusterPress = (members: MapMarker[]) => {
    if (members.length < 2 || !cameraRef.current) return;
    const coordinates = members.map((marker) => [marker.longitude, marker.latitude] as [number, number]);
    const longitudes = coordinates.map(([longitude]) => longitude);
    const latitudes = coordinates.map(([, latitude]) => latitude);
    const west = Math.min(...longitudes);
    const east = Math.max(...longitudes);
    const south = Math.min(...latitudes);
    const north = Math.max(...latitudes);
    const longitudeSpan = Math.max(0.004, east - west);
    const latitudeSpan = Math.max(0.004, north - south);
    cameraRef.current.setCamera({
      bounds: {
        ne: [east + longitudeSpan * 0.32, north + latitudeSpan * 0.32],
        sw: [west - longitudeSpan * 0.32, south - latitudeSpan * 0.32],
      },
      padding: prevPaddingRef.current,
      animationDuration: 340,
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
    onBoundsCameraApplied?.();
  }, [bounds, cameraAnimationDurationMs, cameraKey, height, isReady, mapLoaded, onBoundsCameraApplied, padding, width]);
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
      <View onLayout={handleMapLayout} style={[styles.container, style]}>
      <MapboxGL.MapView
        style={{ width, height }}
        styleURL={MapboxGL.StyleURL.Street}
        compassEnabled={compassEnabled}
        compassPosition={{ top: compassTop, right: 16 }}
        logoEnabled={false}
        attributionEnabled={false}
        scaleBarEnabled={false}
        onPress={handleMapPress}
        // A camera event fires continuously while a gesture is in progress.
        // Keep the current cluster arrangement in place until Mapbox reports
        // idle, so pins do not trade places at collision thresholds mid-pan.
        onCameraChanged={(event) => queueViewportUpdate(event, false)}
        onMapIdle={(event) => queueViewportUpdate(event, true)}
        onDidFinishLoadingMap={() => setMapLoaded(true)}
      >
        <MapboxGL.Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: cameraCenterCoordinate, zoomLevel, padding }}
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
                lineColor: routeVariant === 'commute' ? '#8BB8F2' : '#C9693C',
                lineWidth: 13,
                lineOpacity: routeVariant === 'commute' ? 0.24 : 0.12,
                lineOffset: 2,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <MapboxGL.LineLayer
              id="routeLine"
              style={{
                lineColor: routeVariant === 'commute' ? '#6FA7EE' : '#F29A69',
                lineWidth: 8,
                lineOpacity: routeVariant === 'commute' ? 0.9 : 0.9,
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

        {nativeMarkers.map((marker) => {
          const clusterMembers = marker.clusterMembers;
          const isCluster = Boolean(clusterMembers?.length && clusterMembers.length > 1);
          return (
          <MapboxGL.MarkerView
            key={isCluster
              ? marker.id
              : marker.tone === 'atlas'
              ? `${marker.id}:atlas`
              : `${marker.id}:${marker.tone ?? 'saved'}:${marker.order ?? 'none'}:${marker.id === selectedMarkerId ? 'focused' : 'normal'}`}
            coordinate={[marker.longitude, marker.latitude]}
            style={[styles.markerAnnotation, isCluster && styles.markerAnnotationCluster, selectedMarkerId === marker.id && styles.markerAnnotationSelected, marker.tone === 'atlas' && styles.markerAnnotationAtlas, marker.tone === 'location' && styles.markerAnnotationLocation, (marker.tone === 'home' || marker.tone === 'office' || marker.tone === 'school') && styles.markerAnnotationSpecialPlace]}
            // React already mounts one point per collision group above. Keep
            // these animated native views out of Mapbox's collision engine so
            // dense Atlas markers cannot block pan or zoom gestures.
            allowOverlap
          >
            <View
              style={styles.markerContainer}
              onTouchEnd={() => {
                markerPressTimestampRef.current = Date.now();
                if (isCluster && clusterMembers) {
                  handleClusterPress(clusterMembers);
                  return;
                }
                onMarkerPress?.(marker);
              }}
            >
              {isCluster && clusterMembers ? <MarkerCluster count={clusterMembers.length} /> : <MarkerDot
                selected={selectedMarkerId === marker.id}
                deleting={deletingMarkerId === marker.id}
                tone={marker.tone}
                order={marker.order}
                hasActiveSelection={Boolean(selectedMarkerId)}
                entering={marker.entering}
                pulsing={marker.pulsing}
                preserveToneOnSelect={marker.preserveToneOnSelect}
              />}
              {!isCluster && marker.title ? (
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
          );
        })}
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
  markerAnnotationCluster: {
    width: 42,
    height: 42,
    zIndex: 60,
    elevation: 60,
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
  markerAnnotationLocation: {
    width: 30,
    height: 30,
    zIndex: 130,
    elevation: 130,
  },
  markerAnnotationSpecialPlace: {
    width: 30,
    height: 30,
    zIndex: 135,
    elevation: 135,
  },
  markerDotWrapLocation: {
    width: 30,
    height: 30,
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
  clusterOuter: {
    width: 42,
    height: 42,
    borderRadius: 21,
    padding: 4,
    backgroundColor: 'rgba(0,122,255,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterInner: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#007AFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.24,
    shadowRadius: 4,
    elevation: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterCount: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
  },
  markerDotWrapAtlas: {
    width: 30,
    height: 30,
  },
  markerDotWrapSpecialPlace: {
    width: 30,
    height: 30,
  },
  markerSpecialPlace: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 4,
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
  markerLocationPulse: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.96)',
    backgroundColor: 'rgba(255,255,255,0.22)',
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
  markerLocation: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    backgroundColor: '#12C170',
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
