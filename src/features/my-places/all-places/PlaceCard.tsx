import BasePlaceCard from '@/components/place-card/PlaceCard';
import { PlaceDetail } from '@/types/place';
import Ionicons from '@expo/vector-icons/Ionicons';
import { memo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

type PlaceCardProps = {
  item: PlaceDetail;
  isActive: boolean;
  onPress?: (place: PlaceDetail) => void;
  onDelete: (id: string) => void;
};

/** Memoized so unrelated re-renders of AllPlaces (e.g. ContentPanel drag
    frames) don't force every visible row to re-render — only rows whose
    own props actually changed do. */
export const PlaceCard = memo(function PlaceCard({ item, isActive, onPress, onDelete }: PlaceCardProps) {
  return (
    <View style={[styles.row, { paddingHorizontal: 16 }, isActive && styles.rowActive]}>
      <View style={{ flex: 1 }}>
        <BasePlaceCard
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
