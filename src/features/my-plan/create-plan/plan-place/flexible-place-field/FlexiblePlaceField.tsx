import { memo, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useAnimatedStyle } from 'react-native-reanimated';
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view';
import { useDndContext } from '../dnd/DndProvider';
import { slotKeyToString } from '../types';
import AddPlaceField from '../add-place-field/AddPlaceField';
import type { PlannedPlace } from '../types';

type FlexiblePlaceFieldProps = {
  places: PlannedPlace[];
  onAdd: () => void;
  onRemove: (id: string) => void;
};

const FREE_SLOT_KEY = { kind: 'free' as const };
const FREE_SLOT_STR = slotKeyToString(FREE_SLOT_KEY);

const COLOR_BORDER = '#ebebeb';
const COLOR_BORDER_ACTIVE = '#12c170';
const COLOR_BG = '#ffffff';
const COLOR_BG_ACTIVE = '#e9fbf1';

function FlexiblePlaceField({ places, onAdd, onRemove }: FlexiblePlaceFieldProps) {
  const fieldRef = useRef<View>(null);
  const { registerDropZone, unregisterDropZone, activeZoneKey } = useDndContext();

  useEffect(() => {
    registerDropZone(FREE_SLOT_KEY, fieldRef as React.RefObject<any>);
    return () => unregisterDropZone(FREE_SLOT_KEY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    borderColor: activeZoneKey.value === FREE_SLOT_STR ? COLOR_BORDER_ACTIVE : COLOR_BORDER,
    backgroundColor: activeZoneKey.value === FREE_SLOT_STR ? COLOR_BG_ACTIVE : COLOR_BG,
  }));

  return (
    <NativeOnlyAnimatedView
      ref={fieldRef as any}
      style={[
        {
          borderWidth: 1,
          borderRadius: 12,
          paddingTop: 12,
          paddingBottom: 8,
          paddingHorizontal: 8,
          minHeight: 84,
        },
        containerStyle,
      ]}
    >
      <AddPlaceField places={places} onAdd={onAdd} onRemove={onRemove} slotKey={FREE_SLOT_KEY} />
    </NativeOnlyAnimatedView>
  );
}

export default memo(FlexiblePlaceField);
