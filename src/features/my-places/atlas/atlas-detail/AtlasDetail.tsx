import Ionicons from '@expo/vector-icons/Ionicons';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import ContentPanel, { SNAP_HEIGHTS } from '@/components/content-panel/ContentPanel';
import { useHome } from '@/features/home/HomeContext';
import type { MapMarker } from '@/features/map/MapboxMap';
import AtlasBuilder from '@/features/my-plan/atlas-builder/AtlasBuilder';
import { requestAtlasRoute, requestMapboxDirections, requestMapboxOptimization } from '@/services/api/apiService';
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
type RouteFeature = GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>;
type RouteCamera = Pick<NonNullable<ReturnType<typeof getMapPresentation>>, 'centerCoordinate' | 'zoomLevel' | 'bounds'> & { cameraAnimationDurationMs: number; cameraKey: string };

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

function boundsFromFocusPolygon(items: ItineraryItem[]): FocusBounds | undefined {
  if (!items.length) return undefined;
  const center: [number, number] = [
    items.reduce((sum, item) => sum + item.place.longitude, 0) / items.length,
    items.reduce((sum, item) => sum + item.place.latitude, 0) / items.length,
  ];
  const longitudeRadius = Math.max(0.07, ...items.map((item) => Math.abs(item.place.longitude - center[0]) * 1.35));
  const latitudeRadius = Math.max(0.055, ...items.map((item) => Math.abs(item.place.latitude - center[1]) * 1.35));
  const polygon = Array.from({ length: 10 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 10;
    return [center[0] + Math.cos(angle) * longitudeRadius, center[1] + Math.sin(angle) * latitudeRadius] as [number, number];
  });
  return {
    ne: [Math.max(...polygon.map(([longitude]) => longitude)) + 0.025, Math.max(...polygon.map(([, latitude]) => latitude)) + 0.02],
    sw: [Math.min(...polygon.map(([longitude]) => longitude)) - 0.025, Math.min(...polygon.map(([, latitude]) => latitude)) - 0.02],
  };
}

function getMapPresentation(items: ItineraryItem[], route: Atlas['route_geojson']) {
  if (!items.length) return { markers: [] as MapMarker[], centerCoordinate: undefined, zoomLevel: 6 };
  const bounds = boundsFromFocusPolygon(items);
  return {
    markers: items.map((item, index) => ({ id: item.place.id, title: item.place.name, description: item.place.subtitle, latitude: item.place.latitude, longitude: item.place.longitude, tone: 'atlas' as const, order: index + 1 })),
    centerCoordinate: [
      items.reduce((sum, item) => sum + item.place.longitude, 0) / items.length,
      items.reduce((sum, item) => sum + item.place.latitude, 0) / items.length,
    ] as [number, number],
    zoomLevel: 10,
    bounds,
    routeGeoJSON: route ?? undefined,
  };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
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
  const { atlases, savedPlaces, atlasPlaces, setAtlasMapState, setSelectedPlaceCoordinate: setHomeSelectedPlaceCoordinate, setSelectedPlaceId: setHomeSelectedPlaceId } = useHome();
  const [editing, setEditing] = useState(false);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
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
  const hydratedRouteAtlasRef = useRef<string | null>(null);
  const detailCameraKey = useRef(`atlas-detail-${Date.now()}-${Math.random().toString(36).slice(2)}`).current;
  const atlas = useMemo(() => atlases.find((item) => item.id === atlasId) ?? null, [atlasId, atlases]);
  const items = useMemo<ItineraryItem[]>(() => {
    if (!atlasId) return [];
    const byId = new Map(savedPlaces.map((place) => [place.id, place]));
    return atlasPlaces.filter((row) => row.atlas_id === atlasId).sort((a, b) => a.sort_order - b.sort_order).flatMap((row) => {
      const saved = row.place_id ? byId.get(row.place_id) : undefined;
      const place: AtlasDisplayPlace | null = saved ?? (row.place_name && row.latitude != null && row.longitude != null ? {
        id: row.external_place_id ?? row.id,
        name: row.place_name,
        subtitle: row.place_subtitle ?? '',
        latitude: row.latitude,
        longitude: row.longitude,
        photo_url: row.photo_url ?? null,
      } : null);
      const metadata = decodeAtlasPlaceMetadata(row.note);
      return place ? [{ place, rowId: row.id, note: metadata.note, day: row.timeline_day ?? null, time: row.timeline_time ?? null, transport: metadata.transport }] : [];
    });
  }, [atlasId, atlasPlaces, savedPlaces]);

  const presentation = useMemo(() => getMapPresentation(items, null), [items]);
  const optimizedItems = useMemo(() => optimizationOrder ? optimizationOrder.map((index) => items[index]).filter((item): item is ItineraryItem => Boolean(item)) : [], [items, optimizationOrder]);
  const listItems = optimizationReview ? optimizedItems : (appliedOptimizedItems ?? items);

  useEffect(() => {
    const visible = Boolean(optimizationOrder && !optimizationDismissed && !optimizationReview);
    Animated.timing(optimizationPromptOpacity, { toValue: visible ? 1 : 0, duration: visible ? 220 : 150, useNativeDriver: true }).start();
  }, [optimizationDismissed, optimizationOrder, optimizationPromptOpacity, optimizationReview]);

  useEffect(() => {
    if (!atlas || hydratedRouteAtlasRef.current === atlas.id) return;
    hydratedRouteAtlasRef.current = atlas.id;
    routePlaybackRef.current += 1;
    const persistedRoute = atlas?.route_visible ? atlas.route_geojson ?? null : null;
    setRouteFeature(persistedRoute);
    setDisplayedRoute(persistedRoute);
    setRouteCamera(null);
    setAppliedOptimizedItems(null);
    setOptimizationOrder(null);
    setOptimizedRoute(null);
    setOptimizationReview(false);
    setOptimizationDismissed(false);
  }, [atlas, atlasId]);

  const openNextStopDirections = (from: ItineraryItem, to: ItineraryItem) => {
    const origin = `${from.place.latitude},${from.place.longitude}`;
    const destination = `${to.place.latitude},${to.place.longitude}`;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`).catch((error) => {
      console.warn('[AtlasDetail] could not open Google Maps directions:', error);
    });
  };

  const dismissAtlas = useCallback(() => {
    setHomeSelectedPlaceId(null);
    setHomeSelectedPlaceCoordinate(null);
    onDismiss();
  }, [onDismiss, setHomeSelectedPlaceCoordinate, setHomeSelectedPlaceId]);

  const handleRoutePanelHeight = useCallback((height: number) => {
    routeControlBottom.setValue(height);
  }, [routeControlBottom]);

  const toggleRoute = useCallback(async () => {
    if (!atlas || routeBusy || items.length < 2) return;
    if (displayedRoute) {
      routePlaybackRef.current += 1;
      setDisplayedRoute(null);
      setRouteCamera(presentation.bounds && presentation.centerCoordinate ? {
        centerCoordinate: presentation.centerCoordinate,
        zoomLevel: presentation.zoomLevel,
        bounds: presentation.bounds,
        cameraAnimationDurationMs: 500,
        cameraKey: `${detailCameraKey}-hidden-${Date.now()}`,
      } : null);
      return;
    }
    setRouteBusy(true);
    setOptimizationDismissed(false);
    setOptimizingRoute(true);
    const coordinates = items.map((item) => [item.place.longitude, item.place.latitude] as [number, number]);
    const optimizationPromise = requestMapboxOptimization(coordinates);
    try {
      const nextRoute = await requestMapboxDirections(coordinates).catch((error) => {
        console.warn('[AtlasDetail] Mapbox Directions unavailable; using route service fallback:', error);
        return requestAtlasRoute(coordinates);
      });
      setRouteFeature(nextRoute.route);
      setDisplayedRoute(nextRoute.route);
      setRouteCamera({ centerCoordinate: presentation.centerCoordinate, zoomLevel: presentation.zoomLevel, bounds: presentation.bounds, cameraAnimationDurationMs: 500, cameraKey: `${detailCameraKey}-route-${Date.now()}` });
      void updateAtlas(atlas.id, { route_geojson: nextRoute.route, route_visible: true }).catch((error) => console.warn('[AtlasDetail] could not save route:', error));
    } catch (error) {
      console.warn('[AtlasDetail] could not create route:', error);
    } finally {
      setRouteBusy(false);
    }
    optimizationPromise.then((result) => {
      const changed = result.order.some((value, index) => value !== index);
      if (changed) { setOptimizationOrder(result.order); setOptimizedRoute(result.route.route); }
      setOptimizingRoute(false);
    }).catch(() => setOptimizingRoute(false));
  }, [atlas, detailCameraKey, displayedRoute, items, presentation.bounds, presentation.centerCoordinate, presentation.zoomLevel, routeBusy]);

  const openOptimizationReview = useCallback(() => {
    if (!optimizedRoute || optimizedItems.length !== items.length) return;
    setOptimizationReview(true);
    setDisplayedRoute(optimizedRoute);
    setRouteCamera({ centerCoordinate: presentation.centerCoordinate, zoomLevel: presentation.zoomLevel, bounds: presentation.bounds, cameraAnimationDurationMs: 550, cameraKey: `${detailCameraKey}-optimized-review` });
  }, [detailCameraKey, items.length, optimizedItems.length, optimizedRoute, presentation.bounds, presentation.centerCoordinate, presentation.zoomLevel]);

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
    setAtlasMapState({
      ...presentation,
      ...routeCamera,
      cameraKey: routeCamera?.cameraKey ?? `${detailCameraKey}-${atlas.id}`,
      cameraAnimationDurationMs: 320,
      ...(routeCamera ? { cameraAnimationDurationMs: routeCamera.cameraAnimationDurationMs } : {}),
      routeGeoJSON: displayedRoute ?? undefined,
      routeDistanceLabels: displayedRoute ? routeDistanceLabelsForItems(displayedRoute, listItems) : undefined,
      hideChrome: capturingShare,
      selectedMarkerId: selectedPlaceId,
      onMarkerPress: (marker) => setSelectedPlaceId(marker.id),
      onMapPress: () => setSelectedPlaceId(null),
      onPanelHeightChange: handleRoutePanelHeight,
      overlay: !capturingShare ? <AtlasRouteControl bottom={routeControlBottom} visible={Boolean(displayedRoute)} busy={routeBusy} disabled={items.length < 2} onPress={toggleRoute} /> : null,
    });
    return () => setAtlasMapState(null);
  }, [atlas, capturingShare, detailCameraKey, displayedRoute, editing, handleRoutePanelHeight, items.length, listItems, presentation, routeBusy, routeCamera, routeControlBottom, selectedPlaceId, setAtlasMapState, toggleRoute]);

  useEffect(() => {
    if (!atlasId) setEditing(false);
  }, [atlasId]);

  useEffect(() => () => {
    routePlaybackRef.current += 1;
  }, []);

  if (!atlas) return null;

  return <ContentPanel visible={Boolean(atlasId)} onHidden={dismissAtlas} zIndex={40} snapGroup={snapGroup} minSnap="default" onHeightChange={onHeightChange} compactContent={({ snapTo }) => <CompactAtlas atlas={atlas} onExpand={() => snapTo('default')} onDismiss={dismissAtlas} />}>
    {({ reportScrollY, bottomInset }) => editing ? <AtlasBuilder atlasId={atlas.id} initialCenter={presentation.centerCoordinate} initialBounds={presentation.bounds} onClose={() => setEditing(false)} onSaved={(_, _askAI, mapView) => { if (mapView) setRouteCamera({ ...mapView, bounds: undefined, cameraAnimationDurationMs: 0, cameraKey: `${detailCameraKey}-saved-${Date.now()}` }); setEditing(false); }} /> : optimizationReview ? <OptimizedRouteReview items={optimizedItems} originalItems={items} bottomInset={bottomInset} onClose={() => { setOptimizationReview(false); setDisplayedRoute(routeFeature); }} onSave={() => { void saveOptimizedRoute(); }} /> : <>
      <View style={styles.header}><View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.title}>{atlas.title}</Text><Text style={styles.meta}>{items.length} {items.length === 1 ? 'place' : 'places'} · Map itinerary</Text></View><View style={styles.headerActions}>{!capturingShare ? <><View style={styles.headerTopActions}><Button accessibilityLabel="Edit atlas" onPress={() => setEditing(true)} size="icon" variant="ghost" className="h-11 w-11 rounded-full bg-background"><Ionicons name="pencil-outline" size={19} color="#18181B" /></Button><Button accessibilityLabel="Dismiss atlas" onPress={dismissAtlas} size="icon" variant="ghost" className="h-11 w-11 rounded-full bg-background"><Ionicons name="close" size={21} color="#18181B" /></Button></View>{optimizationOrder ? <Animated.View pointerEvents={optimizationDismissed ? 'none' : 'auto'} style={[styles.optimizationPrompt, { opacity: optimizationPromptOpacity, transform: [{ translateY: optimizationPromptOpacity.interpolate({ inputRange: [0, 1], outputRange: [-5, 0] }) }] }]}><TouchableOpacity accessibilityLabel="Review optimized route" onPress={openOptimizationReview} style={styles.optimizationPromptMain}><Ionicons name="sparkles-outline" size={13} color="#2E6A55" /><Text style={styles.optimizationPromptText}>{optimizingRoute ? 'Finding a better route...' : 'Our algorithm found a better route'}</Text></TouchableOpacity><TouchableOpacity accessibilityLabel="Dismiss route suggestion" onPress={() => setOptimizationDismissed(true)} style={styles.optimizationPromptClose}><Ionicons name="close" size={13} color="#4E5E56" /></TouchableOpacity></Animated.View> : null}</> : null}</View></View>
      <FlatList data={listItems} keyExtractor={(item) => item.rowId} onScroll={(event) => reportScrollY(event.nativeEvent.contentOffset.y)} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset + 20 }} ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>This Atlas has no places yet.</Text></View>} renderItem={({ item, index }) => <ItineraryRow item={item} index={index} nextItem={listItems[index + 1]} selected={selectedPlaceId === item.place.id} onPress={() => setSelectedPlaceId(item.place.id)} onShare={!capturingShare && index === 0 ? openSharePreview : undefined} onNavigate={!capturingShare && listItems[index + 1] ? () => openNextStopDirections(item, listItems[index + 1]) : undefined} />} />
      <Modal visible={Boolean(shareImageUri)} animationType="fade" onRequestClose={() => setShareImageUri(null)}><View style={styles.shareScreen}><TouchableOpacity accessibilityLabel="Close share preview" onPress={() => setShareImageUri(null)} style={styles.shareClose}><Ionicons name="close" size={22} color="#202024" /></TouchableOpacity><View ref={shareCanvasRef} collapsable={false} style={styles.shareCanvas}><Image source={{ uri: shareImageUri ?? undefined }} style={styles.shareScreenshot} resizeMode="cover" /><Text style={styles.shareCaption}>Open OurAtlas to explore the full atlas.</Text><View style={styles.qrWrap}><View style={styles.qrPlaceholder}>{Array.from({ length: 25 }).map((_, index) => <View key={index} style={[styles.qrCell, ((index * 7 + index * index) % 5 < 2) && styles.qrCellOn]} />)}</View><Text style={styles.qrCaption}>View OurAtlas</Text></View></View><View style={styles.shareActions}><ShareAction icon="download-outline" label="Save Image" onPress={() => { void saveShareImage(); }} /><ShareAction icon="chatbubble-ellipses-outline" label="Messenger" onPress={() => { void shareToApp('messenger'); }} /><ShareAction icon="logo-instagram" label="Instagram" onPress={() => { void shareToApp('instagram'); }} /></View></View></Modal>
    </>}
  </ContentPanel>;
}

function CompactAtlas({ atlas, onExpand, onDismiss }: { atlas: Atlas; onExpand: () => void; onDismiss: () => void }) {
  return <Pressable style={styles.compact} onPress={onExpand}><View style={styles.compactMark}><Ionicons name="map-outline" size={17} color="#B5551B" /></View><Text numberOfLines={1} style={styles.compactTitle}>{atlas.title}</Text><TouchableOpacity onPress={onDismiss} style={styles.compactClose}><Ionicons name="close" size={19} color="#303035" /></TouchableOpacity></Pressable>;
}

function AtlasRouteControl({ bottom, visible, busy, disabled, onPress }: { bottom: Animated.Value; visible: boolean; busy: boolean; disabled: boolean; onPress: () => void }) {
  return <View pointerEvents="box-none" style={styles.routeMapOverlay}><Animated.View style={[styles.floatingRouteButton, { bottom: 12, transform: [{ translateY: Animated.multiply(bottom, -1) }] }]}><TouchableOpacity accessibilityLabel={visible ? 'Hide route' : 'Show route'} disabled={busy || disabled} onPress={onPress} style={styles.floatingRouteButtonInner}>{busy ? <ActivityIndicator size="small" color="#B9683C" /> : <Ionicons name={visible ? 'eye-off-outline' : 'git-branch-outline'} size={15} color="#B9683C" />}<Text style={styles.floatingRouteText}>{visible ? 'Hide route' : 'Show route'}</Text></TouchableOpacity></Animated.View></View>;
}

function ShareAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return <TouchableOpacity accessibilityLabel={label} onPress={onPress} style={styles.shareAction}><View style={styles.shareActionCircle}><Ionicons name={icon} size={21} color="#A94F1B" /></View><Text style={styles.shareActionText}>{label}</Text></TouchableOpacity>;
}

function OptimizedRouteReview({ items, originalItems, bottomInset, onClose, onSave }: { items: ItineraryItem[]; originalItems: ItineraryItem[]; bottomInset: number; onClose: () => void; onSave: () => void }) {
  const originalIndexByRowId = new Map(originalItems.map((item, index) => [item.rowId, index]));
  return <View style={styles.optimizedReview}><View style={styles.optimizedReviewHeader}><View><Text style={styles.optimizedReviewTitle}>Better route</Text><Text style={styles.optimizedReviewSubtitle}>Optimized stop order</Text></View><TouchableOpacity accessibilityLabel="Close optimized route" onPress={onClose} style={styles.optimizedReviewClose}><Ionicons name="close" size={20} color="#252528" /></TouchableOpacity></View><FlatList data={items} keyExtractor={(item) => item.rowId} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset + 92, gap: 8 }} renderItem={({ item, index }) => { const originalIndex = originalIndexByRowId.get(item.rowId) ?? index; const change = originalIndex - index; return <View style={styles.optimizedRow}><View style={styles.number}><Text style={styles.numberText}>{index + 1}</Text></View>{item.place.photo_url ? <Image source={{ uri: item.place.photo_url }} style={styles.optimizedImage} /> : <View style={[styles.optimizedImage, styles.imageFallback]}><Text style={styles.imageInitial}>{item.place.name.slice(0, 1).toUpperCase()}</Text></View>}<View style={styles.copy}><Text numberOfLines={1} style={styles.name}>{item.place.name}</Text><Text numberOfLines={1} style={styles.address}>{item.place.subtitle}</Text></View>{change ? <View style={[styles.orderChange, change > 0 ? styles.orderUp : styles.orderDown]}><Ionicons name={change > 0 ? 'arrow-up-outline' : 'arrow-down-outline'} size={11} color={change > 0 ? '#217558' : '#986033'} /><Text style={[styles.orderChangeText, change > 0 ? styles.orderUpText : styles.orderDownText]}>{Math.abs(change)}</Text></View> : <View style={styles.orderUnchanged}><Text style={styles.orderUnchangedText}>Same</Text></View>}</View>; }} /><View style={styles.optimizedReviewFooter}><TouchableOpacity onPress={onClose} style={styles.optimizedCancel}><Text style={styles.optimizedCancelText}>Cancel</Text></TouchableOpacity><TouchableOpacity onPress={onSave} style={styles.optimizedSave}><Text style={styles.optimizedSaveText}>Save new route</Text></TouchableOpacity></View></View>;
}

function ItineraryRow({ item, index, nextItem, selected, onPress, onShare, onNavigate }: { item: ItineraryItem; index: number; nextItem?: ItineraryItem; selected: boolean; onPress: () => void; onShare?: () => void; onNavigate?: () => void }) {
  const nextHasMetadata = Boolean(nextItem && (nextItem.time || nextItem.transport));
  const navigationButton = nextItem && onNavigate ? <TouchableOpacity accessibilityLabel={`Navigate from ${item.place.name} to ${nextItem.place.name} in Google Maps`} onPress={onNavigate} activeOpacity={0.7} style={[styles.navigationButton, nextHasMetadata && styles.connectorNavigationButton]}>
    <Ionicons name="logo-google" size={9} color="#4285F4" />
    <Ionicons name="navigate-outline" size={11} color="#3C4043" />
  </TouchableOpacity> : null;
  return <View style={styles.itineraryItem}>
    {index === 0 ? <ItineraryMetadata item={item} onShare={onShare} /> : null}
    <TouchableOpacity onPress={onPress} activeOpacity={0.76} style={[styles.row, selected && styles.rowSelected]}>
      <View style={styles.number}><Text style={styles.numberText}>{index + 1}</Text></View>
      {item.place.photo_url ? <Image source={{ uri: item.place.photo_url }} style={styles.image} /> : <View style={[styles.image, styles.imageFallback]}><Text style={styles.imageInitial}>{item.place.name.slice(0, 1).toUpperCase()}</Text></View>}
      <View style={styles.copy}><Text numberOfLines={1} style={styles.name}>{item.place.name}</Text><Text numberOfLines={1} style={styles.address}>{item.place.subtitle}</Text>{item.note ? <Text numberOfLines={2} style={styles.note}>{item.note}</Text> : null}</View>
    </TouchableOpacity>
    {nextItem ? nextHasMetadata ? <View style={styles.metadataConnector}>
      <View pointerEvents="none" style={styles.connectorLine} />
      <ItineraryMetadata item={nextItem} connector />
      {navigationButton ? <View style={styles.connectorNavigation}>{navigationButton}</View> : null}
    </View> : <View style={styles.navigationGap}>{navigationButton}</View> : null}
  </View>;
}

function ItineraryMetadata({ item, connector = false, onShare }: { item: ItineraryItem; connector?: boolean; onShare?: () => void }) {
  const transport = item.transport ? TRANSPORT_PRESENTATION[item.transport] : null;
  if (!item.time && !transport) {
    return connector ? null : <View style={styles.atlasBeginsRow}><Text style={styles.atlasBeginsText}>Where your Atlas begins</Text>{onShare ? <TouchableOpacity accessibilityLabel="Share OurAtlas" onPress={onShare} style={styles.atlasBeginsShare}><Ionicons name="share-social-outline" size={13} color="#B9683C" /><Text style={styles.atlasBeginsShareText}>Share OurAtlas<Text style={styles.registeredMark}>®</Text></Text></TouchableOpacity> : null}</View>;
  }
  return <View style={[styles.itineraryMetaRow, connector && styles.connectorMetaRow]}>
    {item.time ? <View style={styles.dayMarker}><Ionicons name="time-outline" size={13} color="#2677B5" /><Text style={styles.dayText}>{item.day ? `Day ${item.day} · ${item.time}` : item.time}</Text></View> : null}
    {transport ? <View style={styles.transportMarker}><Ionicons name={transport.icon} size={13} color="#64748B" /><Text style={styles.transportText}>{transport.label}</Text></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  routeMapOverlay: { ...StyleSheet.absoluteFill },
  floatingRouteButton: { position: 'absolute', right: 16, minHeight: 30, borderRadius: 12, backgroundColor: '#FFF8F3', borderWidth: StyleSheet.hairlineWidth, borderColor: '#F0CDB9', shadowColor: '#8B4E2A', shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  floatingRouteButtonInner: { minHeight: 30, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  floatingRouteText: { color: '#B9683C', fontSize: 11, fontWeight: '800' },
  optimizationPrompt: { width: 188, minHeight: 34, marginTop: 5, marginRight: 5, paddingLeft: 8, paddingRight: 3, borderRadius: 10, backgroundColor: '#EDF8F1', flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: '#B9DFC9' },
  optimizationPromptMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 },
  optimizationPromptText: { flex: 1, color: '#2B654F', fontSize: 9, lineHeight: 12, fontWeight: '700' },
  optimizationPromptClose: { width: 24, height: 26, alignItems: 'center', justifyContent: 'center' },
  optimizedReview: { flex: 1, backgroundColor: '#FFF' },
  optimizedReviewHeader: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optimizedReviewTitle: { color: '#202024', fontSize: 21, fontWeight: '800' },
  optimizedReviewSubtitle: { color: '#75757D', fontSize: 12, marginTop: 2 },
  optimizedReviewClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F2F3', alignItems: 'center', justifyContent: 'center' },
  optimizedRow: { minHeight: 70, padding: 8, borderRadius: 12, backgroundColor: '#FAFAFB', flexDirection: 'row', alignItems: 'center', gap: 8 },
  optimizedImage: { width: 48, height: 48, borderRadius: 9, backgroundColor: '#E7ECF0' },
  orderChange: { minWidth: 31, paddingHorizontal: 5, paddingVertical: 4, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1 },
  orderUp: { backgroundColor: '#E7F7EE' },
  orderDown: { backgroundColor: '#FFF1E4' },
  orderChangeText: { fontSize: 10, fontWeight: '800' },
  orderUpText: { color: '#217558' },
  orderDownText: { color: '#986033' },
  orderUnchanged: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: 8, backgroundColor: '#F0F1F2' },
  orderUnchangedText: { color: '#85858C', fontSize: 9, fontWeight: '700' },
  optimizedReviewFooter: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 18, backgroundColor: 'rgba(255,255,255,0.96)', borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#E7E8EA', flexDirection: 'row', gap: 10 },
  optimizedCancel: { flex: 1, minHeight: 44, borderRadius: 13, backgroundColor: '#F0F1F2', alignItems: 'center', justifyContent: 'center' },
  optimizedCancelText: { color: '#45454A', fontSize: 14, fontWeight: '800' },
  optimizedSave: { flex: 1.35, minHeight: 44, borderRadius: 13, backgroundColor: '#D96827', alignItems: 'center', justifyContent: 'center' },
  optimizedSaveText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  shareAtlasButton: { alignSelf: 'center', marginTop: 18, marginBottom: 8, minHeight: 38, paddingHorizontal: 16, borderRadius: 19, backgroundColor: '#D96827', flexDirection: 'row', alignItems: 'center', gap: 7, shadowColor: '#7C3413', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.16, shadowRadius: 7, elevation: 3 },
  shareAtlasText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  registeredMark: { fontSize: 7, lineHeight: 10, verticalAlign: 'top' },
  shareScreen: { flex: 1, backgroundColor: '#F8F7F4', paddingHorizontal: 20, paddingTop: 68, alignItems: 'center' },
  shareClose: { position: 'absolute', right: 20, top: 54, width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
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
  shareActionCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFF0E7', alignItems: 'center', justifyContent: 'center' },
  shareActionText: { color: '#433C37', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  headerActions: { alignItems: 'flex-end', marginTop: -4 },
  headerTopActions: { flexDirection: 'row', alignItems: 'center' },
  showRouteButton: { minHeight: 28, marginTop: -4, marginRight: 5, paddingHorizontal: 9, borderRadius: 14, backgroundColor: '#FFF3EA', flexDirection: 'row', alignItems: 'center', gap: 4 },
  showRouteButtonDisabled: { opacity: 0.46 },
  showRouteText: { color: '#B85217', fontSize: 11, fontWeight: '700' },
  atlasBeginsRow: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 4 },
  atlasBeginsText: { color: '#242428', fontSize: 12, fontWeight: '600' },
  atlasBeginsShare: { minHeight: 26, paddingHorizontal: 8, borderRadius: 12, backgroundColor: '#FFF8F3', borderWidth: StyleSheet.hairlineWidth, borderColor: '#F0CDB9', flexDirection: 'row', alignItems: 'center', gap: 4 },
  atlasBeginsShareText: { color: '#B9683C', fontSize: 10, fontWeight: '800' },
  header: { paddingHorizontal: 16, paddingTop: 7, paddingBottom: 11, flexDirection: 'row', alignItems: 'center', gap: 2 }, title: { fontSize: 22, fontWeight: '700', color: '#18181B' }, meta: { color: '#7B7B82', fontSize: 12, marginTop: 3 }, compact: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 }, compactMark: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFF0E6', alignItems: 'center', justifyContent: 'center' }, compactTitle: { flex: 1, color: '#202024', fontSize: 17, fontWeight: '700' }, compactClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F1F2F4', alignItems: 'center', justifyContent: 'center' }, empty: { paddingTop: 48, alignItems: 'center' }, emptyText: { color: '#808087', fontSize: 15 }, itineraryItem: { position: 'relative' }, itineraryMetaRow: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, marginBottom: 4 }, connectorMetaRow: { width: '42%', minHeight: 48, flexWrap: 'wrap', alignContent: 'center', marginTop: 0, marginBottom: 0, paddingVertical: 7 }, metadataConnector: { position: 'relative', minHeight: 48 }, connectorLine: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: StyleSheet.hairlineWidth, marginLeft: -StyleSheet.hairlineWidth / 2, backgroundColor: '#DDE2E7' }, navigationGap: { position: 'relative', height: 7 }, dayMarker: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#EAF4FF', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 }, dayText: { color: '#2677B5', fontSize: 11, fontWeight: '700' }, transportMarker: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F1F4F5', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 }, transportText: { color: '#53616B', fontSize: 11, fontWeight: '700' }, connectorNavigation: { position: 'absolute', top: '50%', left: 0, right: 0, height: 18, marginTop: -9 }, navigationButton: { position: 'absolute', left: '50%', top: -8, marginLeft: -14, width: 28, height: 18, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: '#D4D9E0', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1, zIndex: 5 }, connectorNavigationButton: { top: 0 }, row: { minHeight: 76, borderRadius: 14, padding: 9, backgroundColor: '#FAFAFB', flexDirection: 'row', alignItems: 'center', gap: 9 }, rowSelected: { backgroundColor: '#FCFCFD', borderWidth: 1, borderColor: '#E6E8EB' }, number: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#E77B32', alignItems: 'center', justifyContent: 'center' }, numberText: { color: '#FFF', fontSize: 11, fontWeight: '800' }, image: { width: 54, height: 54, borderRadius: 11, backgroundColor: '#E7ECF0' }, imageFallback: { alignItems: 'center', justifyContent: 'center' }, imageInitial: { color: '#426177', fontSize: 19, fontWeight: '700' }, copy: { flex: 1, minWidth: 0 }, name: { color: '#202024', fontSize: 14, fontWeight: '700' }, address: { color: '#85858C', fontSize: 12, marginTop: 2 }, note: { color: '#48708C', fontSize: 11, lineHeight: 15, fontStyle: 'italic', marginTop: 4 },
});
