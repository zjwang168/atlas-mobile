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

const MAPBOX_STYLE_URL = 'mapbox://styles/jaybdeng/cmspncq9r002d01sn0lnh26i8';

/** The package does not re-export its press-event type, so take it from the
    component's own props rather than importing a build-output path. */
type ShapeSourcePressEvent = Parameters<
  NonNullable<React.ComponentProps<typeof MapboxGL.ShapeSource>['onPress']>
>[0];

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
  description?: string;
  labelHint?: string;
  /** Force the React annotation tier so the standard capsule label is used. */
  renderAsAnnotation?: boolean;
  /** Keep the standard capsule label visible even when map labels collide. */
  alwaysShowLabel?: boolean;
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
  /** Source markers represented by an aggregated cluster marker. */
  clusterMembers?: MapMarker[];
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
  /** Lowest zoom accepted for a bounds camera, useful when a focused region is very large. */
  minimumBoundsZoom?: number;
  /** Prevents AI recommendation markers from being replaced by count clusters. */
  disableRecommendedClustering?: boolean;
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
  /** Resets a reused map to the standard north-up, top-down Atlas view. */
  resetCameraOrientation?: boolean;
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
// Cluster geometry, handed to the map engine rather than computed here.
// 50px is Mapbox's own default and reads well at this dot size; clustering
// stops at 14 so street-level browsing always shows individual pins.
const CLUSTER_RADIUS_PX = 50;
const CLUSTER_MAX_ZOOM = 14;
// A touch past the split point, so tapping a cluster lands on separated pins
// rather than exactly at the zoom where they are still merging.
const CLUSTER_EXPANSION_ZOOM_MARGIN = 0.4;
const CLUSTER_BURST_DURATION_MS = 360;
// A duplicate POI can arrive through a historical save, offline reconciliation,
// or two search providers. Keep one visual pin for the same named place while
// leaving the source records untouched.
const SEMANTIC_DUPLICATE_DISTANCE_METERS = 24;

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
type RenderMarker = MapMarker;
type CameraState = {
  properties: {
    center: GeoJSON.Position;
    zoom: number;
    bounds: { ne: GeoJSON.Position; sw: GeoJSON.Position };
  };
};
type ClusterBurst = {
  parent: GeoJSON.Feature<GeoJSON.Point>;
  children: GeoJSON.Feature<GeoJSON.Point>[];
  progress: number;
};

function markerVisualKey(marker: RenderMarker): string {
  return `point:${marker.id}`;
}

/**
 * Does this marker render as a native map layer rather than a React annotation?
 *
 * The ordinary saved and recommended pins — the overwhelming majority — are
 * drawn by the map engine, which clusters and repositions them itself. That is
 * what removes the blink: a `MarkerView` is a real native view mounted by
 * React, so anything that changes its key destroys and recreates it, and
 * anything that changes its `coordinate` moves it. A layer has neither.
 *
 * A pin drops back to `MarkerView` only when it needs something a layer cannot
 * express: the selected/deleting animations, a popup anchored to it, the
 * animated Atlas route pins, or the special Home/Office/School glyphs.
 */
function rendersAsLayer(
  marker: MapMarker,
  selectedMarkerId?: string | null,
  deletingMarkerId?: string | null,
  popupMarkerId?: string | null,
  disableRecommendedClustering = false,
): boolean {
  if (marker.renderAsAnnotation) return false;
  // AI outcome pins always stay in Mapbox's native single-point sources,
  // including while their action sheet is open. The sheet is an independent
  // overlay, so a React MarkerView is not needed for selection.
  if ((marker.tone === 'recommended' || marker.tone === 'atlas') && !marker.entering && !marker.pulsing) return true;
  if (marker.id === selectedMarkerId || marker.id === deletingMarkerId) return false;
  if (popupMarkerId && marker.id === popupMarkerId) return false;
  // Ordinary saved pins use the clustered native source below. Pins that need
  // animation or special glyphs still fall back to MarkerView.
  if (marker.entering || marker.pulsing) return false;
  return marker.tone === undefined || marker.tone === 'saved';
}

function markerTitleKey(marker: MapMarker): string | null {
  const title = marker.title?.trim().toLocaleLowerCase();
  if (!title) return null;
  // Keep non-Latin names intact; the former ASCII-only normalization would
  // incorrectly consider every Chinese/Japanese title equivalent.
  return title.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
}

function markerDistanceMeters(a: MapMarker, b: MapMarker): number {
  const latitudeDelta = (a.latitude - b.latitude) * 111_320;
  const longitudeDelta = (a.longitude - b.longitude) * 111_320
    * Math.cos((a.latitude + b.latitude) * Math.PI / 360);
  return Math.hypot(latitudeDelta, longitudeDelta);
}

function canMergeSemanticDuplicate(marker: MapMarker): boolean {
  return marker.tone !== 'atlas'
    && marker.tone !== 'location'
    && marker.tone !== 'home'
    && marker.tone !== 'office'
    && marker.tone !== 'school';
}

function markerRenderPriority(marker: MapMarker, selectedMarkerId?: string | null): number {
  return marker.tone === 'focused' || marker.id === selectedMarkerId ? 40
    : marker.tone === 'atlas' ? 30
      : marker.tone === 'location' ? 25
        : marker.tone === 'recommended' ? 10
          : 0;
}

function deduplicateMarkerLocations(markers: MapMarker[], selectedMarkerId?: string | null, disableRecommendedClustering = false): MapMarker[] {
  const result: MapMarker[] = [];
  for (const marker of markers) {
    const titleKey = markerTitleKey(marker);
    if (!titleKey || !canMergeSemanticDuplicate(marker) || (disableRecommendedClustering && marker.tone === 'recommended')) {
      result.push(marker);
      continue;
    }
    const duplicateIndex = result.findIndex((candidate) => (
      canMergeSemanticDuplicate(candidate)
      && markerTitleKey(candidate) === titleKey
      && markerDistanceMeters(candidate, marker) <= SEMANTIC_DUPLICATE_DISTANCE_METERS
    ));
    if (duplicateIndex < 0) {
      result.push(marker);
      continue;
    }
    // Preserve the selected/focused version so a tap cannot leave an older,
    // unselected duplicate visible beside it.
    if (markerRenderPriority(marker, selectedMarkerId) > markerRenderPriority(result[duplicateIndex], selectedMarkerId)) {
      result[duplicateIndex] = marker;
    }
  }
  return result;
}

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
  minimumZoom = 1,
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
  const zoomLevel = Math.max(minimumZoom, Math.min(20, Math.min(longitudeZoom, latitudeZoom)));

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

function screenMarkers(markers: ReadonlyArray<RenderMarker>, viewport: MapViewport, width: number, height: number): ScreenMarker[] {
  const center = projectToWorld(viewport.center, viewport.zoom);
  return markers.map((marker) => {
    const point = projectToWorld([marker.longitude, marker.latitude], viewport.zoom);
    const x = point[0] - center[0] + width / 2;
    const y = point[1] - center[1] + height / 2;
    return { marker, x, y, dotRect: { left: x - 10, top: y - 10, right: x + 10, bottom: y + 10 } };
  }).filter((point) => point.x >= -12 && point.x <= width + 12 && point.y >= -12 && point.y <= height + 12);
}

function canCluster(marker: MapMarker, selectedMarkerId?: string | null, disableRecommendedClustering = false): boolean {
  return marker.id !== selectedMarkerId
    && (!disableRecommendedClustering || marker.tone !== 'recommended')
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
  disableRecommendedClustering = false,
): RenderMarker[] {
  const radius = viewport.zoom < 9 ? 58 : viewport.zoom < 11 ? 50 : viewport.zoom < 13 ? 44 : viewport.zoom < 15 ? 36 : 0;
  const groups: ScreenMarker[][] = [];
  const standalone: ScreenMarker[] = [];
  const candidates = [...points]
    .filter((point) => canCluster(point.marker, selectedMarkerId, disableRecommendedClustering) && point.marker.id !== deletingMarkerId)
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
    if (!canCluster(point.marker, selectedMarkerId, disableRecommendedClustering) || point.marker.id === deletingMarkerId) {
      result.push(point.marker);
    }
  });
  result.push(...standalone.map((point) => point.marker));
  return result;
}

/** At close zoom, reveal points with identical (or near-identical) geocodes.
 * Their persisted coordinates stay untouched; only the annotation position is
 * offset by a few screen points so every place remains selectable. */
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
  const translateY = useRef(new Animated.Value(7)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    animationRef.current?.stop();
    animationRef.current = Animated.parallel([
      Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: visible ? 220 : 130, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: visible ? 0 : 7, duration: visible ? 220 : 130, useNativeDriver: true }),
    ]);
    animationRef.current.start();
    return () => animationRef.current?.stop();
  }, [opacity, translateY, visible]);

  const width = labelWidthForTitle(title);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.markerLabel,
        selected && styles.markerLabelSelected,
        { width, marginLeft: -width / 2, opacity: selected ? 1 : opacity, transform: [{ translateY: selected ? 0 : translateY }] },
      ]}
    >
      <View style={styles.markerLabelContent}>
        {ai ? <Ionicons name="sparkles" size={12} color="#885CF6" style={styles.markerAiIcon} /> : null}
        <View style={styles.markerLabelCopy}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.markerLabelText}>{title}</Text>
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
  const specialPlaceColor = tone === 'home' ? '#4A7FA8' : tone === 'office' ? '#596EAB' : '#3D8B86';
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
    const baseColor = tone === 'atlas' ? '#E77B32' : tone === 'recommended' ? '#885CF6' : tone === 'location' ? '#12C170' : specialPlace ? specialPlaceColor : '#007AFF';
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
  minimumBoundsZoom,
  disableRecommendedClustering = false,
  cameraScreenOffsetY = 0,
  cameraAnimationDurationMs = 2000,
  selectedMarkerId,
  showUserLocation = false,
  deletingMarkerId,
  onMapPress,
  onViewportChanged,
  onBoundsCameraApplied,
  resetCameraOrientation = false,
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
      // one stable key per id. Then collapse distinct records that describe
      // the same nearby POI, which otherwise look like duplicated blue pins.
      const unique = new Map<string, MapMarker>();
      displayMarkers.forEach((marker) => unique.set(marker.id, marker));
      return deduplicateMarkerLocations([...unique.values()], selectedMarkerId, disableRecommendedClustering)
        .sort((a, b) => markerRenderPriority(a, selectedMarkerId) - markerRenderPriority(b, selectedMarkerId));
    },
    [displayMarkers, disableRecommendedClustering, selectedMarkerId],
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
  const hasSettledViewportRef = useRef(false);
  const pendingViewportRef = useRef<MapViewport | null>(null);
  const pendingViewportSettledRef = useRef(false);
  const cameraFrameRef = useRef<number | null>(null);
  const placeSourceRef = useRef<MapboxGL.ShapeSource>(null);
  const markerPressTimestampRef = useRef(0);
  const [clusterBurst, setClusterBurst] = useState<ClusterBurst | null>(null);
  const clusterBurstFrameRef = useRef<number | null>(null);
  const handleMapLayout = (event: LayoutChangeEvent) => {
    const { width: nextWidth, height: nextHeight } = event.nativeEvent.layout;
    if (nextWidth <= 0 || nextHeight <= 0) return;
    setMapSize((current) => (
      current && current.width === nextWidth && current.height === nextHeight
        ? current
        : { width: nextWidth, height: nextHeight }
    ));
  };
  // Split once, on the marker data alone. Nothing here depends on the camera,
  // which is the point: the layer tier's contents no longer change when the
  // user pans or zooms, so there is nothing for React to remount.
  const layerMarkers = useMemo(
    () => renderedMarkers.filter((marker) => (
      rendersAsLayer(marker, selectedMarkerId, deletingMarkerId, markerPopup?.markerId, disableRecommendedClustering)
    )),
    [deletingMarkerId, disableRecommendedClustering, markerPopup?.markerId, renderedMarkers, selectedMarkerId],
  );
  const recommendedLayerMarkers = useMemo(
    () => disableRecommendedClustering
      ? layerMarkers.filter((marker) => marker.tone === 'recommended')
      : [],
    [disableRecommendedClustering, layerMarkers],
  );
  const atlasLayerMarkers = useMemo(
    () => layerMarkers.filter((marker) => marker.tone === 'atlas'),
    [layerMarkers],
  );
  const clusteredLayerMarkers = useMemo(
    () => disableRecommendedClustering
      ? layerMarkers.filter((marker) => marker.tone !== 'recommended' && marker.tone !== 'atlas')
      : layerMarkers.filter((marker) => marker.tone !== 'atlas'),
    [disableRecommendedClustering, layerMarkers],
  );
  const annotationMarkers = useMemo(
    () => renderedMarkers.filter((marker) => (
      !rendersAsLayer(marker, selectedMarkerId, deletingMarkerId, markerPopup?.markerId, disableRecommendedClustering)
    )),
    [deletingMarkerId, disableRecommendedClustering, markerPopup?.markerId, renderedMarkers, selectedMarkerId],
  );
  const layerFeatures = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => ({
    type: 'FeatureCollection',
    features: clusteredLayerMarkers.map((marker) => ({
      type: 'Feature' as const,
      id: marker.id,
      properties: {
        markerId: marker.id,
        title: marker.title ?? '',
        tone: marker.tone ?? 'saved',
      },
      geometry: { type: 'Point' as const, coordinates: [marker.longitude, marker.latitude] },
    })),
  }), [clusteredLayerMarkers]);
  const recommendedLayerFeatures = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => ({
    type: 'FeatureCollection',
    features: recommendedLayerMarkers.map((marker) => ({
      type: 'Feature' as const,
      id: marker.id,
      properties: { markerId: marker.id, title: marker.title ?? '', tone: 'recommended' },
      geometry: { type: 'Point' as const, coordinates: [marker.longitude, marker.latitude] },
    })),
  }), [recommendedLayerMarkers]);
  const atlasLayerFeatures = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => ({
    type: 'FeatureCollection',
    features: atlasLayerMarkers.map((marker) => ({
      type: 'Feature' as const,
      id: marker.id,
      properties: {
        markerId: marker.id,
        title: marker.title ?? '',
        tone: 'atlas',
        order: String(marker.order ?? ''),
      },
      geometry: { type: 'Point' as const, coordinates: [marker.longitude, marker.latitude] },
    })),
  }), [atlasLayerMarkers]);
  // Mapbox keeps the ordinary layers visible throughout a pinch/zoom. The
  // burst state below is the only time those layers yield to a transition.
  const layerVisible = true;

  const clusterBurstFeatures = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point> | null>(() => {
    if (!clusterBurst) return null;
    const origin = clusterBurst.parent.geometry.coordinates;
    const parentCount = clusterBurst.parent.properties?.point_count_abbreviated ?? clusterBurst.parent.properties?.point_count ?? '';
    const parentOpacity = Math.max(0, 1 - clusterBurst.progress * 2.5);
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { burstRole: 'parent', count: String(parentCount), opacity: parentOpacity },
          geometry: { type: 'Point', coordinates: origin },
        },
        ...clusterBurst.children.map((child, index) => {
          const target = child.geometry.coordinates;
          const progress = 1 - Math.pow(1 - clusterBurst.progress, 3);
          return {
            type: 'Feature' as const,
            id: `burst:${index}`,
            properties: {
              burstRole: 'child',
              count: child.properties?.point_count_abbreviated ?? child.properties?.point_count ?? '',
              opacity: Math.min(1, clusterBurst.progress * 2.2),
            },
            geometry: {
              type: 'Point' as const,
              coordinates: [
                origin[0] + (target[0] - origin[0]) * progress,
                origin[1] + (target[1] - origin[1]) * progress,
              ],
            },
          };
        }),
      ],
    };
  }, [clusterBurst]);

  useEffect(() => () => {
    if (clusterBurstFrameRef.current !== null) cancelAnimationFrame(clusterBurstFrameRef.current);
  }, []);
  // The label collision pass now only sees the handful of annotation pins, so
  // it costs a fraction of what it did over every marker. Mapbox does its own
  // collision for the layer tier's labels.
  const annotationMarkerPoints = useMemo(
    () => screenMarkers(annotationMarkers, viewport, width, height),
    [annotationMarkers, height, viewport, width],
  );
  const layerMarkerPoints = useMemo(
    () => screenMarkers(layerMarkers, viewport, width, height),
    [height, layerMarkers, viewport, width],
  );
  const labelOwnerMarkerPoints = useMemo(
    () => labelOwnerPoints(annotationMarkerPoints, width, height, selectedMarkerId, deletingMarkerId, markerPopup?.markerId),
    [annotationMarkerPoints, deletingMarkerId, height, markerPopup?.markerId, selectedMarkerId, width],
  );
  const labelIds = useMemo(
    () => visibleLabelIds(labelOwnerMarkerPoints, viewport, width, height, markerPopup?.markerId, selectedMarkerId),
    [height, labelOwnerMarkerPoints, markerPopup?.markerId, selectedMarkerId, viewport, width],
  );
  const layerLabelOwnerPoints = useMemo(
    () => labelOwnerPoints(layerMarkerPoints, width, height, selectedMarkerId, deletingMarkerId, markerPopup?.markerId),
    [deletingMarkerId, height, layerMarkerPoints, markerPopup?.markerId, selectedMarkerId, width],
  );
  const layerLabelIds = useMemo(
    () => visibleLabelIds(layerLabelOwnerPoints, viewport, width, height, markerPopup?.markerId, selectedMarkerId),
    [height, layerLabelOwnerPoints, markerPopup?.markerId, selectedMarkerId, viewport, width],
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
    // Only the annotation tier's label collision reads this, and the map
    // engine moves both tiers on its own, so a mid-gesture update would buy
    // nothing and cost a React render per frame.
    if (!settled && hasSettledViewportRef.current) return;
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
        onViewportChanged?.(next.center, next.zoom);
      }
    });
  };

  /**
   * A tap on the clustered source. Mapbox hands back the feature under the
   * finger — a cluster carries `point_count`, an individual pin carries the
   * `markerId` written into its properties.
   */
  const handleLayerPress = (event: ShapeSourcePressEvent) => {
    const feature = event.features[0];
    if (!feature) return;
    // Shared with the annotation tier so a pin tap is not also read as a tap
    // on the map underneath it.
    markerPressTimestampRef.current = Date.now();

    if (feature.properties?.point_count) {
      // Mapbox exposes the exact next-level children. Use those positions for
      // a short burst instead of fading one count bubble into unrelated dots.
      Promise.all([
        placeSourceRef.current?.getClusterExpansionZoom(feature),
        placeSourceRef.current?.getClusterChildren(feature),
      ])
        .then(([expansionZoom, children]) => {
          if (!expansionZoom || !children?.features?.length) return;
          const geometry = feature.geometry as GeoJSON.Point;
          const childPoints = children.features.filter((child: GeoJSON.Feature) => child.geometry?.type === 'Point') as GeoJSON.Feature<GeoJSON.Point>[];
          if (!childPoints.length) return;
          if (clusterBurstFrameRef.current !== null) cancelAnimationFrame(clusterBurstFrameRef.current);
          const startedAt = Date.now();
          const parent = feature as GeoJSON.Feature<GeoJSON.Point>;
          const animateBurst = () => {
            const progress = Math.min(1, (Date.now() - startedAt) / CLUSTER_BURST_DURATION_MS);
            setClusterBurst({ parent, children: childPoints, progress });
            if (progress < 1) {
              clusterBurstFrameRef.current = requestAnimationFrame(animateBurst);
            } else {
              clusterBurstFrameRef.current = null;
              setTimeout(() => setClusterBurst(null), 70);
            }
          };
          animateBurst();
          cameraRef.current?.setCamera({
            centerCoordinate: geometry.coordinates as [number, number],
            zoomLevel: expansionZoom + CLUSTER_EXPANSION_ZOOM_MARGIN,
            padding: prevPaddingRef.current,
            animationDuration: 340,
          });
        })
        .catch((expansionError) => {
          console.warn('[MapboxMap] cluster expansion failed:', expansionError);
        });
      return;
    }

    const markerId = feature.properties?.markerId;
    const marker = renderedMarkers.find((candidate) => candidate.id === markerId);
    if (marker) onMarkerPress?.(marker);
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
    // Include the measured viewport in the cache key. Mapbox can report the
    // first ready/layout pass before width or height is non-zero; without
    // this, that undersized fit would never be corrected for the real map.
    const nextBounds = `${cameraKey ?? ''}:${bounds.ne.join(',')}:${bounds.sw.join(',')}:${fitPadding.join(',')}:${width}x${height}`;
    if (nextBounds === previousBoundsRef.current) return;
    const camera = cameraForBounds(bounds, width, height, fitPadding, minimumBoundsZoom);
    cameraRef.current.setCamera({
      ...camera,
      ...(resetCameraOrientation ? { heading: 0, pitch: 0 } : {}),
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
  }, [bounds, cameraAnimationDurationMs, cameraKey, height, isReady, mapLoaded, minimumBoundsZoom, onBoundsCameraApplied, padding, resetCameraOrientation, width]);
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
      ...(resetCameraOrientation ? { heading: 0, pitch: 0 } : {}),
      animationDuration: cameraAnimationDurationMs,
      padding,
    });
  }, [bounds, cameraAnimationDurationMs, cameraCenterCoordinate, zoomLevel, padding, isReady, mapLoaded, cameraKey, resetCameraOrientation]);

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
        styleURL={MAPBOX_STYLE_URL}
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
          defaultSettings={{ centerCoordinate: cameraCenterCoordinate, zoomLevel, ...(resetCameraOrientation ? { heading: 0, pitch: 0 } : {}), padding }}
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

        {/* The bulk of the pins. Clustering, placement, and label collision all
            happen inside the map engine, so panning and zooming never touch
            React — which is what removes both the blink and the drift. */}
        <MapboxGL.ShapeSource
          ref={placeSourceRef}
          id="placePoints"
          shape={layerFeatures}
          cluster
          clusterRadius={CLUSTER_RADIUS_PX}
          clusterMaxZoomLevel={CLUSTER_MAX_ZOOM}
          onPress={handleLayerPress}
        >
          <MapboxGL.CircleLayer
            id="placeClusterCircle"
            filter={['has', 'point_count']}
            style={{
              // Restore the familiar map count marker: a saturated blue
              // bubble, white count, and a fine white edge.
              circleColor: '#0A84FF',
              circleOpacity: layerVisible && !clusterBurst ? 0.96 : 0,
              circleOpacityTransition: { duration: 180, delay: 0 },
              circleRadius: 16,
              circleRadiusTransition: { duration: 220, delay: 0 },
              circleStrokeWidth: 1.5,
              circleStrokeColor: '#FFFFFF',
              circleStrokeColorTransition: { duration: 180, delay: 0 },
            }}
          />
          <MapboxGL.SymbolLayer
            id="placeClusterCount"
            filter={['has', 'point_count']}
            style={{
              textField: ['get', 'point_count_abbreviated'],
              textSize: 14,
              textFont: ['Open Sans Bold'],
              textColor: '#FFFFFF',
              textOpacity: layerVisible && !clusterBurst ? 1 : 0,
              textOpacityTransition: { duration: 180, delay: 0 },
              // The count belongs to its bubble; letting the engine drop it
              // would leave an unexplained circle.
              textAllowOverlap: true,
              textIgnorePlacement: true,
            }}
          />
          <MapboxGL.CircleLayer
            id="placePointCircle"
            filter={['!', ['has', 'point_count']]}
            style={{
              circleColor: ['match', ['get', 'tone'], 'recommended', '#885CF6', '#007AFF'],
              circleRadius: 7,
              circleOpacity: layerVisible && !clusterBurst ? 1 : 0,
              circleRadiusTransition: { duration: 220, delay: 0 },
              circleOpacityTransition: { duration: 180, delay: 0 },
              circleStrokeWidth: 3,
              circleStrokeColor: '#FFFFFF',
            }}
          />
          <MapboxGL.SymbolLayer
            id="placePointLabel"
            filter={['!', ['has', 'point_count']]}
            style={{
              textField: ['get', 'title'],
              textSize: 12,
              // The capsule labels below use the same collision decision but
              // a native view so they can match the original design.
              textOpacity: 0,
              textColor: '#1F2937',
              textHaloColor: 'rgba(255,255,255,0.95)',
              textHaloWidth: 2,
              // A single pin earns a label above it once Mapbox's own
              // collision engine has enough room at the current zoom.
              textOffset: [0, -1.05],
              textAnchor: 'bottom',
              textOpacityTransition: { duration: 220, delay: 35 },
              textTranslateTransition: { duration: 220, delay: 35 },
              // Unlike the count, a name may be dropped: this is Mapbox's own
              // collision pass, and it is what keeps dense areas readable.
              textOptional: true,
              textAllowOverlap: false,
            }}
          />
        </MapboxGL.ShapeSource>
        {recommendedLayerMarkers.length > 0 ? (
          <MapboxGL.ShapeSource
            id="recommendedPoints"
            shape={recommendedLayerFeatures}
            cluster={false}
            onPress={handleLayerPress}
          >
            <MapboxGL.CircleLayer
              id="recommendedPointCircle"
              style={{
                circleColor: '#885CF6',
                circleRadius: 7,
                circleOpacity: layerVisible ? 1 : 0,
                circleRadiusTransition: { duration: 220, delay: 0 },
                circleOpacityTransition: { duration: 180, delay: 0 },
                circleStrokeWidth: 3,
                circleStrokeColor: '#FFFFFF',
              }}
            />
            <MapboxGL.SymbolLayer
              id="recommendedPointLabel"
              style={{
                textField: ['get', 'title'],
                textSize: 12,
                textFont: ['Open Sans SemiBold'],
                textColor: '#312E4B',
                textHaloColor: 'rgba(255,255,255,0.98)',
                textHaloWidth: 2.5,
                textOffset: [0, -1.25],
                textAnchor: 'bottom',
                textOptional: true,
                textAllowOverlap: false,
                textIgnorePlacement: false,
              }}
            />
          </MapboxGL.ShapeSource>
        ) : null}
        {atlasLayerMarkers.length > 0 ? (
          <MapboxGL.ShapeSource id="atlasPoints" shape={atlasLayerFeatures} cluster={false} onPress={handleLayerPress}>
            <MapboxGL.CircleLayer
              id="atlasPointCircle"
              style={{
                circleColor: '#E77B32',
                circleRadius: 11,
                circleOpacity: layerVisible ? 1 : 0,
                circleRadiusTransition: { duration: 220, delay: 0 },
                circleOpacityTransition: { duration: 180, delay: 0 },
                circleStrokeWidth: 3,
                circleStrokeColor: '#FFFFFF',
              }}
            />
            <MapboxGL.SymbolLayer
              id="atlasPointOrder"
              style={{
                textField: ['get', 'order'],
                textSize: 13,
                textFont: ['Open Sans Bold'],
                textColor: '#FFFFFF',
                textAllowOverlap: true,
                textIgnorePlacement: true,
              }}
            />
          </MapboxGL.ShapeSource>
        ) : null}
        {clusterBurstFeatures ? (
          <MapboxGL.ShapeSource id="placeClusterBurst" shape={clusterBurstFeatures}>
            <MapboxGL.CircleLayer
            id="placeClusterBurstCircle"
              filter={['!=', ['get', 'count'], '']}
              style={{
                circleColor: '#0A84FF',
                circleRadius: 16,
                circleOpacity: ['get', 'opacity'],
                circleStrokeWidth: 1.5,
                circleStrokeColor: '#FFFFFF',
              }}
            />
            <MapboxGL.CircleLayer
              id="placeClusterBurstPoint"
              filter={['==', ['get', 'count'], '']}
              style={{
                circleColor: '#007AFF',
                circleRadius: 7,
                circleOpacity: ['get', 'opacity'],
                circleStrokeWidth: 3,
                circleStrokeColor: '#FFFFFF',
              }}
            />
            <MapboxGL.SymbolLayer
              id="placeClusterBurstCount"
              filter={['!=', ['get', 'count'], '']}
              style={{
                textField: ['get', 'count'],
                textSize: 14,
                textFont: ['Open Sans Bold'],
                textColor: '#FFFFFF',
                textOpacity: ['get', 'opacity'],
                textAllowOverlap: true,
                textIgnorePlacement: true,
              }}
            />
          </MapboxGL.ShapeSource>
        ) : null}

        {/* These are visual-only label views. Pins stay in the GPU layer; the
            labels are capped by the same collision pass and never receive
            touches, so map gestures remain entirely with Mapbox. */}
        {layerMarkers.filter((marker) => marker.tone !== 'recommended' && layerLabelIds.has(marker.id) && marker.title).map((marker) => (
          <MapboxGL.MarkerView
            key={`layer-label:${marker.id}`}
            coordinate={[marker.longitude, marker.latitude]}
            style={styles.markerLabelAnnotation}
            allowOverlap
          >
            <MarkerLabel
              title={marker.title!}
              hint={marker.labelHint}
              ai={marker.ai}
              visible={layerVisible && !clusterBurst}
              selected={false}
            />
          </MapboxGL.MarkerView>
        ))}

        {annotationMarkers.map((marker) => (
          <MapboxGL.MarkerView
            key={markerVisualKey(marker)}
            coordinate={[marker.longitude, marker.latitude]}
            style={[styles.markerAnnotation, selectedMarkerId === marker.id && styles.markerAnnotationSelected, marker.tone === 'atlas' && styles.markerAnnotationAtlas, marker.tone === 'location' && styles.markerAnnotationLocation, (marker.tone === 'home' || marker.tone === 'office' || marker.tone === 'school') && styles.markerAnnotationSpecialPlace]}
            // These few carry their own animations; keep them out of Mapbox's
            // collision engine so they cannot block a pan or zoom gesture.
            allowOverlap
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
                preserveToneOnSelect={marker.preserveToneOnSelect}
              />
              {marker.title ? (
                <MarkerLabel
                  title={marker.title}
                  hint={marker.labelHint}
                  ai={marker.ai}
                  visible={marker.alwaysShowLabel || marker.tone === 'recommended' || selectedMarkerId === marker.id || labelIds.has(marker.id)}
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
  markerLabelAnnotation: {
    width: 1,
    height: 1,
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
    bottom: 30,
    left: '50%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.14)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 7,
    elevation: 4,
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
    fontSize: 13,
    lineHeight: 16,
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.92)',
    backgroundColor: '#0A84FF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterCount: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
  },
  clusterCountOverlay: {
    position: 'absolute',
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
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#152238',
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
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
