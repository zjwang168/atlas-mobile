import Ionicons from '@expo/vector-icons/Ionicons';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import ContentPanel from '@/components/content-panel/ContentPanel';
import { useHome } from '@/features/home/HomeContext';
import type { MapMarker } from '@/features/map/MapboxMap';
import AtlasBuilder from '@/features/my-plan/atlas-builder/AtlasBuilder';
import { decodeAtlasPlaceMetadata, type AtlasTransportMode } from '@/services/atlas/atlasPlaceMetadata';
import type { Atlas } from '@/types/atlas';
import type { SavedPlace } from '@/services/place/placeService';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';

type AtlasDetailProps = {
  atlasId: string | null;
  onDismiss: () => void;
  snapGroup?: string;
  onHeightChange?: (height: number) => void;
};

type AtlasDisplayPlace = Pick<SavedPlace, 'id' | 'name' | 'subtitle' | 'latitude' | 'longitude' | 'photo_url'>;
type ItineraryItem = { place: AtlasDisplayPlace; rowId: string; note: string | null; day: number | null; time: string | null; transport: AtlasTransportMode | null };
type FocusBounds = { ne: [number, number]; sw: [number, number] };

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

export default function AtlasDetail({ atlasId, onDismiss, snapGroup, onHeightChange }: AtlasDetailProps) {
  const { atlases, savedPlaces, atlasPlaces, setAtlasMapState } = useHome();
  const [editing, setEditing] = useState(false);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
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

  const presentation = useMemo(() => getMapPresentation(items, atlas?.route_visible ? atlas.route_geojson ?? null : null), [atlas?.route_geojson, atlas?.route_visible, items]);

  useLayoutEffect(() => {
    if (!atlas || editing) return;
    setAtlasMapState({
      ...presentation,
      cameraAnimationDurationMs: 320,
      selectedMarkerId: selectedPlaceId,
      onMarkerPress: (marker) => setSelectedPlaceId(marker.id),
      onMapPress: () => setSelectedPlaceId(null),
    });
    return () => setAtlasMapState(null);
  }, [atlas, editing, presentation, selectedPlaceId, setAtlasMapState]);

  useEffect(() => {
    if (!atlasId) setEditing(false);
  }, [atlasId]);

  if (!atlas) return null;

  return <ContentPanel visible={Boolean(atlasId)} onHidden={onDismiss} zIndex={40} snapGroup={snapGroup} minSnap="default" onHeightChange={onHeightChange} compactContent={({ snapTo }) => <CompactAtlas atlas={atlas} onExpand={() => snapTo('default')} onDismiss={onDismiss} />}>
    {({ reportScrollY, bottomInset }) => editing ? <AtlasBuilder atlasId={atlas.id} initialCenter={presentation.centerCoordinate} initialBounds={presentation.bounds} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} /> : <>
      <View style={styles.header}><View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.title}>{atlas.title}</Text><Text style={styles.meta}>{items.length} {items.length === 1 ? 'place' : 'places'} · Map itinerary</Text></View><Button accessibilityLabel="Edit atlas" onPress={() => setEditing(true)} size="icon" variant="ghost" className="h-11 w-11 rounded-full bg-background"><Ionicons name="pencil-outline" size={19} color="#18181B" /></Button><Button accessibilityLabel="Dismiss atlas" onPress={onDismiss} size="icon" variant="ghost" className="h-11 w-11 rounded-full bg-background"><Ionicons name="close" size={21} color="#18181B" /></Button></View>
      <FlatList data={items} keyExtractor={(item) => item.rowId} onScroll={(event) => reportScrollY(event.nativeEvent.contentOffset.y)} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset + 20, gap: 7 }} ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>This Atlas has no places yet.</Text></View>} renderItem={({ item, index }) => <ItineraryRow item={item} index={index} selected={selectedPlaceId === item.place.id} onPress={() => setSelectedPlaceId(item.place.id)} />} />
    </>}
  </ContentPanel>;
}

function CompactAtlas({ atlas, onExpand, onDismiss }: { atlas: Atlas; onExpand: () => void; onDismiss: () => void }) {
  return <Pressable style={styles.compact} onPress={onExpand}><View style={styles.compactMark}><Ionicons name="map-outline" size={17} color="#B5551B" /></View><Text numberOfLines={1} style={styles.compactTitle}>{atlas.title}</Text><TouchableOpacity onPress={onDismiss} style={styles.compactClose}><Ionicons name="close" size={19} color="#303035" /></TouchableOpacity></Pressable>;
}

function ItineraryRow({ item, index, selected, onPress }: { item: ItineraryItem; index: number; selected: boolean; onPress: () => void }) {
  const transport = item.transport ? TRANSPORT_PRESENTATION[item.transport] : null;
  return <View>
    {item.day && item.time || transport ? <View style={styles.itineraryMetaRow}>
      {item.day && item.time ? <View style={styles.dayMarker}><Ionicons name="time-outline" size={13} color="#2677B5" /><Text style={styles.dayText}>Day {item.day} · {item.time}</Text></View> : null}
      {transport ? <View style={styles.transportMarker}><Ionicons name={transport.icon} size={13} color="#64748B" /><Text style={styles.transportText}>{transport.label}</Text></View> : null}
    </View> : null}
    <TouchableOpacity onPress={onPress} activeOpacity={0.76} style={[styles.row, selected && styles.rowSelected]}>
      <View style={styles.number}><Text style={styles.numberText}>{index + 1}</Text></View>
      {item.place.photo_url ? <Image source={{ uri: item.place.photo_url }} style={styles.image} /> : <View style={[styles.image, styles.imageFallback]}><Text style={styles.imageInitial}>{item.place.name.slice(0, 1).toUpperCase()}</Text></View>}
      <View style={styles.copy}><Text numberOfLines={1} style={styles.name}>{item.place.name}</Text><Text numberOfLines={1} style={styles.address}>{item.place.subtitle}</Text>{item.note ? <Text numberOfLines={2} style={styles.note}>{item.note}</Text> : null}</View>
    </TouchableOpacity>
  </View>;
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 7, paddingBottom: 11, flexDirection: 'row', alignItems: 'center', gap: 2 }, title: { fontSize: 22, fontWeight: '700', color: '#18181B' }, meta: { color: '#7B7B82', fontSize: 12, marginTop: 3 }, compact: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8 }, compactMark: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFF0E6', alignItems: 'center', justifyContent: 'center' }, compactTitle: { flex: 1, color: '#202024', fontSize: 17, fontWeight: '700' }, compactClose: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F1F2F4', alignItems: 'center', justifyContent: 'center' }, empty: { paddingTop: 48, alignItems: 'center' }, emptyText: { color: '#808087', fontSize: 15 }, itineraryMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, marginBottom: 4 }, dayMarker: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#EAF4FF', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 }, dayText: { color: '#2677B5', fontSize: 11, fontWeight: '700' }, transportMarker: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F1F4F5', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 }, transportText: { color: '#53616B', fontSize: 11, fontWeight: '700' }, row: { minHeight: 76, borderRadius: 14, padding: 9, backgroundColor: '#FAFAFB', flexDirection: 'row', alignItems: 'center', gap: 9 }, rowSelected: { backgroundColor: '#FFF4EC', borderWidth: 1, borderColor: '#F1B98E' }, number: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#E77B32', alignItems: 'center', justifyContent: 'center' }, numberText: { color: '#FFF', fontSize: 11, fontWeight: '800' }, image: { width: 54, height: 54, borderRadius: 11, backgroundColor: '#E7ECF0' }, imageFallback: { alignItems: 'center', justifyContent: 'center' }, imageInitial: { color: '#426177', fontSize: 19, fontWeight: '700' }, copy: { flex: 1, minWidth: 0 }, name: { color: '#202024', fontSize: 14, fontWeight: '700' }, address: { color: '#85858C', fontSize: 12, marginTop: 2 }, note: { color: '#48708C', fontSize: 11, lineHeight: 15, fontStyle: 'italic', marginTop: 4 },
});
