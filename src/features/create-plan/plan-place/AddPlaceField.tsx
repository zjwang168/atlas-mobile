import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAnimatedStyle } from 'react-native-reanimated';
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import PlaceSlotCard from './PlaceSlotCard';
import { useDndContext } from './dnd/DndProvider';
import type { PlannedPlace, SlotKey } from './types';
import { slotKeyToString } from './types';

type AddPlaceFieldProps = {
  label?: string;
  places: PlannedPlace[];
  slotKey: SlotKey;
  onAdd: () => void;
  onRemove: (id: string) => void;
};

export default function AddPlaceField({ label, places, slotKey, onAdd, onRemove }: AddPlaceFieldProps) {
  const fieldRef = useRef<View>(null);
  const { registerDropZone, unregisterDropZone, activeZoneKey } = useDndContext();
  const myKey = slotKeyToString(slotKey);

  useEffect(() => {
    registerDropZone(slotKey, fieldRef as React.RefObject<any>);
    return () => unregisterDropZone(slotKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myKey]);

  const containerStyle = useAnimatedStyle(() => ({
    borderColor: activeZoneKey.value === myKey ? '#3b82f6' : '#e4e4e7',
  }));

  return (
    <NativeOnlyAnimatedView
      ref={fieldRef as any}
      style={[
        {
          borderWidth: 1,
          borderRadius: 12,
          padding: 12,
          marginBottom: 8,
          minHeight: 60,
        },
        containerStyle,
      ]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: places.length > 0 ? 8 : 0,
        }}
      >
        {label ? (
          <Text
            style={{ fontSize: 14, fontWeight: '500', color: '#3f3f46', textTransform: 'capitalize' }}
          >
            {label}
          </Text>
        ) : (
          <View />
        )}
        <Button variant="ghost" size="icon" onPress={onAdd}>
          <Ionicons name="add" size={20} color="#3f3f46" />
        </Button>
      </View>

      {places.map((place) => (
        <PlaceSlotCard
          key={place.id}
          place={place}
          slotKey={slotKey}
          onRemove={onRemove}
        />
      ))}
    </NativeOnlyAnimatedView>
  );
}
