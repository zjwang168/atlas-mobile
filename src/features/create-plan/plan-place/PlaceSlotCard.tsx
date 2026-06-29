import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { GestureDetector } from 'react-native-gesture-handler';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { useDragCard } from './dnd/useDragCard';
import { registerPlaceSlotCard } from './dnd/DndProvider';
import type { PlannedPlace, SlotKey } from './types';

type PlaceSlotCardProps = {
  place: PlannedPlace;
  slotKey: SlotKey;
  onRemove: (id: string) => void;
  isGhost?: boolean;
};

function DraggableHandle({ place, slotKey }: { place: PlannedPlace; slotKey: SlotKey }) {
  const { gesture } = useDragCard(place, slotKey);
  return (
    <GestureDetector gesture={gesture}>
      <View style={{ padding: 4 }}>
        <Ionicons name="reorder-three" size={20} color="#a1a1aa" />
      </View>
    </GestureDetector>
  );
}

function PlaceSlotCard({ place, slotKey, onRemove, isGhost = false }: PlaceSlotCardProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 10,
      }}
    >
      {isGhost ? (
        <View style={{ padding: 4 }}>
          <Ionicons name="reorder-three" size={20} color="#a1a1aa" />
        </View>
      ) : (
        <DraggableHandle place={place} slotKey={slotKey} />
      )}

      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: '500', color: '#09090b' }} numberOfLines={1}>
          {place.name}
        </Text>
        <Text style={{ fontSize: 12, color: '#71717a' }} numberOfLines={1}>
          {place.subtitle}
        </Text>
      </View>

      {!isGhost && (
        <Button variant="ghost" size="icon" onPress={() => onRemove(place.id)}>
          <Ionicons name="close" size={16} color="#71717a" />
        </Button>
      )}
    </View>
  );
}

// Register with DndProvider to break the circular import cycle
registerPlaceSlotCard(PlaceSlotCard);

export default PlaceSlotCard;
