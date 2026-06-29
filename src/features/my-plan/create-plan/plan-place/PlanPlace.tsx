import { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { createPlanCache, type DateRange } from '../CreatePlan';
import { DndProvider } from './dnd/DndProvider';
import AddPlaceField from './components/AddPlaceField';
import AddPlaceInDate from './components/AddPlaceInDate';
import { useHome } from '../../../home/HomeContext';
import { type PlacesState, type SlotKey, type PlannedPlace, type VisitSlot } from './types';
import { savePlan, type SavedPlan } from '../savePlan';

type PlanPlaceProps = {
  onBack: () => void;
  onConfirm?: (plan: SavedPlan) => void;
  location: string;
  range: DateRange;
  reportScrollY: (y: number) => void;
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

export default function PlanPlace({ onBack, onConfirm, location, range, reportScrollY }: PlanPlaceProps) {
  const { setOverlay } = useHome();
  const insets = useSafeAreaInsets();
  const [places, setPlaces] = useState<PlacesState>(() => createPlanCache.places);

  function updatePlaces(updater: (prev: PlacesState) => PlacesState) {
    setPlaces((prev) => {
      const next = updater(prev);
      createPlanCache.places = next;
      return next;
    });
  }

  function openForFree() {
    setOverlay({
      kind: 'addPlaceToPlan',
      onSelect: (newPlaces) => {
        updatePlaces((prev) => ({ ...prev, free: [...prev.free, ...newPlaces] }));
      },
    });
  }

  function openForSlot(date: string, slot: VisitSlot) {
    setOverlay({
      kind: 'addPlaceToPlan',
      onSelect: (newPlaces) => {
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
      },
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

  async function handleConfirm() {
    const plan = await savePlan({ location, range, places });
    onConfirm?.(plan);
  }

  const summary = formatRangeSummary(location, range);

  return (
    <DndProvider onDrop={handleDrop} reportScrollYToPanel={reportScrollY}>
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 16 }}>
          <Text style={{ fontSize: 14, color: '#71717a', marginBottom: 16 }}>{summary}</Text>

          <AddPlaceField
            label="Flexible"
            places={places.free}
            slotKey={{ kind: 'free' }}
            onAdd={openForFree}
            onRemove={handleRemoveFree}
          />
        </View>

        {range.start && (
          <View style={{ flex: 1, marginTop: 16 }}>
            <AddPlaceInDate
              range={range}
              byDate={places.byDate}
              onAdd={openForSlot}
              onRemove={handleRemoveDated}
            />
          </View>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 8, paddingBottom: insets.bottom + 16 }}>
        <Button variant="secondary" onPress={onBack} size="lg" className="flex-1 rounded-full">
          <Text>Back</Text>
        </Button>
        <Button onPress={handleConfirm} size="lg" className="flex-1 rounded-full">
          <Text>Confirm</Text>
        </Button>
      </View>
    </DndProvider>
  );
}
