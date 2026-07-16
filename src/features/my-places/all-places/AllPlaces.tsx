import PlaceCard from '@/components/place-card/PlaceCard';
import { Text } from '@/components/ui/text';
import { useHome } from '@/features/home/HomeContext';
import { fetchSavedPlaces, SavedPlace } from '@/services/place/placeService';
import { typography } from '@/theme/typography';
import { PlaceDetail } from '@/types/place';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { memo, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';

/** Rows rendered per page — keeps the FlatList light as saved places grow. */
const PAGE_SIZE = 20;

type AllPlacesProps = {
  onPlacePress?: (place: PlaceDetail) => void;
  bottomInset?: number;
  /** Rendered at the very top of the scroll content (e.g. the segmented control)
      so it scrolls away with the list instead of staying pinned. */
  listHeader?: ReactNode;
  /** Reports vertical scroll offset so the panel can gate its drag gesture. */
  onScroll?: (y: number) => void;
  /** ID of the currently selected place (for highlighting & auto-scroll). */
  selectedPlaceId?: string | null;
};

const MAPBOX_TOKEN: string =
  (Constants.expoConfig?.extra?.mapboxAccessToken as string) ||
  (process.env.MAPBOX_ACCESS_TOKEN as string) ||
  '';

/** Static map thumbnail centered on the place (Mapbox Static Images API).
    Note: Mapbox expects LONGITUDE first. */
function staticMapThumb(lat: number, lng: number): string {
  if (!MAPBOX_TOKEN) return '';
  return (
    `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/` +
    `pin-s+3b82f6(${lng},${lat})/${lng},${lat},14,0/200x200@2x` +
    `?access_token=${MAPBOX_TOKEN}`
  );
}

/** Adapt a DB row to the PlaceDetail shape the detail screens expect.
    Fields we don't persist yet get sensible defaults. */
function toPlaceDetail(row: SavedPlace): PlaceDetail {
  return {
    id: row.id,
    name: row.name,
    subtitle: row.subtitle ?? '',
    latitude: row.latitude,
    longitude: row.longitude,
    address: row.region ?? '',
    thumbnailUrl: staticMapThumb(row.latitude, row.longitude),
    schedule: [],
    tags: row.category ? [{ id: row.category, label: row.category }] : [],
    summary: row.subtitle ?? '',
    visitStrategy: '',
    savedAt: new Date(row.created_at).toLocaleDateString(),
  };
}

type PlaceRowProps = {
  item: PlaceDetail;
  isActive: boolean;
  onPress?: (place: PlaceDetail) => void;
  onDelete: (id: string) => void;
};

/** Memoized so unrelated re-renders of AllPlaces (e.g. ContentPanel drag
    frames) don't force every visible PlaceCard to re-render — only rows
    whose own props actually changed do. */
const PlaceRow = memo(function PlaceRow({ item, isActive, onPress, onDelete }: PlaceRowProps) {
  return (
    <View style={[styles.row, { paddingHorizontal: 16 }, isActive && styles.rowActive]}>
      <View style={{ flex: 1 }}>
        <PlaceCard
          name={item.name}
          description={item.summary}
          imageUrl={item.thumbnailUrl}
          tags={item.tags}
          date={item.savedAt}
          onPress={() => onPress?.(item)}
        />
      </View>
      <TouchableOpacity onPress={() => onDelete(item.id)} style={{ marginLeft: 8, padding: 8 }}>
        <Ionicons name="trash-outline" size={20} color="#DC2626" />
      </TouchableOpacity>
    </View>
  );
});

function ItemSeparator() {
  return (
    <View style={{ height: 1, backgroundColor: 'rgba(60,60,67,0.07)', marginHorizontal: 16, marginVertical: 12 }} />
  );
}

function AllPlaces({ onPlacePress, bottomInset = 0, listHeader, onScroll, selectedPlaceId }: AllPlacesProps) {
  const [places, setPlaces] = useState<PlaceDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const listRef = useRef<FlatList<PlaceDetail>>(null);
  const { deleteSavedPlace, selectedPlaceId: contextSelectedId, savedPlaces } = useHome();
  // Use the prop if provided, otherwise fall back to context value
  const effectiveSelectedId = selectedPlaceId ?? contextSelectedId;

  const handleDelete = useCallback((id: string) => {
    deleteSavedPlace(id);
    setPlaces((prev) => prev.filter((p) => p.id !== id));
  }, [deleteSavedPlace]);

  const load = useCallback(async () => {
    try {
      const rows = await fetchSavedPlaces();
      setPlaces(rows.map(toPlaceDetail));
    } catch (e) {
      console.error('[AllPlaces] failed to load places:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPlaces(savedPlaces.map(toPlaceDetail));
    setLoading(false);
  }, [savedPlaces]);

  const visibleData = useMemo(() => places.slice(0, visibleCount), [places, visibleCount]);

  const handleEndReached = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, places.length));
  }, [places.length]);

  const renderItem = useCallback(
    ({ item }: { item: PlaceDetail }) => (
      <PlaceRow
        item={item}
        isActive={effectiveSelectedId === item.id}
        onPress={onPlacePress}
        onDelete={handleDelete}
      />
    ),
    [effectiveSelectedId, onPlacePress, handleDelete],
  );

  const keyExtractor = useCallback((item: PlaceDetail) => item.id, []);

  // Auto-scroll to the selected place when selectedPlaceId changes. If the
  // place hasn't been paged into view yet, pull in enough pages first.
  useEffect(() => {
    if (effectiveSelectedId && places.length > 0) {
      const idx = places.findIndex((p) => p.id === effectiveSelectedId);
      if (idx >= 0 && idx >= visibleCount) {
        setVisibleCount(Math.min(places.length, idx + PAGE_SIZE));
      }
    }
  }, [selectedPlaceId, places, visibleCount]);

  useEffect(() => {
    if (!effectiveSelectedId) return;
    const idx = visibleData.findIndex((p) => p.id === effectiveSelectedId);
    if (idx >= 0) {
      listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
    }
  }, [selectedPlaceId, visibleData]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      ref={listRef}
      data={visibleData}
      keyExtractor={keyExtractor}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: bottomInset + 20 }}
      onScroll={(e) => onScroll?.(e.nativeEvent.contentOffset.y)}
      scrollEventThrottle={16}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        setVisibleCount(PAGE_SIZE);
        load();
      }}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.5}
      ListFooterComponent={
        visibleData.length < places.length ? (
          <View style={{ paddingVertical: 16 }}>
            <ActivityIndicator />
          </View>
        ) : null
      }
      initialNumToRender={PAGE_SIZE}
      maxToRenderPerBatch={PAGE_SIZE}
      windowSize={7}
      removeClippedSubviews
      ListHeaderComponent={
        <View>
          {listHeader}
          <View style={{ paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center' }}>
            <Text className="text-text-secondary" style={typography.subheader}>
              Recent pins
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#717171" />
          </View>
        </View>
      }
      ListEmptyComponent={
        <View style={{ alignItems: 'center', paddingTop: 48, paddingHorizontal: 32 }}>
          <Text className="text-text-secondary" style={typography.bodySmall}>
            No saved places yet — import a link and tap Save places.
          </Text>
        </View>
      }
      ItemSeparatorComponent={ItemSeparator}
      renderItem={renderItem}
      showsVerticalScrollIndicator={false}
    />
  );
}

export default memo(AllPlaces);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowActive: {
    backgroundColor: '#F2FBF6',
    borderRadius: 18,
  },
});
