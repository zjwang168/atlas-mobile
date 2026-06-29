import { useState } from 'react';
import { Dimensions, ScrollView, View } from 'react-native';
import { useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import { Text } from '@/components/ui/text';
import AddPlaceField from './AddPlaceField';
import { useDndContext } from '../dnd/DndProvider';
import { enumerateDates } from '../utils';
import { VISIT_SLOTS, type VisitSlot, type PlannedPlace } from '../types';
import type { DateRange } from '../../CreatePlan';

const COLUMN_WIDTH = Dimensions.get('window').width * 0.78;

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatColumnHeader(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return {
    month: `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`,
    day: DAY_SHORT[d.getDay()],
  };
}

type AddPlaceInDateProps = {
  range: DateRange;
  byDate: Record<string, Record<VisitSlot, PlannedPlace[]>>;
  onAdd: (date: string, slot: VisitSlot) => void;
  onRemove: (date: string, slot: VisitSlot, id: string) => void;
};

export default function AddPlaceInDate({ range, byDate, onAdd, onRemove }: AddPlaceInDateProps) {
  const dates = enumerateDates(range);
  const { isDragging } = useDndContext();

  const [scrollLocked, setScrollLocked] = useState(false);
  useAnimatedReaction(
    () => isDragging.value,
    (dragging: boolean) => runOnJS(setScrollLocked)(dragging),
  );

  if (dates.length === 0) return null;

  return (
    <ScrollView
      horizontal
      style={{ flex: 1 }}
      showsHorizontalScrollIndicator={false}
      scrollEnabled={!scrollLocked}
      contentContainerStyle={{ gap: 12, paddingHorizontal: 16 }}
    >
      {dates.map((date) => {
        const { month, day } = formatColumnHeader(date);
        const slots = (byDate[date] ?? {}) as Record<VisitSlot, PlannedPlace[]>;
        return (
          <View key={date} style={{ width: COLUMN_WIDTH, flex: 1 }}>
            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#09090b' }}>{month}</Text>
              <Text style={{ fontSize: 13, color: '#71717a' }}>{day}</Text>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              scrollEnabled={!scrollLocked}
              style={{ flex: 1 }}
            >
              {VISIT_SLOTS.map((slot) => (
                <AddPlaceField
                  key={slot}
                  label={slot}
                  places={slots[slot] ?? []}
                  slotKey={{ kind: 'dated', date, slot }}
                  onAdd={() => onAdd(date, slot)}
                  onRemove={(id) => onRemove(date, slot, id)}
                />
              ))}
            </ScrollView>
          </View>
        );
      })}
    </ScrollView>
  );
}
