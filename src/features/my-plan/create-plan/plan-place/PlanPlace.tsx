import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { createPlanCache, type DateRange } from '../CreatePlan';
import { DndProvider } from './dnd/DndProvider';
import FlexiblePlaceField from './flexible-place-field/FlexiblePlaceField';
import DateRangeField from './date-range-field/DateRangeField';
import { useHome } from '../../../home/HomeContext';
import { type PlacesState, type SlotKey, type PlannedPlace, type TimeSlot } from './types';
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

  // Stable callback identities so the memoized FlexiblePlaceField/DateRangeField
  // below can actually skip re-rendering when the *other* slice of `places`
  // changes (e.g. dragging into a dated slot no longer re-renders the
  // Flexible section, since neither its `places` nor its callbacks changed).
  const updatePlaces = useCallback((updater: (prev: PlacesState) => PlacesState) => {
    setPlaces((prev) => {
      const next = updater(prev);
      createPlanCache.places = next;
      return next;
    });
  }, []);

  const openForFree = useCallback(() => {
    setOverlay({
      kind: 'addPlaceToPlan',
      onSelect: (newPlaces) => {
        updatePlaces((prev) => ({ ...prev, free: [...prev.free, ...newPlaces] }));
      },
    });
  }, [setOverlay, updatePlaces]);

  const openForDate = useCallback((date: string, timeSlot: TimeSlot) => {
    setOverlay({
      kind: 'addPlaceToPlan',
      onSelect: (newPlaces) => {
        updatePlaces((prev) => {
          const existing = prev.byDate[date] ?? [];
          const tagged = newPlaces.map((p) => ({ ...p, timeSlot }));
          return { ...prev, byDate: { ...prev.byDate, [date]: [...existing, ...tagged] } };
        });
      },
    });
  }, [setOverlay, updatePlaces]);

  const handleRemoveFree = useCallback((id: string) => {
    updatePlaces((prev) => ({ ...prev, free: prev.free.filter((p) => p.id !== id) }));
  }, [updatePlaces]);

  const handleRemoveDated = useCallback((date: string, id: string) => {
    updatePlaces((prev) => ({
      ...prev,
      byDate: {
        ...prev.byDate,
        [date]: (prev.byDate[date] ?? []).filter((p) => p.id !== id),
      },
    }));
  }, [updatePlaces]);

  const handleDrop = useCallback((from: SlotKey, to: SlotKey, place: PlannedPlace) => {
    updatePlaces((prev) => {
      let next = { ...prev };

      // Remove from source
      if (from.kind === 'free') {
        next = { ...next, free: next.free.filter((p) => p.id !== place.id) };
      } else {
        const { date } = from;
        next = {
          ...next,
          byDate: {
            ...next.byDate,
            [date]: (next.byDate[date] ?? []).filter((p) => p.id !== place.id),
          },
        };
      }

      // Insert into target
      if (to.kind === 'free') {
        next = { ...next, free: [...next.free, { ...place, timeSlot: undefined }] };
      } else {
        const { date, timeSlot } = to;
        next = {
          ...next,
          byDate: {
            ...next.byDate,
            [date]: [...(next.byDate[date] ?? []), { ...place, timeSlot }],
          },
        };
      }

      return next;
    });
  }, [updatePlaces]);

  const handleConfirm = useCallback(async () => {
    const plan = await savePlan({ location, range, places });
    onConfirm?.(plan);
  }, [location, range, places, onConfirm]);

  const summary = formatRangeSummary(location, range);

  return (
    <DndProvider onDrop={handleDrop} reportScrollYToPanel={reportScrollY}>
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 16 }}>
          <Text style={{ fontSize: 14, color: '#71717a', marginBottom: 12 }}>{summary}</Text>

          <Text style={{ fontSize: 13, fontWeight: '500', color: '#71717a', marginBottom: 8 }}>
            Flexible
          </Text>
          <FlexiblePlaceField
            places={places.free}
            onAdd={openForFree}
            onRemove={handleRemoveFree}
          />
        </View>

        {range.start && (
          <View style={{ flex: 1, marginTop: 16 }}>
            <DateRangeField
              range={range}
              byDate={places.byDate}
              onAdd={openForDate}
              onRemove={handleRemoveDated}
            />
          </View>
        )}
      </View>

      <View
        style={{
          flexDirection: 'row',
          gap: 12,
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: insets.bottom + 16,
        }}
      >
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
