import { Gesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useDndContext } from './DndProvider';
import type { PlannedPlace, SlotKey } from '../types';

export function useDragCard(place: PlannedPlace, slotKey: SlotKey) {
  const {
    isDragging,
    activeZoneKey,
    ghostY,
    dropZonesSnap,
    containerScreenY,
    startDrag,
    finishDrag,
  } = useDndContext();

  // activateAfterLongPress waits 400ms before the pan activates, which:
  // 1. Tolerates slight finger movement during the hold (unlike Simultaneous(LongPress, Pan))
  // 2. Properly defers ScrollView scroll until the drag activates
  const pan = Gesture.Pan()
    .activateAfterLongPress(400)
    .onStart((e) => {
      'worklet';
      isDragging.value = true;
      ghostY.value = e.absoluteY - containerScreenY.value;
      runOnJS(startDrag)(place, slotKey);
    })
    .onChange((e) => {
      'worklet';
      if (!isDragging.value) return;
      ghostY.value = e.absoluteY - containerScreenY.value;

      let hitKey = '';
      const zones = dropZonesSnap.value;
      for (let i = 0; i < zones.length; i++) {
        const zone = zones[i];
        if (e.absoluteY >= zone.y && e.absoluteY <= zone.y + zone.height) {
          hitKey = zone.key;
          break;
        }
      }
      activeZoneKey.value = hitKey;
    })
    .onEnd(() => {
      'worklet';
      const hitKey = activeZoneKey.value || null;
      isDragging.value = false;
      activeZoneKey.value = '';
      runOnJS(finishDrag)(hitKey);
    })
    .onFinalize(() => {
      'worklet';
      if (isDragging.value) {
        isDragging.value = false;
        activeZoneKey.value = '';
        runOnJS(finishDrag)(null);
      }
    });

  return { gesture: pan };
}
