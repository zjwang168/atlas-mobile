import { ReactNode, useCallback, useEffect, useState } from 'react';
import Constants from 'expo-constants';
import PlaceCard from '@/components/place-card/PlaceCard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import { PlaceDetail } from '@/types/place';
import { fetchSavedPlaces, SavedPlace } from '@/services/place/placeService';

type AllPlacesProps = {
  onPlacePress?: (place: PlaceDetail) => void;
  bottomInset?: number;
  /** Rendered at the very top of the scroll content (e.g. the segmented control)
      so it scrolls away with the list instead of staying pinned. */
  listHeader?: ReactNode;
  /** Reports vertical scroll offset so the panel can gate its drag gesture. */
  onScroll?: (y: number) => void;
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

export default function AllPlaces({ onPlacePress, bottomInset = 0, listHeader, onScroll }: AllPlacesProps) {
  const [places, setPlaces] = useState<PlaceDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      data={places}
      keyExtractor={(item) => item.id}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: bottomInset + 20 }}
      onScroll={(e) => onScroll?.(e.nativeEvent.contentOffset.y)}
      scrollEventThrottle={16}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        load();
      }}
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
      ItemSeparatorComponent={() => (
        <View style={{ height: 1, backgroundColor: 'rgba(60,60,67,0.07)', marginHorizontal: 16, marginVertical: 12 }} />
      )}
      renderItem={({ item }) => (
        <View style={{ paddingHorizontal: 16 }}>
          <PlaceCard
            name={item.name}
            description={item.summary}
            imageUrl={item.thumbnailUrl}
            tags={item.tags}
            date={item.savedAt}
            onPress={() => onPlacePress?.(item)}
          />
        </View>
      )}
      showsVerticalScrollIndicator={false}
    />
  );
}