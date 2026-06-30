import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAnimatedReaction, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view';
import { Text } from '@/components/ui/text';
import { useDndContext } from '../dnd/DndProvider';
import AddPlaceField from '../add-place-field/AddPlaceField';
import { type PlannedPlace, type TimeSlot, type SlotKey, TIME_SLOTS, TIME_SLOT_LABELS, slotKeyToString } from '../types';

const COMPACT_THRESHOLD = 160;

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatColumnHeader(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return {
    month: `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`,
    day: DAY_SHORT[d.getDay()],
  };
}

const COLOR_BORDER = '#ebebeb';
const COLOR_BG_ACTIVE = '#e9fbf1';

type SlotSectionProps = {
  date: string;
  timeSlot: TimeSlot;
  places: PlannedPlace[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  scrollable?: boolean;
};

function SlotSection({ date, timeSlot, places, onAdd, onRemove, scrollable = true }: SlotSectionProps) {
  const ref = useRef<View>(null);
  const { registerDropZone, unregisterDropZone, activeZoneKey } = useDndContext();
  const slotKey: SlotKey = { kind: 'dated', date, timeSlot };
  const slotKeyStr = slotKeyToString(slotKey);

  useEffect(() => {
    registerDropZone(slotKey, ref as React.RefObject<any>);
    return () => unregisterDropZone(slotKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, timeSlot]);

  const bgStyle = useAnimatedStyle(() => ({
    backgroundColor: activeZoneKey.value === slotKeyStr ? COLOR_BG_ACTIVE : 'transparent',
  }));

  // In vertical mode: fill the full column width so cards scroll inside.
  // In horizontal mode: hug content; the outer row ScrollView handles scrolling.
  const containerStyle = scrollable ? { width: '100%' as const } : undefined;

  return (
    <NativeOnlyAnimatedView ref={ref as any} style={[containerStyle, { padding: 8 }, bgStyle]}>
      <Text
        className="text-text-secondary"
        style={{ fontSize: 14, fontWeight: '600', marginBottom: 8, letterSpacing: -0.14 }}
      >
        {TIME_SLOT_LABELS[timeSlot]}
      </Text>
      <AddPlaceField
        places={places}
        onAdd={onAdd}
        onRemove={onRemove}
        slotKey={slotKey}
        scrollable={scrollable}
      />
    </NativeOnlyAnimatedView>
  );
}

function VerticalDivider() {
  return (
    <View style={{ alignSelf: 'stretch', paddingVertical: 8 }}>
      <View style={{ width: 1, flex: 1, backgroundColor: COLOR_BORDER }} />
    </View>
  );
}

function HorizontalDivider() {
  return <View style={{ height: 1, marginHorizontal: 8, backgroundColor: COLOR_BORDER }} />;
}

export type DateColumnProps = {
  date: string;
  places: PlannedPlace[];
  onAdd: (timeSlot: TimeSlot) => void;
  onRemove: (id: string) => void;
};

export default function DateColumn({ date, places, onAdd, onRemove }: DateColumnProps) {
  const [columnHeight, setColumnHeight] = useState<number | null>(null);
  const { month, day } = formatColumnHeader(date);
  const isCompact = columnHeight !== null && columnHeight < COMPACT_THRESHOLD;

  const { isDragging } = useDndContext();
  const [scrollLocked, setScrollLocked] = useState(false);
  useAnimatedReaction(
    () => isDragging.value,
    (dragging: boolean) => runOnJS(setScrollLocked)(dragging),
  );

  function slotPlaces(slot: TimeSlot) {
    return places.filter((p) => p.timeSlot === slot);
  }

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setColumnHeight(e.nativeEvent.layout.height)}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5, marginBottom: 6 }}>
        <Text className="text-text-primary" style={{ fontSize: 15, fontWeight: '600', letterSpacing: -0.15 }}>
          {month}
        </Text>
        <Text className="text-text-secondary" style={{ fontSize: 12 }}>
          {day}
        </Text>
      </View>

      {/* Slots container — no render until layout measured */}
      <View
        style={{ ...(isCompact ? undefined : { flex: 1 }), borderWidth: 1, borderColor: COLOR_BORDER, borderRadius: 8, overflow: 'hidden' }}
      >
        {columnHeight !== null && (
          isCompact ? (
            // Horizontal layout: entire row scrolls; each slot hugs its content width
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollEnabled={!scrollLocked}
              contentContainerStyle={{ flexDirection: 'row', alignItems: 'flex-start' }}
            >
              {TIME_SLOTS.map((slot, i) => (
                <View key={slot} style={{ flexDirection: 'row' }}>
                  {i > 0 && <VerticalDivider />}
                  <SlotSection
                    date={date}
                    timeSlot={slot}
                    places={slotPlaces(slot)}
                    onAdd={() => onAdd(slot)}
                    onRemove={onRemove}
                    scrollable={false}
                  />
                </View>
              ))}
            </ScrollView>
          ) : (
            // Vertical layout: each slot fills full width; cards scroll inside
            <ScrollView
              showsVerticalScrollIndicator={false}
              scrollEnabled={!scrollLocked}
              style={{ flex: 1 }}
            >
              {TIME_SLOTS.map((slot, i) => (
                <View key={slot}>
                  {i > 0 && <HorizontalDivider />}
                  <SlotSection
                    date={date}
                    timeSlot={slot}
                    places={slotPlaces(slot)}
                    onAdd={() => onAdd(slot)}
                    onRemove={onRemove}
                    scrollable
                  />
                </View>
              ))}
            </ScrollView>
          )
        )}
      </View>
    </View>
  );
}
