import { memo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import { useDndContext } from '../dnd/DndProvider';
import FlexiblePlaceCard from '../flexible-place-field/FlexiblePlaceCard';
import type { PlannedPlace, SlotKey } from '../types';

const CARD_CONTENT_STYLE = { gap: 10, alignItems: 'flex-start' as const, paddingHorizontal: 2, paddingVertical: 2 };

function AddButton({ onAdd }: { onAdd: () => void }) {
  return (
    <View
      style={{
        width: 56,
        height: 56,
        borderRadius: 16,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: '#d1d1d1',
        alignItems: 'center',
        justifyContent: 'center',
        // explicitly flat — no shadow, no elevation
        backgroundColor: 'transparent',
        shadowOpacity: 0,
        elevation: 0,
      }}
    >
      <Pressable onPress={onAdd} style={{ width: 56, height: 56, position: 'absolute', borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="add" size={22} color="#b0b0b0" />
      </Pressable>
    </View>
  );
}

type AddPlaceFieldProps = {
  places: PlannedPlace[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  slotKey: SlotKey;
  // scrollable=true (default): cards scroll inside a fixed-width container (vertical slot)
  // scrollable=false: cards are rendered in a plain row; the outer container scrolls
  scrollable?: boolean;
};

function AddPlaceField({ places, onAdd, onRemove, slotKey, scrollable = true }: AddPlaceFieldProps) {
  const { isDragging } = useDndContext();
  const [scrollLocked, setScrollLocked] = useState(false);

  useAnimatedReaction(
    () => isDragging.value,
    (dragging: boolean) => runOnJS(setScrollLocked)(dragging),
  );

  const cards = places.map((place) => (
    <FlexiblePlaceCard key={place.id} place={place} slotKey={slotKey} onRemove={onRemove} />
  ));

  if (!scrollable) {
    return (
      <View style={[{ flexDirection: 'row' }, CARD_CONTENT_STYLE]}>
        {cards}
        <AddButton onAdd={onAdd} />
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      scrollEnabled={!scrollLocked}
      contentContainerStyle={CARD_CONTENT_STYLE}
    >
      {cards}
      <AddButton onAdd={onAdd} />
    </ScrollView>
  );
}

export default memo(AddPlaceField);
