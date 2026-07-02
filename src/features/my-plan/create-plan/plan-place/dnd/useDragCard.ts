import { Gesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useDndContext } from './DndProvider';
import type { PlannedPlace, SlotKey } from '../types';

export function useDragCard(place: PlannedPlace, slotKey: SlotKey) {
  const {
    isDragging,
    activeZoneKey,
    ghostX,
    ghostY,
    dragSourceKind,
    dropZonesSnap,
    containerScreenY,
    containerScreenX,
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
      dragSourceKind.value = slotKey.kind === 'free' ? 'free' : 'dated';
      ghostX.value = e.absoluteX - containerScreenX.value;
      ghostY.value = e.absoluteY - containerScreenY.value;
      runOnJS(startDrag)(place, slotKey);
    })
    .onChange((e) => {
      'worklet';
      if (!isDragging.value) return;
      ghostX.value = e.absoluteX - containerScreenX.value;
      ghostY.value = e.absoluteY - containerScreenY.value;

      const absX = e.absoluteX;
      const absY = e.absoluteY;
      let hitKey = '';
      const zones = dropZonesSnap.value;
      for (let i = 0; i < zones.length; i++) {
        const zone = zones[i];
        if (
          absX >= zone.x && absX <= zone.x + zone.width &&
          absY >= zone.y && absY <= zone.y + zone.height
        ) {
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
