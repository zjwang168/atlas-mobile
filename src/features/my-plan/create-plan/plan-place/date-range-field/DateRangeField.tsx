import { useCallback, useMemo, useState } from 'react';
import { Dimensions, FlatList, View } from 'react-native';
import { useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import { useDndContext } from '../dnd/DndProvider';
import { enumerateDates } from '../utils';
import type { PlannedPlace, TimeSlot } from '../types';
import type { DateRange } from '../../CreatePlan';
import DateColumn from './DateColumn';

const COLUMN_WIDTH = Dimensions.get('window').width * 0.78;
const COLUMN_GAP = 12;
const COLUMN_FULL_WIDTH = COLUMN_WIDTH + COLUMN_GAP;

export type DateRangeFieldProps = {
  range: DateRange;
  byDate: Record<string, PlannedPlace[]>;
  onAdd: (date: string, timeSlot: TimeSlot) => void;
  onRemove: (date: string, id: string) => void;
};

export default function DateRangeField({ range, byDate, onAdd, onRemove }: DateRangeFieldProps) {
  const dates = useMemo(() => enumerateDates(range), [range.start, range.end]);
  const { isDragging } = useDndContext();

  const [scrollLocked, setScrollLocked] = useState(false);
  useAnimatedReaction(
    () => isDragging.value,
    (dragging: boolean) => runOnJS(setScrollLocked)(dragging),
  );

  const renderDateColumn = useCallback(
    ({ item: date }: { item: string }) => (
      <View style={{ width: COLUMN_WIDTH, flex: 1 }}>
        <DateColumn
          date={date}
          places={byDate[date] ?? []}
          onAdd={(slot) => onAdd(date, slot)}
          onRemove={(id) => onRemove(date, id)}
        />
      </View>
    ),
    [byDate, onAdd, onRemove],
  );

  if (dates.length === 0) return null;

  return (
    <FlatList
      horizontal
      data={dates}
      renderItem={renderDateColumn}
      keyExtractor={(date) => date}
      style={{ flex: 1 }}
      scrollEnabled={!scrollLocked}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16 }}
      ItemSeparatorComponent={() => <View style={{ width: COLUMN_GAP }} />}
      getItemLayout={(_, index) => ({
        length: COLUMN_FULL_WIDTH,
        offset: COLUMN_FULL_WIDTH * index,
        index,
      })}
      initialNumToRender={2}
      maxToRenderPerBatch={2}
      windowSize={3}
      removeClippedSubviews
    />
  );
}
