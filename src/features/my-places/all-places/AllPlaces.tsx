import PlaceCard from '@/components/place-card/PlaceCard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FlatList, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { mockPlaceDetails } from '../../../../mock-data/mockPlaceDetails';
import { PlaceDetail } from '@/types/place';

type AllPlacesProps = {
  onPlacePress?: (place: PlaceDetail) => void;
  bottomInset?: number;
};

export default function AllPlaces({ onPlacePress, bottomInset = 0 }: AllPlacesProps) {
  return (
    <FlatList
      data={mockPlaceDetails}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ paddingBottom: bottomInset + 100 }}
      ListHeaderComponent={
        <View style={{ paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: '#808080', lineHeight: 22, letterSpacing: -0.43 }}>
            Recent pins
          </Text>
          <Ionicons name="chevron-forward" size={16} color="#808080" />
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
