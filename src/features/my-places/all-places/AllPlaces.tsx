import { ReactNode } from 'react';
import PlaceCard from '@/components/place-card/PlaceCard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlatList, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import { mockPlaceDetails } from '../../../../mock-data/mockPlaceDetails';
import { PlaceDetail } from '@/types/place';

const MOCK_DATES = [
  'May 31, 2025',
  'Jun 2, 2025',
  'Jun 8, 2025',
  'Jun 15, 2025',
  'Jun 22, 2025',
];

type AllPlacesProps = {
  onPlacePress?: (place: PlaceDetail) => void;
  bottomInset?: number;
  /** Rendered at the very top of the scroll content (e.g. the segmented control)
      so it scrolls away with the list instead of staying pinned. */
  listHeader?: ReactNode;
  /** Reports vertical scroll offset so the panel can gate its drag gesture. */
  onScroll?: (y: number) => void;
};

export default function AllPlaces({ onPlacePress, bottomInset = 0, listHeader, onScroll }: AllPlacesProps) {
  return (
    <FlatList
      data={mockPlaceDetails}
      keyExtractor={(item) => item.id}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: bottomInset + 100 }}
      onScroll={(e) => onScroll?.(e.nativeEvent.contentOffset.y)}
      scrollEventThrottle={16}
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
      ItemSeparatorComponent={() => (
        <View style={{ height: 1, backgroundColor: 'rgba(60,60,67,0.07)', marginHorizontal: 16, marginVertical: 12 }} />
      )}
      renderItem={({ item, index }) => (
        <View style={{ paddingHorizontal: 16 }}>
          <PlaceCard
            name={item.name}
            description={item.summary}
            imageUrl={item.thumbnailUrl}
            tags={item.tags}
            date={MOCK_DATES[index % MOCK_DATES.length]}
            onPress={() => onPlacePress?.(item)}
          />
        </View>
      )}
      showsVerticalScrollIndicator={false}
    />
  );
}
