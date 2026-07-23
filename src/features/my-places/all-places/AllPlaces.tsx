import { Text } from '@/components/ui/text';
import { useHome } from '@/features/home/HomeContext';
import { fetchSavedPlaces, toPlaceDetail } from '@/services/place/placeService';
import { typography } from '@/theme/typography';
import { PlaceDetail } from '@/types/place';
import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { PlaceCard } from './PlaceCard';

/** Rows rendered per page — keeps the FlatList light as saved places grow. */
const PAGE_SIZE = 20;

type AllPlacesProps = {
  onPlacePress?: (place: PlaceDetail) => void;
  bottomInset?: number;
  /** Reports vertical scroll offset so the panel can gate its drag gesture. */
  onScroll?: (y: number) => void;
};

function ItemSeparator() {
  return (
    <View style={{ height: 1, backgroundColor: 'rgba(60,60,67,0.07)', marginHorizontal: 16, marginVertical: 12 }} />
  );
}

function AllPlaces({ onPlacePress, bottomInset = 0, onScroll }: AllPlacesProps) {
  const [places, setPlaces] = useState<PlaceDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { deleteSavedPlace, savedPlaces } = useHome();

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
      <PlaceCard item={item} onPress={onPlacePress} onDelete={handleDelete} />
    ),
    [onPlacePress, handleDelete],
  );

  const keyExtractor = useCallback((item: PlaceDetail) => item.id, []);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
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
      ListHeaderComponent={
        <View style={{ paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center' }}>
          <Text className="text-text-secondary" style={typography.subheader}>
            Recent pins
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#717171" />
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
      showsVerticalScrollIndicator
    />
  );
}

export default memo(AllPlaces);
