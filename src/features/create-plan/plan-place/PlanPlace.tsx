import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { createPlanCache, type DateRange } from '../CreatePlan';
import { DndProvider } from './dnd/DndProvider';
import AddPlaceField from './AddPlaceField';
import AddPlaceInDate from './AddPlaceInDate';
import { type PlacesState, type SlotKey, type PlannedPlace, type VisitSlot } from './types';

type PlanPlaceProps = {
  onBack: () => void;
  location: string;
  range: DateRange;
  reportScrollY: (y: number) => void;
  onOpenAddPlace: (onSelect: (places: PlannedPlace[]) => void) => void;
};

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatRangeSummary(location: string, range: DateRange): string {
  if (!range.start) return location || 'New Plan';
  const start = new Date(range.start + 'T00:00:00');
  const startStr = `${MONTH_SHORT[start.getMonth()]} ${start.getDate()}`;
  if (!range.end || range.end === range.start) {
    return location ? `${location} · ${startStr}` : startStr;
  }
  const end = new Date(range.end + 'T00:00:00');
  const endStr = `${MONTH_SHORT[end.getMonth()]} ${end.getDate()}`;
  return location ? `${location} · ${startStr} – ${endStr}` : `${startStr} – ${endStr}`;
}

export default function PlanPlace({ onBack, location, range, reportScrollY, onOpenAddPlace }: PlanPlaceProps) {
  const [places, setPlaces] = useState<PlacesState>(() => createPlanCache.places);

  function updatePlaces(updater: (prev: PlacesState) => PlacesState) {
    setPlaces((prev) => {
      const next = updater(prev);
      createPlanCache.places = next;
      return next;
    });
  }

  function openForFree() {
    onOpenAddPlace((newPlaces) => {
      updatePlaces((prev) => ({ ...prev, free: [...prev.free, ...newPlaces] }));
    });
  }

  function openForSlot(date: string, slot: VisitSlot) {
    onOpenAddPlace((newPlaces) => {
      updatePlaces((prev) => {
        const prevByDate = (prev.byDate[date] ?? {}) as Record<VisitSlot, PlannedPlace[]>;
        const prevSlot = prevByDate[slot] ?? [];
        return {
          ...prev,
          byDate: {
            ...prev.byDate,
            [date]: { ...prevByDate, [slot]: [...prevSlot, ...newPlaces] },
          },
        };
      });
    });
  }

  function handleRemoveFree(id: string) {
    updatePlaces((prev) => ({ ...prev, free: prev.free.filter((p) => p.id !== id) }));
  }

  function handleRemoveDated(date: string, slot: VisitSlot, id: string) {
    updatePlaces((prev) => {
      const prevByDate = (prev.byDate[date] ?? {}) as Record<VisitSlot, PlannedPlace[]>;
      const filtered = (prevByDate[slot] ?? []).filter((p) => p.id !== id);
      return {
        ...prev,
        byDate: { ...prev.byDate, [date]: { ...prevByDate, [slot]: filtered } },
      };
    });
  }

  function handleDrop(from: SlotKey, to: SlotKey, place: PlannedPlace, targetIndex?: number) {
    updatePlaces((prev) => {
      let next = { ...prev };

      // Remove from source
      if (from.kind === 'free') {
        next = { ...next, free: next.free.filter((p) => p.id !== place.id) };
      } else {
        const { date, slot } = from;
        const prevByDate = (next.byDate[date] ?? {}) as Record<VisitSlot, PlannedPlace[]>;
        next = {
          ...next,
          byDate: {
            ...next.byDate,
            [date]: {
              ...prevByDate,
              [slot]: (prevByDate[slot] ?? []).filter((p) => p.id !== place.id),
            },
          },
        };
      }

      // Insert into target
      if (to.kind === 'free') {
        const arr = [...next.free];
        arr.splice(targetIndex ?? arr.length, 0, place);
        next = { ...next, free: arr };
      } else {
        const { date, slot } = to;
        const prevByDate = (next.byDate[date] ?? {}) as Record<VisitSlot, PlannedPlace[]>;
        const arr = [...(prevByDate[slot] ?? [])];
        arr.splice(targetIndex ?? arr.length, 0, place);
        next = {
          ...next,
          byDate: { ...next.byDate, [date]: { ...prevByDate, [slot]: arr } },
        };
      }

      return next;
    });
  }

  const summary = formatRangeSummary(location, range);

  return (
    <DndProvider onDrop={handleDrop} reportScrollYToPanel={reportScrollY}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => reportScrollY(e.nativeEvent.contentOffset.y)}
      >
        <Text style={{ fontSize: 14, color: '#71717a', marginBottom: 16 }}>{summary}</Text>

        <AddPlaceField
          label="Flexible"
          places={places.free}
          slotKey={{ kind: 'free' }}
          onAdd={openForFree}
          onRemove={handleRemoveFree}
        />

        {range.start && (
          <View style={{ marginTop: 16 }}>
            <AddPlaceInDate
              range={range}
              byDate={places.byDate}
              onAdd={openForSlot}
              onRemove={handleRemoveDated}
            />
          </View>
        )}

        <View style={{ marginTop: 24 }}>
          <Button variant="secondary" onPress={onBack} size="lg" className="rounded-xl">
            <Text>Back</Text>
          </Button>
        </View>
      </ScrollView>
    </DndProvider>
  );
}
