import { memo } from 'react';
import { Image, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { GestureDetector } from 'react-native-gesture-handler';
import { PlaceCover } from '@/components/place-cover/PlaceCover';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { useDragCard } from '../dnd/useDragCard';
import { registerDragGhostCard } from '../dnd/DndProvider';
import type { PlannedPlace, SlotKey } from '../types';

// Figma Customized_01 shadow — must be on a separate wrapper from overflow:hidden
const IMAGE_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.11,
  shadowRadius: 5,
  elevation: 3,
};

type FlexiblePlaceCardProps = {
  place: PlannedPlace;
  slotKey?: SlotKey;
  onRemove: (id: string) => void;
  isGhost?: boolean;
};

function CardImage({ imageUrl, category }: { imageUrl?: string; category?: string }) {
  return (
    // Shadow wrapper: no overflow so the shadow isn't clipped
    <View style={[{ width: 56, height: 56, borderRadius: 16 }, IMAGE_SHADOW]}>
      {/* Clip wrapper: overflow:hidden for the image border-radius */}
      <View style={{ width: 56, height: 56, borderRadius: 16, overflow: 'hidden' }} className="bg-muted">
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={{ width: 56, height: 56 }} resizeMode="cover" />
        ) : (
          <PlaceCover category={category} iconSize={22} />
        )}
      </View>
    </View>
  );
}

function DraggableCard({ place, slotKey, onRemove }: { place: PlannedPlace; slotKey: SlotKey; onRemove: (id: string) => void }) {
  const { gesture } = useDragCard(place, slotKey);

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width: 64, alignItems: 'center' }}>
        <CardImage imageUrl={place.imageUrl} category={place.category} />
        <Text
          numberOfLines={1}
          className="text-text-secondary"
          style={{ fontSize: 11, marginTop: 5, textAlign: 'center', width: 64, fontWeight: '500' }}
        >
          {place.name}
        </Text>
        <Button
          variant="ghost"
          size="icon"
          onPress={() => onRemove(place.id)}
          style={{
            position: 'absolute',
            top: -5,
            right: -2,
            width: 18,
            height: 18,
            borderRadius: 9,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          className="bg-background border border-border"
        >
          <Ionicons name="close" size={10} color="#b0b0b0" />
        </Button>
      </View>
    </GestureDetector>
  );
}

function FlexiblePlaceCard({ place, slotKey = { kind: 'free' }, onRemove, isGhost = false }: FlexiblePlaceCardProps) {
  if (isGhost) {
    return (
      <View style={{ width: 64, alignItems: 'center', opacity: 0.9 }}>
        <CardImage imageUrl={place.imageUrl} category={place.category} />
        <Text
          numberOfLines={1}
          className="text-text-secondary"
          style={{ fontSize: 11, marginTop: 5, textAlign: 'center', width: 64, fontWeight: '500' }}
        >
          {place.name}
        </Text>
      </View>
    );
  }

  return <DraggableCard place={place} slotKey={slotKey} onRemove={onRemove} />;
}

const MemoizedFlexiblePlaceCard = memo(FlexiblePlaceCard);

// Register with DndProvider to break the circular import cycle
registerDragGhostCard(MemoizedFlexiblePlaceCard);

export default MemoizedFlexiblePlaceCard;
