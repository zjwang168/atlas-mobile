import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppDialog } from '@/components/feedback/AppDialog';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import ContentPanel, { SNAP_HEIGHTS } from '@/components/content-panel/ContentPanel';
import { useHome, type AtlasMapState } from '@/features/home/HomeContext';
import type { MapMarker } from '@/features/map/MapboxMap';
import { atlasCameraFromStops } from '@/features/map/atlasCamera';
import AtlasBuilder, { type AtlasSavedMapView, type DraftPlace } from '@/features/my-plan/atlas-builder/AtlasBuilder';
import { createChatSession, requestAtlasRoute, requestMapboxDirections, requestMapboxOptimization } from '@/services/api/apiService';
import { decodeAtlasPlaceMetadata, type AtlasTransportMode } from '@/services/atlas/atlasPlaceMetadata';
import { updateAtlas } from '@/services/atlas/atlasService';
import type { Atlas } from '@/types/atlas';
import type { SavedPlace } from '@/services/place/placeService';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { captureRef, captureScreen } from 'react-native-view-shot';
import Share, { Social } from 'react-native-share';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, Image, Linking, Modal, Platform, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';
import { updateAtlasPlace } from '@/services/atlas/atlasPlacesService';

type AtlasDetailProps = {
  atlasId: string | null;
  onDismiss: () => void;
  snapGroup?: string;
  onHeightChange?: (height: number) => void;
};

type AtlasDisplayPlace = Pick<SavedPlace, 'id' | 'name' | 'subtitle' | 'latitude' | 'longitude' | 'photo_url'>;
type ItineraryItem = { place: AtlasDisplayPlace; rowId: string; note: string | null; day: number | null; time: string | null; transport: AtlasTransportMode | null };
type FocusBounds = { ne: [number, number]; sw: [number, number] };

function itineraryKeyExtractor(item: ItineraryItem): string {
  return item.rowId;
}
type RouteFeature = GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>;
type MapPresentation = {
  markers: MapMarker[];
  centerCoordinate?: [number, number];
  zoomLevel: number;
  bounds?: FocusBounds;
  routeGeoJSON?: RouteFeature;
};
type RouteCamera = { centerCoordinate: [number, number]; zoomLevel: number; bounds: FocusBounds; cameraAnimationDurationMs: number; cameraKey: string };
const TRANSPORT_PRESENTATION: Record<AtlasTransportMode, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  walk: { label: 'Walk', icon: 'walk-outline' },
  bike: { label: 'Bike', icon: 'bicycle-outline' },
  drive: { label: 'Drive', icon: 'car-outline' },
  taxi: { label: 'Taxi', icon: 'car-sport-outline' },
  bus: { label: 'Bus', icon: 'bus-outline' },
  coach: { label: 'Coach', icon: 'bus-outline' },
  subway: { label: 'Subway', icon: 'train-outline' },
  train: { label: 'Train', icon: 'train-outline' },
  ferry: { label: 'Ferry', icon: 'boat-outline' },
  flight: { label: 'Flight', icon: 'airplane-outline' },
};
// Keep the orange-pin overview above the completed Atlas sheet and its route
// control, so the lowest stop remains fully tappable and visible.
const ATLAS_DETAIL_CAMERA_VERTICAL_OFFSET = 28;
// Let the My Places surface take over before replacing the Atlas-owned map
// markers with the full saved-places set. Updating both at once can make the
// native Mapbox marker reconciliation block the close tap for several seconds.
const ATLAS_MAP_RELEASE_DELAY_MS = 320;

function getMapPresentation(items: ItineraryItem[], route: Atlas['route_geojson']): MapPresentation {
  if (!items.length) return { markers: [], centerCoordinate: undefined, zoomLevel: 6 };
  const camera = atlasCameraFromStops(items.map((item) => ({
    id: item.place.id,
    title: item.place.name,
    description: item.place.subtitle,
    latitude: item.place.latitude,
    longitude: item.place.longitude,
  })));
  if (!camera) return { markers: [], centerCoordinate: undefined, zoomLevel: 6 };
  return {
    ...camera,
    zoomLevel: 10,
    routeGeoJSON: route ?? undefined,
  };
}

function sameAtlasStops(left: MapMarker[], right: MapMarker[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((marker, index) => {
    const other = right[index];
    return other?.id === marker.id
      && other.order === marker.order
      && other.longitude === marker.longitude
      && other.latitude === marker.latitude;
  });
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Route request timed out')), timeoutMs);
    promise.then((value) => {
      clearTimeout(timeout);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function routeLines(route: RouteFeature): GeoJSON.Position[][] {
  return route.geometry.type === 'LineString' ? [route.geometry.coordinates] : route.geometry.coordinates;
}

function makeRoute(lines: GeoJSON.Position[][], segmentPairs: number[]): RouteFeature | null {
  const validLines = lines.filter((line) => line.length >= 2);
  if (!validLines.length) return null;
  return {
    type: 'Feature',
    properties: { segmentPairs },
    geometry: { type: 'MultiLineString', coordinates: validLines },
  };
}

function routeSegmentPairs(route: RouteFeature): number[] {
  const pairs = route.properties?.segmentPairs;
  return Array.isArray(pairs) && pairs.every((value) => typeof value === 'number')
    ? pairs as number[]
    : routeLines(route).map((_, index) => index);
}

function haversineKm(a: GeoJSON.Position, b: GeoJSON.Position): number {
  const radians = Math.PI / 180;
  const latitudeDelta = (b[1] - a[1]) * radians;
  const longitudeDelta = (b[0] - a[0]) * radians;
  const radius = 6371;
  const h = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function routeDistanceLabel(line: GeoJSON.Position[], index: number) {
  const length = line.slice(1).reduce((total, point, pointIndex) => total + haversineKm(line[pointIndex], point), 0);
  let travelled = 0;
  const midpointDistance = length / 2;
  for (let pointIndex = 1; pointIndex < line.length; pointIndex += 1) {
    const start = line[pointIndex - 1];
    const end = line[pointIndex];
    const segmentLength = haversineKm(start, end);
    if (travelled + segmentLength >= midpointDistance) {
      const progress = segmentLength ? (midpointDistance - travelled) / segmentLength : 0;
      return { id: `route-distance-${index}`, coordinate: [start[0] + (end[0] - start[0]) * progress, start[1] + (end[1] - start[1]) * progress] as [number, number], text: length >= 10 ? `${Math.round(length)} km` : `${length.toFixed(1)} km` };
    }
    travelled += segmentLength;
  }
  return { id: `route-distance-${index}`, coordinate: [line[0][0], line[0][1]] as [number, number], text: `${length.toFixed(1)} km` };
}

function nearestRoutePointIndex(coordinates: GeoJSON.Position[], place: AtlasDisplayPlace): number {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  coordinates.forEach(([longitude, latitude], index) => {
    const distance = (longitude - place.longitude) ** 2 + (latitude - place.latitude) ** 2;
    if (distance < closestDistance) { closestIndex = index; closestDistance = distance; }
  });
  return closestIndex;
}

function routeDistanceLabelsForItems(route: RouteFeature, items: ItineraryItem[]) {
  if (route.geometry.type === 'MultiLineString') return routeLines(route).map(routeDistanceLabel);
  const coordinates = route.geometry.coordinates;
  if (items.length < 2 || coordinates.length < 2) return [];
  let previousIndex = nearestRoutePointIndex(coordinates, items[0].place);
  return items.slice(1).flatMap((item, index) => {
    const nextIndex = Math.max(previousIndex, nearestRoutePointIndex(coordinates, item.place));
    const segment = coordinates.slice(previousIndex, nextIndex + 1);
    previousIndex = nextIndex;
    return segment.length >= 2 ? [routeDistanceLabel(segment, index)] : [];
  });
}

export default function AtlasDetail({ atlasId, onDismiss, snapGroup, onHeightChange }: AtlasDetailProps) {
  const { show: showDialog } = useAppDialog();
  const { atlases, savedPlaces, atlasPlaces, atlasMapState, setAtlasMapState, setSelectedPlaceCoordinate: setHomeSelectedPlaceCoordinate, setSelectedPlaceId: setHomeSelectedPlaceId, addChatHistoryItem, replaceChatHistoryItem, setActiveHistoryItem, setActiveSidekick, userLocation } = useHome();
  const [editing, setEditing] = useState(false);
  // AtlasDetail stays mounted while the active Atlas changes. Pair the
  // selection with its owner so a pin selected in one Atlas can never appear
  // selected after another Atlas opens.
  const [selectedPlace, setSelectedPlace] = useState<{ atlasId: string; placeId: string } | null>(null);
  const selectedPlaceId = selectedPlace?.atlasId === atlasId ? selectedPlace.placeId : null;
  const setSelectedPlaceId = useCallback((placeId: string | null) => {
    setSelectedPlace(placeId && atlasId ? { atlasId, placeId } : null);
  }, [atlasId]);
  const [routeFeature, setRouteFeature] = useState<RouteFeature | null>(null);
  const [displayedRoute, setDisplayedRoute] = useState<RouteFeature | null>(null);
  const [routeCamera, setRouteCamera] = useState<RouteCamera | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [optimizingRoute, setOptimizingRoute] = useState(false);
  const [optimizationOrder, setOptimizationOrder] = useState<number[] | null>(null);
  const [optimizedRoute, setOptimizedRoute] = useState<RouteFeature | null>(null);
  const [optimizationReview, setOptimizationReview] = useState(false);
  const [optimizationDismissed, setOptimizationDismissed] = useState(false);
  const [appliedOptimizedItems, setAppliedOptimizedItems] = useState<ItineraryItem[] | null>(null);
  const [capturingShare, setCapturingShare] = useState(false);
  const [shareImageUri, setShareImageUri] = useState<string | null>(null);
  const shareCanvasRef = useRef<View>(null);
  // Place the map control above the default sheet immediately; live panel
  // height updates replace this value as soon as the sheet reports itself.
  const routeControlBottom = useRef(new Animated.Value(SNAP_HEIGHTS.default)).current;
  const optimizationPromptOpacity = useRef(new Animated.Value(0)).current;
  const routePlaybackRef = useRef(0);
  const routeInFlightRef = useRef(false);
  const hydratedRouteAtlasRef = useRef<string | null>(null);
  const pendingMapReleaseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestAtlasMapStateRef = useRef<AtlasMapState>(null);
  const detailCameraKey = useRef(`atlas-detail-${Date.now()}-${Math.random().toString(36).slice(2)}`).current;
  const atlas = useMemo(() => atlases.find((item) => item.id === atlasId) ?? null, [atlasId, atlases]);
  const items = useMemo<ItineraryItem[]>(() => {
    if (!atlasId) return [];
    const byId = new Map(savedPlaces.map((place) => [place.id, place]));
    return atlasPlaces.filter((row) => row.atlas_id === atlasId).sort((a, b) => a.sort_order - b.sort_order).flatMap((row) => {
      const saved = row.place_id ? byId.get(row.place_id) : undefined;
      // The Atlas row is the durable source of truth for its orange pin. Do
      // not use the global Saved Places map to determine this Atlas's scope.
      const place: AtlasDisplayPlace | null = row.latitude != null && row.longitude != null ? {
        id: row.place_id ?? row.external_place_id ?? row.id,
        name: row.place_name ?? saved?.name ?? 'Pinned place',
        subtitle: row.place_subtitle ?? saved?.subtitle ?? '',
        latitude: row.latitude,
        longitude: row.longitude,
        photo_url: row.photo_url ?? saved?.photo_url ?? null,
      } : saved ?? null;
      const metadata = decodeAtlasPlaceMetadata(row.note);
      return place ? [{ place, rowId: row.id, note: metadata.note, day: row.timeline_day ?? null, time: row.timeline_time ?? null, transport: metadata.transport }] : [];
    });
  }, [atlasId, atlasPlaces, savedPlaces]);

  const presentation = useMemo(() => getMapPresentation(items, null), [items]);
  const editorInitialItems = useMemo<DraftPlace[]>(() => items.map((item) => ({
    id: item.place.id,
    name: item.place.name,
    subtitle: item.place.subtitle,
    latitude: item.place.latitude,
    longitude: item.place.longitude,
    photo_url: item.place.photo_url,
    city: null,
    region: null,
    country: null,
    category: null,
    source: 'saved',
    note: item.note,
    timeline_day: item.day,
    timeline_time: item.time,
    transport: item.transport,
    joinId: item.rowId,
  })), [items]);
  // A just-saved Atlas has an exact orange-pin map handoff before its local
  // atlas_places rows finish hydrating. Treat that handoff as the completed
  // page's presentation, not merely as a state to avoid clearing, so there is
  // never an intermediate GPS or continental-US camera update.
  const pendingSavedMapHandoff = atlasMapState?.cameraKey?.startsWith(`atlas-save-${atlasId}-`)
    && atlasMapState.bounds
    && !sameAtlasStops(
      atlasMapState.markers.filter((marker) => marker.tone === 'atlas'),
      presentation.markers,
    )
    ? atlasMapState
    : null;
  const activePresentation = pendingSavedMapHandoff
    ? {
      markers: pendingSavedMapHandoff.markers,
      centerCoordinate: pendingSavedMapHandoff.centerCoordinate,
      zoomLevel: pendingSavedMapHandoff.zoomLevel ?? presentation.zoomLevel,
      bounds: pendingSavedMapHandoff.bounds,
      routeGeoJSON: undefined,
    }
    : presentation;
  const optimizedItems = useMemo(() => optimizationOrder ? optimizationOrder.map((index) => items[index]).filter((item): item is ItineraryItem => Boolean(item)) : [], [items, optimizationOrder]);
  const listItems = optimizationReview ? optimizedItems : (appliedOptimizedItems ?? items);
  const activeRouteDistanceLabels = useMemo(
    () => displayedRoute && listItems.length ? routeDistanceLabelsForItems(displayedRoute, listItems) : [],
    [displayedRoute, listItems],
  );

  useEffect(() => {
    const visible = Boolean(optimizationOrder && !optimizationDismissed && !optimizationReview);
    Animated.timing(optimizationPromptOpacity, { toValue: visible ? 1 : 0, duration: visible ? 220 : 150, useNativeDriver: true }).start();
  }, [optimizationDismissed, optimizationOrder, optimizationPromptOpacity, optimizationReview]);

  useEffect(() => {
    if (!atlas || hydratedRouteAtlasRef.current === atlas.id) return;
    hydratedRouteAtlasRef.current = atlas.id;
    routePlaybackRef.current += 1;
    routeInFlightRef.current = false;
    setRouteBusy(false);
    // A completed Atlas always opens as its orange-pin overview. Keep a
    // persisted route ready for Show route, but never draw it by default.
    const persistedRoute = atlas?.route_geojson ?? null;
    setRouteFeature(persistedRoute);
    setDisplayedRoute(null);
    setRouteCamera(null);
    setAppliedOptimizedItems(null);
    setOptimizationOrder(null);
    setOptimizedRoute(null);
    setOptimizationReview(false);
    setOptimizationDismissed(false);
  }, [atlas, atlasId]);

  const openNextStopDirections = useCallback((from: ItineraryItem, to: ItineraryItem) => {
    const origin = `${from.place.latitude},${from.place.longitude}`;
    const destination = `${to.place.latitude},${to.place.longitude}`;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`).catch((error) => {
      console.warn('[AtlasDetail] could not open Google Maps directions:', error);
    });
  }, []);

  const dismissAtlas = useCallback(() => {
    setRouteCamera(null);
    setHomeSelectedPlaceId(null);
    setHomeSelectedPlaceCoordinate(null);

    // Hide Atlas-owned map controls synchronously. The marker set itself stays
    // briefly so its expensive native replacement cannot delay this close tap.
    if (latestAtlasMapStateRef.current) {
      const mapWithoutControls = {
        ...latestAtlasMapStateRef.current,
        overlay: null,
        routeGeoJSON: undefined,
        routeDistanceLabels: [],
        selectedMarkerId: null,
      };
      latestAtlasMapStateRef.current = mapWithoutControls;
      setAtlasMapState(mapWithoutControls);
    }
    onDismiss();

    // The completed page is gone immediately. Defer only the expensive shared
    // map ownership switch until its UI handoff has settled.
    if (pendingMapReleaseRef.current) clearTimeout(pendingMapReleaseRef.current);
    pendingMapReleaseRef.current = setTimeout(() => {
      pendingMapReleaseRef.current = null;
      latestAtlasMapStateRef.current = null;
      setAtlasMapState(null);
    }, ATLAS_MAP_RELEASE_DELAY_MS);
  }, [onDismiss, setAtlasMapState, setHomeSelectedPlaceCoordinate, setHomeSelectedPlaceId]);

  const handleRoutePanelHeight = useCallback((height: number) => {
    routeControlBottom.setValue(height);
  }, [routeControlBottom]);

  // Routes can take detours along roads, but they never define the Atlas
  // overview. Every route state re-fits the polygon bounds of its orange pins.
  const atlasOverviewCamera = useCallback((cameraKey: string, cameraAnimationDurationMs: number): RouteCamera | null => (
    presentation.bounds && presentation.centerCoordinate
      ? {
        centerCoordinate: presentation.centerCoordinate,
        zoomLevel: presentation.zoomLevel,
        bounds: presentation.bounds,
        cameraAnimationDurationMs,
        cameraKey,
      }
      : null
  ), [presentation.bounds, presentation.centerCoordinate, presentation.zoomLevel]);

  const openAtlasEditChat = useCallback(async (mapView: AtlasSavedMapView) => {
    if (!atlas) return;
    const atlasChatPlaces = mapView.places.map((place) => ({
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      full_address: place.subtitle,
      description: place.note || place.subtitle,
      category: place.category || 'Place',
      photo_url: place.photo_url || null,
      city: place.city || null,
      region: place.region || null,
      country: place.country || null,
      timeline_day: place.timeline_day ?? null,
      timeline_time: place.timeline_time ?? null,
      transport: place.transport ?? null,
    }));
    const places = mapView.places.map((place) => ({
      id: place.id,
      name: place.name,
      subtitle: place.subtitle,
      type: place.category || 'Place',
      latitude: place.latitude,
      longitude: place.longitude,
      imageUri: place.photo_url || undefined,
      city: place.city || undefined,
      country: place.country || undefined,
    }));
    try {
      const created = await createChatSession({
        title: mapView.title,
        source_url: `atlas:${atlas.id}`,
        source_type: 'atlas_edit',
        locations: atlasChatPlaces,
        user_location: userLocation,
      });
      const conversationId = created.conversation_id || created.session_id;
      const createdAt = new Date().toISOString();
      const temporaryId = addChatHistoryItem({
        title: mapView.title,
        sourceUrl: `atlas:${atlas.id}`,
        sourceType: 'atlas_edit',
        locationCount: places.length,
        messageCount: 0,
        places,
        updatedAt: createdAt,
      });
      const historyItem = {
        id: conversationId,
        title: mapView.title,
        sourceUrl: `atlas:${atlas.id}`,
        sourceType: 'atlas_edit',
        locationCount: places.length,
        messageCount: 0,
        places,
        createdAt,
        updatedAt: createdAt,
        atlasWelcome: { places: atlasChatPlaces },
      };
      replaceChatHistoryItem(temporaryId, historyItem);
      setActiveHistoryItem(historyItem);
      setActiveSidekick('aiChat');
    } catch (error) {
      console.warn('[AtlasDetail] could not start Atlas AI chat:', error);
      showDialog({
        title: 'We couldn\'t start this Atlas chat',
        message: 'Your Atlas was saved. Please try Save and Ask AI again.',
        tone: 'warning',
      });
    }
  }, [addChatHistoryItem, atlas, replaceChatHistoryItem, setActiveHistoryItem, setActiveSidekick, showDialog, userLocation]);

  const handleEditorSaved = useCallback((askAI: boolean, mapView?: AtlasSavedMapView) => {
    if (!mapView) {
      setEditing(false);
      return;
    }
    // Edit saves use the same synchronous handoff as a newly created Atlas.
    // The detail panel can then mount with the final orange bounds even while
    // the atlas_places listener is still delivering the updated rows.
    const camera = atlasCameraFromStops(mapView.markers.map((marker) => ({
      id: marker.id,
      title: marker.title,
      description: marker.description,
      latitude: marker.latitude,
      longitude: marker.longitude,
    })));
    if (camera) {
      const nextState: AtlasMapState = {
        ...camera,
        zoomLevel: mapView.zoomLevel,
        cameraVerticalOffset: ATLAS_DETAIL_CAMERA_VERTICAL_OFFSET,
        cameraKey: `atlas-save-${atlas?.id ?? atlasId}-${Date.now()}`,
        cameraAnimationDurationMs: 0,
        routeGeoJSON: mapView.routeGeoJSON,
        selectedMarkerId: null,
        markerPopup: null,
        overlay: null,
      };
      latestAtlasMapStateRef.current = nextState;
      setAtlasMapState(nextState);
    }
    if (mapView.routeGeoJSON) {
      setRouteFeature(mapView.routeGeoJSON);
    }
    setDisplayedRoute(null);
    setRouteCamera(null);
    setEditing(false);
    if (askAI) void openAtlasEditChat(mapView);
  }, [atlas?.id, atlasId, openAtlasEditChat, setAtlasMapState]);

  const handleEditorClosed = useCallback(() => {
    // Cancel discards the editor camera and returns directly to the durable
    // orange-pin overview. AtlasBuilder preserves this handoff while unmounting.
    const nextState: AtlasMapState = {
      ...presentation,
      cameraVerticalOffset: ATLAS_DETAIL_CAMERA_VERTICAL_OFFSET,
      cameraKey: `atlas-cancel-${atlas?.id ?? atlasId}-${Date.now()}`,
      cameraAnimationDurationMs: 0,
      routeGeoJSON: displayedRoute ?? undefined,
      selectedMarkerId: null,
      markerPopup: null,
      overlay: null,
    };
    latestAtlasMapStateRef.current = nextState;
    setAtlasMapState(nextState);
    setSelectedPlaceId(null);
    setEditing(false);
  }, [atlas?.id, atlasId, displayedRoute, presentation, setAtlasMapState]);

  const toggleRoute = useCallback(async () => {
    if (!atlas || routeBusy || routeInFlightRef.current || items.length < 2) return;
    if (displayedRoute) {
      routePlaybackRef.current += 1;
      routeInFlightRef.current = false;
      setOptimizingRoute(false);
      setDisplayedRoute(null);
      setRouteCamera(atlasOverviewCamera(`${detailCameraKey}-${atlas.id}-hidden-${Date.now()}`, 500));
      return;
    }
    if (routeFeature) {
      setDisplayedRoute(routeFeature);
      setRouteCamera(atlasOverviewCamera(`${detailCameraKey}-${atlas.id}-stored-route-${Date.now()}`, 500));
      return;
    }
    routeInFlightRef.current = true;
    const requestToken = ++routePlaybackRef.current;
    setRouteBusy(true);
    setOptimizationDismissed(false);
    setOptimizingRoute(true);
    const coordinates = items.map((item) => [item.place.longitude, item.place.latitude] as [number, number]);
    const optimizationPromise = requestMapboxOptimization(coordinates);
    try {
      const nextRoute = await withTimeout(requestMapboxDirections(coordinates), 15000).catch((error) => {
        console.warn('[AtlasDetail] Mapbox Directions unavailable; using route service fallback:', error);
        return withTimeout(requestAtlasRoute(coordinates), 15000);
      });
      if (requestToken !== routePlaybackRef.current) return;
      setRouteFeature(nextRoute.route);
      setDisplayedRoute(nextRoute.route);
      setRouteCamera(atlasOverviewCamera(`${detailCameraKey}-${atlas.id}-route-${Date.now()}`, 500));
      void updateAtlas(atlas.id, { route_geojson: nextRoute.route, route_visible: true }).catch((error) => console.warn('[AtlasDetail] could not save route:', error));
    } catch (error) {
      console.warn('[AtlasDetail] could not create route:', error);
    } finally {
      if (requestToken === routePlaybackRef.current) {
        routeInFlightRef.current = false;
        setRouteBusy(false);
      }
    }
    optimizationPromise.then((result) => {
      if (requestToken !== routePlaybackRef.current) return;
      const changed = result.order.some((value, index) => value !== index);
      if (changed) { setOptimizationOrder(result.order); setOptimizedRoute(result.route.route); }
      setOptimizingRoute(false);
    }).catch(() => {
      if (requestToken === routePlaybackRef.current) setOptimizingRoute(false);
    });
  }, [atlas, atlasOverviewCamera, detailCameraKey, displayedRoute, items, routeBusy, routeFeature]);

  const openOptimizationReview = useCallback(() => {
    if (!optimizedRoute || optimizedItems.length !== items.length) return;
    setOptimizationReview(true);
    setDisplayedRoute(optimizedRoute);
    setRouteCamera(atlasOverviewCamera(`${detailCameraKey}-${atlas?.id ?? 'atlas'}-optimized-review`, 550));
  }, [atlas?.id, atlasOverviewCamera, detailCameraKey, items.length, optimizedItems.length, optimizedRoute]);

  const saveOptimizedRoute = useCallback(async () => {
    if (!atlas || !optimizedRoute || optimizedItems.length !== items.length) return;
    try {
      await Promise.all(optimizedItems.map((item, index) => updateAtlasPlace(item.rowId, { sort_order: index })));
      await updateAtlas(atlas.id, { route_geojson: optimizedRoute, route_visible: true });
      setAppliedOptimizedItems(optimizedItems);
      setRouteFeature(optimizedRoute);
      setDisplayedRoute(optimizedRoute);
      setOptimizationReview(false);
      setOptimizationDismissed(true);
    } catch (error) {
      console.warn('[AtlasDetail] could not save optimized route:', error);
    }
  }, [atlas, items.length, optimizedItems, optimizedRoute]);

  const openSharePreview = useCallback(async () => {
    setCapturingShare(true);
    await delay(350);
    try {
      setShareImageUri(await captureScreen({ format: 'png', quality: 1 }));
    } catch (error) {
      console.warn('[AtlasDetail] could not capture Atlas screen:', error);
    } finally {
      setCapturingShare(false);
    }
  }, []);

  const captureShareCanvas = useCallback(async () => {
    if (!shareCanvasRef.current) return null;
    return captureRef(shareCanvasRef.current, { format: 'png', quality: 1 });
  }, []);

  const saveShareImage = useCallback(async () => {
    const uri = await captureShareCanvas();
    if (!uri) return;
    const permission = await requestPermissionsAsync(true);
    if (permission.granted) await Asset.create(uri);
  }, [captureShareCanvas]);

  const shareToApp = useCallback(async (app: 'messenger' | 'instagram') => {
    const uri = await captureShareCanvas();
    if (!uri) return;
    const appUrl = app === 'messenger' ? 'fb-messenger://' : 'instagram://app';
    const storeUrl = app === 'messenger' ? 'itms-apps://itunes.apple.com/app/id454638411' : 'itms-apps://itunes.apple.com/app/id389801252';
    const installed = await Linking.canOpenURL(appUrl).catch(() => false);
    if (!installed) {
      const targetUrl = Platform.OS === 'ios' ? storeUrl : `market://details?id=${app === 'messenger' ? 'com.facebook.orca' : 'com.instagram.android'}`;
      await Linking.openURL(targetUrl).catch((error) => console.warn(`[AtlasDetail] could not open ${app} store listing:`, error));
      return;
    }
    await Share.shareSingle({ social: app === 'messenger' ? Social.Messenger : Social.Instagram, url: uri, type: 'image/png' }).catch((error) => console.warn(`[AtlasDetail] could not share to ${app}:`, error));
  }, [captureShareCanvas]);

  useLayoutEffect(() => {
    if (!atlas || editing) return;
    // Save can open this page before its local atlas_places subscription has
    // delivered every newly-written row. Keep the complete synchronous
    // orange-pin handoff until the durable Atlas rows have caught up, rather
    // than replacing it with an incomplete or GPS-fallback map.
    if (pendingSavedMapHandoff) return;
    const scopedRouteCamera = routeCamera?.cameraKey.includes(`-${atlas.id}-`) ? routeCamera : null;
    const renderedRoute = displayedRoute;
    const overviewCameraKey = `${detailCameraKey}-${atlas.id}-${activePresentation.markers.map((marker) => `${marker.longitude.toFixed(4)},${marker.latitude.toFixed(4)}`).join('|')}`;
    const nextMapState: AtlasMapState = {
      ...activePresentation,
      cameraVerticalOffset: ATLAS_DETAIL_CAMERA_VERTICAL_OFFSET,
      ...scopedRouteCamera,
      cameraKey: scopedRouteCamera?.cameraKey ?? overviewCameraKey,
      cameraAnimationDurationMs: 320,
      ...(scopedRouteCamera ? { cameraAnimationDurationMs: scopedRouteCamera.cameraAnimationDurationMs } : {}),
      routeGeoJSON: renderedRoute ?? undefined,
      hideChrome: capturingShare,
      selectedMarkerId: selectedPlaceId,
      onMarkerPress: (marker) => setSelectedPlaceId(marker.id),
      onMapPress: () => setSelectedPlaceId(null),
      onPanelHeightChange: handleRoutePanelHeight,
      overlay: !capturingShare ? <AtlasRouteControl bottom={routeControlBottom} visible={Boolean(renderedRoute)} busy={routeBusy} disabled={activePresentation.markers.length < 2} onPress={toggleRoute} /> : null,
    };
    latestAtlasMapStateRef.current = nextMapState;
    setAtlasMapState(nextMapState);
  }, [activePresentation, atlas, capturingShare, detailCameraKey, displayedRoute, editing, handleRoutePanelHeight, items.length, listItems, pendingSavedMapHandoff, routeBusy, routeCamera, routeControlBottom, selectedPlaceId, setAtlasMapState, toggleRoute]);

  useEffect(() => {
    if (!atlasId) setEditing(false);
  }, [atlasId]);

  useEffect(() => {
    // A newly opened Atlas owns the map synchronously. Never allow a delayed
    // release from the previously closed page to clear that new state.
    if (!atlasId || !pendingMapReleaseRef.current) return;
    clearTimeout(pendingMapReleaseRef.current);
    pendingMapReleaseRef.current = null;
  }, [atlasId]);

  useEffect(() => () => {
    routePlaybackRef.current += 1;
    if (pendingMapReleaseRef.current) clearTimeout(pendingMapReleaseRef.current);
  }, []);

  const renderItineraryRow = useCallback(({ item, index }: { item: ItineraryItem; index: number }) => (
    <ItineraryRow
      item={item}
      index={index}
      nextItem={listItems[index + 1]}
      distanceLabel={activeRouteDistanceLabels[index]?.text}
      selected={selectedPlaceId === item.place.id}
      onPress={() => setSelectedPlaceId(item.place.id)}
      onShare={!capturingShare && index === 0 ? openSharePreview : undefined}
      onNavigate={!capturingShare && listItems[index + 1] ? () => openNextStopDirections(item, listItems[index + 1]) : undefined}
    />
  ), [listItems, activeRouteDistanceLabels, selectedPlaceId, capturingShare, openSharePreview, openNextStopDirections]);

  if (!atlas) return null;

  return <ContentPanel visible={Boolean(atlasId)} onHidden={dismissAtlas} zIndex={40} snapGroup={snapGroup} minSnap="default" onHeightChange={onHeightChange}>
    {({ reportScrollY, bottomInset }) => editing ? <AtlasBuilder atlasId={atlas.id} initialItems={editorInitialItems} initialCenter={presentation.centerCoordinate} initialBounds={presentation.bounds} onClose={handleEditorClosed} onSaved={(_, askAI, mapView) => handleEditorSaved(askAI, mapView)} /> : optimizationReview ? <OptimizedRouteReview items={optimizedItems} originalItems={items} bottomInset={bottomInset} onClose={() => { setOptimizationReview(false); setDisplayedRoute(routeFeature); }} onSave={() => { void saveOptimizedRoute(); }} /> : <>
      <View style={styles.header}><View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.title}>{atlas.title}</Text><Text style={styles.meta}>{items.length} {items.length === 1 ? 'place' : 'places'} · Map itinerary</Text></View><View style={styles.headerActions}>{!capturingShare ? <><View style={styles.headerTopActions}><Button accessibilityLabel="Edit atlas" onPress={() => setEditing(true)} size="icon" variant="ghost" className="h-11 w-11 rounded-full bg-background"><Ionicons name="pencil-outline" size={19} color="#1A1A1A" /></Button><Button accessibilityLabel="Dismiss atlas" onPress={dismissAtlas} size="icon" variant="ghost" className="h-11 w-11 rounded-full bg-background"><Ionicons name="close" size={21} color="#1A1A1A" /></Button></View>{optimizationOrder ? <Animated.View pointerEvents={optimizationDismissed ? 'none' : 'auto'} style={[styles.optimizationPrompt, { opacity: optimizationPromptOpacity, transform: [{ translateY: optimizationPromptOpacity.interpolate({ inputRange: [0, 1], outputRange: [-5, 0] }) }] }]}><TouchableOpacity accessibilityLabel="Review optimized route" onPress={openOptimizationReview} style={styles.optimizationPromptMain}><Ionicons name="sparkles-outline" size={13} color="#2E6A55" /><Text style={styles.optimizationPromptText}>{optimizingRoute ? 'Finding a better route...' : 'Our algorithm found a better route'}</Text></TouchableOpacity><TouchableOpacity accessibilityLabel="Dismiss route suggestion" onPress={() => setOptimizationDismissed(true)} style={styles.optimizationPromptClose}><Ionicons name="close" size={13} color="#4E5E56" /></TouchableOpacity></Animated.View> : null}</> : null}</View></View>
      <FlatList data={listItems} keyExtractor={itineraryKeyExtractor} onScroll={(event) => reportScrollY(event.nativeEvent.contentOffset.y)} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset + 20 }} ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>This Atlas has no places yet.</Text></View>} renderItem={renderItineraryRow} />
      <Modal visible={Boolean(shareImageUri)} animationType="fade" onRequestClose={() => setShareImageUri(null)}><View style={styles.shareScreen}><Button accessibilityLabel="Close share preview" onPress={() => setShareImageUri(null)} size="icon" variant="ghost" className="absolute right-5 top-[54px] z-10 h-9 w-9 rounded-full bg-background"><Ionicons name="close" size={22} color="#1A1A1A" /></Button><View ref={shareCanvasRef} collapsable={false} style={styles.shareCanvas}><Image source={{ uri: shareImageUri ?? undefined }} style={styles.shareScreenshot} resizeMode="cover" /><Text style={styles.shareCaption}>Open OurAtlas to explore the full atlas.</Text><View style={styles.qrWrap}><View style={styles.qrPlaceholder}>{Array.from({ length: 25 }).map((_, index) => <View key={index} style={[styles.qrCell, ((index * 7 + index * index) % 5 < 2) && styles.qrCellOn]} />)}</View><Text style={styles.qrCaption}>View OurAtlas</Text></View></View><View style={styles.shareActions}><ShareAction icon="download-outline" label="Save Image" onPress={() => { void saveShareImage(); }} /><ShareAction icon="chatbubble-ellipses-outline" label="Messenger" onPress={() => { void shareToApp('messenger'); }} /><ShareAction icon="logo-instagram" label="Instagram" onPress={() => { void shareToApp('instagram'); }} /></View></View></Modal>
    </>}
  </ContentPanel>;
}

function CompactAtlas({ atlas, onExpand, onDismiss }: { atlas: Atlas; onExpand: () => void; onDismiss: () => void }) {
  return <Pressable style={styles.compact} onPress={onExpand}><View style={styles.compactMark}><Ionicons name="map-outline" size={17} color="#12C170" /></View><Text numberOfLines={1} style={styles.compactTitle}>{atlas.title}</Text><Button accessibilityLabel="Dismiss atlas" onPress={onDismiss} size="icon" variant="ghost" className="h-8 w-8 rounded-full bg-muted"><Ionicons name="close" size={19} color="#1A1A1A" /></Button></Pressable>;
}

function AtlasRouteControl({ bottom, visible, busy, disabled, onPress }: { bottom: Animated.Value; visible: boolean; busy: boolean; disabled: boolean; onPress: () => void }) {
  return <View pointerEvents="box-none" style={styles.routeMapOverlay}><Animated.View style={[styles.floatingRouteButton, { bottom: 12, transform: [{ translateY: Animated.multiply(bottom, -1) }] }]}><TouchableOpacity accessibilityLabel={visible ? 'Hide route' : 'Show route'} disabled={busy || disabled} onPress={onPress} style={styles.floatingRouteButtonInner}>{busy ? <ActivityIndicator size="small" color="#12C170" /> : <Ionicons name={visible ? 'eye-off-outline' : 'git-branch-outline'} size={15} color="#12C170" />}<Text style={styles.floatingRouteText}>{visible ? 'Hide route' : 'Show route'}</Text></TouchableOpacity></Animated.View></View>;
}

function ShareAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return <TouchableOpacity accessibilityLabel={label} onPress={onPress} style={styles.shareAction}><View style={styles.shareActionCircle}><Ionicons name={icon} size={21} color="#12C170" /></View><Text style={styles.shareActionText}>{label}</Text></TouchableOpacity>;
}

function OptimizedRouteReview({ items, originalItems, bottomInset, onClose, onSave }: { items: ItineraryItem[]; originalItems: ItineraryItem[]; bottomInset: number; onClose: () => void; onSave: () => void }) {
  const originalIndexByRowId = useMemo(() => new Map(originalItems.map((item, index) => [item.rowId, index])), [originalItems]);
  const renderItem = useCallback(({ item, index }: { item: ItineraryItem; index: number }) => {
    const originalIndex = originalIndexByRowId.get(item.rowId) ?? index;
    const change = originalIndex - index;
    return <View style={styles.optimizedRow}><View style={styles.number}><Text style={styles.numberText}>{index + 1}</Text></View>{item.place.photo_url ? <Image source={{ uri: item.place.photo_url }} style={styles.optimizedImage} /> : <View style={[styles.optimizedImage, styles.imageFallback]}><Text style={styles.imageInitial}>{item.place.name.slice(0, 1).toUpperCase()}</Text></View>}<View style={styles.copy}><Text numberOfLines={1} style={styles.name}>{item.place.name}</Text><Text numberOfLines={1} style={styles.address}>{item.place.subtitle}</Text></View>{change ? <View style={[styles.orderChange, change > 0 ? styles.orderUp : styles.orderDown]}><Ionicons name={change > 0 ? 'arrow-up-outline' : 'arrow-down-outline'} size={11} color={change > 0 ? '#217558' : '#986033'} /><Text style={[styles.orderChangeText, change > 0 ? styles.orderUpText : styles.orderDownText]}>{Math.abs(change)}</Text></View> : <View style={styles.orderUnchanged}><Text style={styles.orderUnchangedText}>Same</Text></View>}</View>;
  }, [originalIndexByRowId]);
  return <View style={styles.optimizedReview}><View style={styles.optimizedReviewHeader}><View><Text style={styles.optimizedReviewTitle}>Better route</Text><Text style={styles.optimizedReviewSubtitle}>Optimized stop order</Text></View><Button accessibilityLabel="Close optimized route" onPress={onClose} size="icon" variant="ghost" className="h-9 w-9 rounded-full bg-muted"><Ionicons name="close" size={20} color="#1A1A1A" /></Button></View><FlatList data={items} keyExtractor={itineraryKeyExtractor} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset + 92, gap: 8 }} renderItem={renderItem} /><View style={styles.optimizedReviewFooter}><Button onPress={onClose} variant="ghost" className="h-11 flex-1 rounded-[13px] bg-muted"><Text style={styles.optimizedCancelText}>Cancel</Text></Button><Button onPress={onSave} className="h-11 flex-[1.35] rounded-[13px] bg-primary"><Text style={styles.optimizedSaveText}>Save new route</Text></Button></View></View>;
}

function ItineraryRow({ item, index, nextItem, distanceLabel, selected, onPress, onShare, onNavigate }: { item: ItineraryItem; index: number; nextItem?: ItineraryItem; distanceLabel?: string; selected: boolean; onPress: () => void; onShare?: () => void; onNavigate?: () => void }) {
  const nextHasMetadata = Boolean(nextItem && (nextItem.time || nextItem.transport));
  const navigationButton = nextItem && onNavigate ? <TouchableOpacity accessibilityLabel={`Navigate from ${item.place.name} to ${nextItem.place.name} in Google Maps`} onPress={onNavigate} activeOpacity={0.7} style={[styles.navigationButton, nextHasMetadata && styles.connectorNavigationButton]}>
    <Ionicons name="logo-google" size={9} color="#4285F4" />
    <Ionicons name="navigate-outline" size={11} color="#3C4043" />
  </TouchableOpacity> : null;
  return <View style={styles.itineraryItem}>
    {index === 0 ? <ItineraryMetadata item={item} onShare={onShare} /> : null}
    <TouchableOpacity onPress={onPress} activeOpacity={0.76} style={[styles.row, selected && styles.rowSelected, selected && styles.rowSelectedSurface]}>
      <View style={styles.number}><Text style={styles.numberText}>{index + 1}</Text></View>
      {item.place.photo_url ? <Image source={{ uri: item.place.photo_url }} style={styles.image} /> : <View style={[styles.image, styles.imageFallback]}><Text style={styles.imageInitial}>{item.place.name.slice(0, 1).toUpperCase()}</Text></View>}
      <View style={styles.copy}><Text numberOfLines={1} style={styles.name}>{item.place.name}</Text><Text numberOfLines={1} style={styles.address}>{item.place.subtitle}</Text>{item.note ? <Text numberOfLines={2} style={styles.note}>{item.note}</Text> : null}</View>
    </TouchableOpacity>
    {nextItem ? nextHasMetadata ? <View style={styles.metadataConnector}>
      <View pointerEvents="none" style={styles.connectorLine} />
      <ItineraryMetadata item={nextItem} connector />
      {navigationButton ? <View style={styles.connectorNavigation}>{navigationButton}{distanceLabel ? <DistanceHint text={distanceLabel} connector /> : null}</View> : null}
    </View> : <View style={styles.navigationGap}>{navigationButton}{distanceLabel ? <DistanceHint text={distanceLabel} /> : null}</View> : null}
  </View>;
}

function DistanceHint({ text, connector = false }: { text: string; connector?: boolean }) {
  return <View pointerEvents="none" accessibilityLabel={`Route distance ${text}`} style={[styles.distanceHint, connector && styles.distanceHintConnector]}><Text style={styles.distanceHintText}>{text}</Text></View>;
}

function ItineraryMetadata({ item, connector = false, onShare }: { item: ItineraryItem; connector?: boolean; onShare?: () => void }) {
  const transport = item.transport ? TRANSPORT_PRESENTATION[item.transport] : null;
  if (!item.time && !transport) {
    return connector ? null : <View style={styles.atlasBeginsRow}><Text style={styles.atlasBeginsText}>Where your Atlas begins</Text>{onShare ? <TouchableOpacity accessibilityLabel="Share OurAtlas" onPress={onShare} style={styles.atlasBeginsShare}><Ionicons name="share-social-outline" size={13} color="#12C170" /><Text style={styles.atlasBeginsShareText}>Share OurAtlas</Text></TouchableOpacity> : null}</View>;
  }
  return <View style={[styles.itineraryMetaRow, connector && styles.connectorMetaRow, !connector && onShare && styles.itineraryMetaRowWithShare]}>
    {item.time ? <View style={[styles.dayMarker, styles.timeMarker]}><Ionicons name="time-outline" size={13} color="#2677B5" /><Text style={styles.dayText}>{item.day ? `Day ${item.day} · ${item.time}` : item.time}</Text></View> : null}
    {transport ? <View accessibilityLabel={transport.label} style={styles.transportMarker}><Ionicons name={transport.icon} size={13} color="#64748B" /></View> : null}
    {!connector && onShare ? <TouchableOpacity accessibilityLabel="Share OurAtlas" onPress={onShare} style={[styles.atlasBeginsShare, styles.metadataShare]}><Ionicons name="share-social-outline" size={13} color="#12C170" /><Text style={styles.atlasBeginsShareText}>Share OurAtlas</Text></TouchableOpacity> : null}
  </View>;
}

const styles = StyleSheet.create({
  itineraryMetaRowWithShare: { alignSelf: 'stretch', marginLeft: 0, marginRight: 0, paddingLeft: 9 },
  metadataShare: { marginLeft: 'auto' },
  timeMarker: { height: 24, paddingVertical: 0 },
  distanceHint: { position: 'absolute', left: '50%', top: -8, marginLeft: 20, width: 28, height: 18, borderRadius: 9, backgroundColor: '#FBFCFC', borderWidth: StyleSheet.hairlineWidth, borderColor: '#E7EBEE', alignItems: 'center', justifyContent: 'center', zIndex: 4 },
  distanceHintConnector: { top: 0 },
  distanceHintText: { width: '100%', color: '#A7A7A7', fontSize: 8, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
  rowSelectedSurface: { backgroundColor: '#F1F3F4', borderColor: '#E1E4E7' },
  routeMapOverlay: { ...StyleSheet.absoluteFill },
  floatingRouteButton: { position: 'absolute', right: 16, minHeight: 30, borderRadius: 12, backgroundColor: '#E9FBF1', borderWidth: StyleSheet.hairlineWidth, borderColor: '#C6F4DB', shadowColor: '#0C8149', shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  floatingRouteButtonInner: { minHeight: 30, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  floatingRouteText: { color: '#12C170', fontSize: 11, fontWeight: '800' },
  optimizationPrompt: { width: 188, minHeight: 34, marginTop: 5, marginRight: 5, paddingLeft: 8, paddingRight: 3, borderRadius: 10, backgroundColor: '#EDF8F1', flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: '#B9DFC9' },
  optimizationPromptMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 },
  optimizationPromptText: { flex: 1, color: '#2B654F', fontSize: 9, lineHeight: 12, fontWeight: '700' },
  optimizationPromptClose: { width: 24, height: 26, alignItems: 'center', justifyContent: 'center' },
  optimizedReview: { flex: 1, backgroundColor: '#FFF' },
  optimizedReviewHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optimizedReviewTitle: { color: '#1A1A1A', fontSize: 21, fontWeight: '800' },
  optimizedReviewSubtitle: { color: '#717171', fontSize: 12, marginTop: 2 },
  optimizedRow: { minHeight: 70, padding: 8, borderRadius: 12, backgroundColor: '#FAFAFB', flexDirection: 'row', alignItems: 'center', gap: 8 },
  optimizedImage: { width: 48, height: 48, borderRadius: 9, backgroundColor: '#E7ECF0' },
  orderChange: { minWidth: 31, paddingHorizontal: 5, paddingVertical: 4, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1 },
  orderUp: { backgroundColor: '#E7F7EE' },
  orderDown: { backgroundColor: '#FFF1E4' },
  orderChangeText: { fontSize: 10, fontWeight: '800' },
  orderUpText: { color: '#217558' },
  orderDownText: { color: '#986033' },
  orderUnchanged: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: 8, backgroundColor: '#F0F1F2' },
  orderUnchangedText: { color: '#717171', fontSize: 9, fontWeight: '700' },
  optimizedReviewFooter: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 18, backgroundColor: 'rgba(255,255,255,0.96)', borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#E7E8EA', flexDirection: 'row', gap: 10 },
  optimizedCancelText: { color: '#1A1A1A', fontSize: 14, fontWeight: '800' },
  optimizedSaveText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  shareAtlasButton: { alignSelf: 'center', marginTop: 18, marginBottom: 8, minHeight: 38, paddingHorizontal: 16, borderRadius: 19, backgroundColor: '#12C170', flexDirection: 'row', alignItems: 'center', gap: 7, shadowColor: '#0C8149', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.16, shadowRadius: 7, elevation: 3 },
  shareAtlasText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  registeredMark: { fontSize: 7, lineHeight: 10, verticalAlign: 'top' },
  shareScreen: { flex: 1, backgroundColor: '#E9FBF1', paddingHorizontal: 20, paddingTop: 68, alignItems: 'center' },
  shareCanvas: { width: '100%', maxWidth: 390, overflow: 'hidden', borderRadius: 18, backgroundColor: '#FFF', shadowColor: '#4A3528', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.14, shadowRadius: 22, elevation: 5 },
  shareScreenshot: { width: '100%', aspectRatio: 0.58, backgroundColor: '#E7ECEC' },
  shareCaption: { color: '#37312C', fontSize: 12, fontWeight: '600', paddingHorizontal: 15, paddingTop: 13, paddingBottom: 16 },
  qrWrap: { position: 'absolute', right: 12, bottom: 12, alignItems: 'center', padding: 5, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.94)' },
  qrPlaceholder: { width: 48, height: 48, padding: 3, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#FFF' },
  qrCell: { width: '20%', height: '20%', backgroundColor: '#FFF' },
  qrCellOn: { backgroundColor: '#22201E' },
  qrCaption: { marginTop: 3, color: '#3C342F', fontSize: 7, fontWeight: '700' },
  shareActions: { width: '100%', maxWidth: 330, flexDirection: 'row', justifyContent: 'space-between', marginTop: 30 },
  shareAction: { width: 82, alignItems: 'center', gap: 8 },
  shareActionCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#E9FBF1', alignItems: 'center', justifyContent: 'center' },
  shareActionText: { color: '#433C37', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  headerActions: { alignItems: 'flex-end', marginTop: -4 },
  headerTopActions: { flexDirection: 'row', alignItems: 'center' },
  showRouteButton: { minHeight: 28, marginTop: -4, marginRight: 5, paddingHorizontal: 9, borderRadius: 14, backgroundColor: '#FFF3EA', flexDirection: 'row', alignItems: 'center', gap: 4 },
  showRouteButtonDisabled: { opacity: 0.46 },
  showRouteText: { color: '#B85217', fontSize: 11, fontWeight: '700' },
  atlasBeginsRow: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 4 },
  atlasBeginsText: { color: '#1A1A1A', fontSize: 12, fontWeight: '600' },
  atlasBeginsShare: { minHeight: 26, paddingHorizontal: 8, borderRadius: 12, backgroundColor: '#E9FBF1', borderWidth: StyleSheet.hairlineWidth, borderColor: '#C6F4DB', flexDirection: 'row', alignItems: 'center', gap: 4 },
  atlasBeginsShareText: { color: '#12C170', fontSize: 10, fontWeight: '800' },
  header: { paddingHorizontal: 16, paddingTop: 7, paddingBottom: 11, flexDirection: 'row', alignItems: 'center', gap: 2 }, title: { fontSize: 22, fontWeight: '700', color: '#1A1A1A' }, meta: { color: '#717171', fontSize: 12, marginTop: 3 }, compact: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 }, compactMark: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#E9FBF1', alignItems: 'center', justifyContent: 'center' }, compactTitle: { flex: 1, color: '#1A1A1A', fontSize: 17, fontWeight: '700' }, empty: { paddingTop: 48, alignItems: 'center' }, emptyText: { color: '#717171', fontSize: 15 }, itineraryItem: { position: 'relative' }, itineraryMetaRow: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 9, marginTop: 8, marginBottom: 4 }, connectorMetaRow: { width: '42%', minHeight: 48, flexWrap: 'wrap', alignContent: 'center', marginTop: 0, marginBottom: 0, paddingVertical: 7 }, metadataConnector: { position: 'relative', minHeight: 48 }, connectorLine: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: StyleSheet.hairlineWidth, marginLeft: -StyleSheet.hairlineWidth / 2, backgroundColor: '#DDE2E7' }, navigationGap: { position: 'relative', height: 7 }, dayMarker: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#EAF4FF', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 }, dayText: { color: '#2677B5', fontSize: 11, fontWeight: '700' }, transportMarker: { alignSelf: 'flex-start', width: 24, height: 24, backgroundColor: '#F1F4F5', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, connectorNavigation: { position: 'absolute', top: '50%', left: 0, right: 0, height: 18, marginTop: -9 }, navigationButton: { position: 'absolute', left: '50%', top: -8, marginLeft: -14, width: 28, height: 18, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: '#D4D9E0', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1, zIndex: 5 }, connectorNavigationButton: { top: 0 }, row: { minHeight: 76, borderRadius: 14, padding: 9, backgroundColor: '#FAFAFB', flexDirection: 'row', alignItems: 'center', gap: 9 }, rowSelected: { backgroundColor: '#FCFCFD', borderWidth: 1, borderColor: '#E6E8EB' }, number: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#12C170', alignItems: 'center', justifyContent: 'center' }, numberText: { color: '#FFF', fontSize: 11, fontWeight: '800' }, image: { width: 54, height: 54, borderRadius: 11, backgroundColor: '#E7ECF0' }, imageFallback: { alignItems: 'center', justifyContent: 'center' }, imageInitial: { color: '#426177', fontSize: 19, fontWeight: '700' }, copy: { flex: 1, minWidth: 0 }, name: { color: '#1A1A1A', fontSize: 14, fontWeight: '700' }, address: { color: '#717171', fontSize: 12, marginTop: 2 }, note: { color: '#48708C', fontSize: 11, lineHeight: 15, fontStyle: 'italic', marginTop: 4 },
});
