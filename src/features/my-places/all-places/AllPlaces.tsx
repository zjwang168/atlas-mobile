import { Text } from '@/components/ui/text';
import { useHome } from '@/features/home/HomeContext';
import { toPlaceDetail, type SavedPlace } from '@/services/place/placeService';
import { typography } from '@/theme/typography';
import { PlaceDetail } from '@/types/place';
import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, View, type ViewToken } from 'react-native';
import Reanimated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { PlaceCard, PLACE_CARD_ROW_HEIGHT } from './PlaceCard';

const PLACE_CARD_SEPARATOR_HEIGHT = 25;

type SortMode = 'recent' | 'location';

type AllPlacesProps = {
  onPlacePress?: (place: PlaceDetail) => void;
  bottomInset?: number;
  /** Reports vertical scroll offset so the panel can gate its drag gesture. */
  onScroll?: (y: number) => void;
  onDeleteInitiated?: (place: PlaceDetail) => void;
  onManageSpecialPlace?: (role: NonNullable<PlaceDetail['specialRole']>) => void;
};

function ItemSeparator() {
  return (
    <View style={styles.itemSeparator} />
  );
}

function formatAddedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently added';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function placeLocationLabel(place: SavedPlace): string {
  const city = place.city?.trim();
  const country = place.country?.trim();
  if (city && country) return `${city}, ${country}`;
  if (city) return city;
  if (place.region?.trim()) return place.region.trim();
  if (country) return country;
  return 'Other places';
}

function distanceFromUserKm(
  [userLongitude, userLatitude]: [number, number],
  place: Pick<SavedPlace, 'longitude' | 'latitude'>,
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latitudeDelta = radians(place.latitude - userLatitude);
  const longitudeDelta = radians(place.longitude - userLongitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(userLatitude)) * Math.cos(radians(place.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sortRows(rows: SavedPlace[], sortMode: SortMode, userLocation: [number, number]): SavedPlace[] {
  if (sortMode === 'recent') {
    return [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }

  const groups = new Map<string, { label: string; distance: number; places: SavedPlace[] }>();
  rows.forEach((place) => {
    const label = placeLocationLabel(place);
    const key = label.toLocaleLowerCase();
    const distance = distanceFromUserKm(userLocation, place);
    const group = groups.get(key);
    if (group) {
      group.places.push(place);
      group.distance = Math.min(group.distance, distance);
      return;
    }
    groups.set(key, { label, distance, places: [place] });
  });

  return [...groups.values()]
    .sort((a, b) => a.distance - b.distance || a.label.localeCompare(b.label))
    .flatMap((group) => group.places.sort((a, b) => (
      distanceFromUserKm(userLocation, a) - distanceFromUserKm(userLocation, b)
      || Date.parse(b.created_at) - Date.parse(a.created_at)
    )));
}

function contextForPlace(place: SavedPlace | undefined, sortMode: SortMode): string {
  if (!place) return sortMode === 'recent' ? 'No pins yet' : 'No locations yet';
  return sortMode === 'recent' ? formatAddedDate(place.created_at) : placeLocationLabel(place);
}

function AllPlaces({ onPlacePress, bottomInset = 0, onScroll, onDeleteInitiated, onManageSpecialPlace }: AllPlacesProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [activeContext, setActiveContext] = useState('Recently added');
  const { deleteSavedPlace, refreshSavedPlaces, savedPlaces, savedPlacesLoaded, selectedPlaceId, userLocation } = useHome();
  const listRef = useRef<FlatList<SavedPlace>>(null);
  const contextByIdRef = useRef(new Map<string, string>());

  const sortedRows = useMemo(
    () => sortRows(savedPlaces, sortMode, userLocation),
    [savedPlaces, sortMode, userLocation],
  );
  const placesById = useMemo(
    () => new Map(sortedRows.map((row) => [row.id, toPlaceDetail(row)])),
    [sortedRows],
  );

  useEffect(() => {
    contextByIdRef.current = new Map(
      sortedRows.map((place) => [place.id, contextForPlace(place, sortMode)]),
    );
    setActiveContext(contextForPlace(sortedRows[0], sortMode));
  }, [sortedRows, sortMode]);

  useEffect(() => {
    if (!savedPlacesLoaded || !selectedPlaceId) return;
    const index = sortedRows.findIndex((place) => place.id === selectedPlaceId);
    if (index < 0) return;
    const timeout = setTimeout(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.38 });
    }, 40);
    return () => clearTimeout(timeout);
  }, [savedPlacesLoaded, selectedPlaceId, sortedRows]);

  const handleDelete = useCallback((id: string) => {
    deleteSavedPlace(id);
  }, [deleteSavedPlace]);

  const handleSortChange = useCallback((nextSortMode: SortMode) => {
    setSortMenuOpen(false);
    if (nextSortMode === sortMode) return;
    setSortMode(nextSortMode);
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
  }, [sortMode]);

  const handleViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<ViewToken<SavedPlace>> }) => {
    const firstVisible = viewableItems.find((item) => item.isViewable && item.item);
    const nextContext = firstVisible ? contextByIdRef.current.get(firstVisible.item.id) : undefined;
    if (nextContext) setActiveContext((current) => current === nextContext ? current : nextContext);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 55 }).current;

  const renderItem = useCallback(
    ({ item }: { item: SavedPlace }) => {
      const place = placesById.get(item.id);
      if (!place) return null;
      return (
        <PlaceCard
          item={place}
          selected={selectedPlaceId === item.id}
          onPress={onPlacePress}
          onDelete={handleDelete}
          onDeleteInitiated={onDeleteInitiated}
          onManageSpecialPlace={onManageSpecialPlace}
        />
      );
    },
    [placesById, onPlacePress, handleDelete, selectedPlaceId, onDeleteInitiated, onManageSpecialPlace],
  );

  const keyExtractor = useCallback((item: SavedPlace) => item.id, []);

  if (!savedPlacesLoaded) {
    return (
      <View style={styles.initializingState}>
        <ActivityIndicator size="small" color="#16845B" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.listToolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change place sorting"
          onPress={() => setSortMenuOpen(true)}
          style={({ pressed }) => [styles.sortControl, pressed && styles.sortControlPressed]}
        >
          <Text className="text-text-secondary" style={typography.subheader}>Recent pins</Text>
          <Ionicons name="chevron-down" size={15} color="#717171" />
        </Pressable>
        <View style={styles.contextLabel}>
          <Reanimated.View key={activeContext} entering={FadeInDown.duration(180)} exiting={FadeOutUp.duration(120)}>
            <Text numberOfLines={1} className="text-text-secondary" style={styles.contextText}>
              {activeContext}
            </Text>
          </Reanimated.View>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={sortedRows}
        keyExtractor={keyExtractor}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: bottomInset + 20 }}
        onScroll={(event) => onScroll?.(event.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          refreshSavedPlaces().finally(() => setRefreshing(false));
        }}
        onViewableItemsChanged={handleViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({
          length: PLACE_CARD_ROW_HEIGHT + PLACE_CARD_SEPARATOR_HEIGHT,
          offset: (PLACE_CARD_ROW_HEIGHT + PLACE_CARD_SEPARATOR_HEIGHT) * index,
          index,
        })}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 48, paddingHorizontal: 32 }}>
            <Text className="text-text-secondary" style={typography.bodySmall}>
              No saved places yet - import a link and tap Save places.
            </Text>
          </View>
        }
        initialNumToRender={32}
        maxToRenderPerBatch={32}
        windowSize={17}
        ItemSeparatorComponent={ItemSeparator}
        renderItem={renderItem}
        showsVerticalScrollIndicator
      />

      <Modal transparent visible={sortMenuOpen} animationType="fade" onRequestClose={() => setSortMenuOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSortMenuOpen(false)} />
          <View style={styles.sortMenu}>
            <Text style={styles.sortMenuTitle}>Sort places</Text>
            <Pressable style={styles.sortOption} onPress={() => handleSortChange('recent')}>
              <Ionicons name="time-outline" size={19} color="#161616" />
              <Text style={styles.sortOptionText}>Recently added</Text>
              {sortMode === 'recent' ? <Ionicons name="checkmark" size={20} color="#16845B" /> : null}
            </Pressable>
            <Pressable style={styles.sortOption} onPress={() => handleSortChange('location')}>
              <Ionicons name="location-outline" size={19} color="#161616" />
              <Text style={styles.sortOptionText}>Nearby</Text>
              {sortMode === 'location' ? <Ionicons name="checkmark" size={20} color="#16845B" /> : null}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  initializingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemSeparator: {
    height: PLACE_CARD_SEPARATOR_HEIGHT,
    marginHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(60,60,67,0.07)',
  },
  listToolbar: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sortControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 4,
    paddingRight: 4,
  },
  sortControlPressed: { opacity: 0.56 },
  contextLabel: {
    flex: 1,
    alignItems: 'flex-end',
    overflow: 'hidden',
    minHeight: 20,
  },
  contextText: {
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  sortMenu: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 34,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  sortMenuTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#717171',
    marginBottom: 10,
  },
  sortOption: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sortOptionText: {
    flex: 1,
    color: '#161616',
    fontSize: 17,
    fontWeight: '500',
  },
});

export default memo(AllPlaces);
