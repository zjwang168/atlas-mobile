import { Alert, Dimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import PlanDestination from './plan-destination/PlanDestination';
import PlanPlace from './plan-place/PlanPlace';
import type { PlacesState } from './plan-place/types';
import type { SavedPlan } from './savePlan';

type CreatePlanStep = 'destination' | 'places';
export type DateRange = { start: string | null; end: string | null };

export const createPlanCache: {
  location: string;
  range: DateRange;
  places: PlacesState;
} = {
  location: '',
  range: { start: null, end: null },
  places: { free: [], byDate: {} },
};

const STEPS: CreatePlanStep[] = ['destination', 'places'];

type CreatePlanProps = {
  onClose: () => void;
  onPlanCreated?: (plan: SavedPlan) => void;
  reportScrollY: (y: number) => void;
  /** True when mounted as MyPlan's permanently-mounted inline instance rather
      than HomeScreen's overlay-driven one. Forwarded to `PlanPlace` — see its
      `inline` prop doc for why this matters for the `addPlace` overlay's `returnTo`. */
  inline?: boolean;
};

/** Imperative handle so the parent (which now keeps CreatePlan permanently
    mounted for a flicker-free cross-fade) can force a clean wizard each time
    the user re-enters create mode, instead of relying on mount timing. */
export type CreatePlanHandle = {
  reset: () => void;
};

const SCREEN_HEIGHT = Dimensions.get('window').height;

const CreatePlan = forwardRef<CreatePlanHandle, CreatePlanProps>(function CreatePlan(
  { onClose, onPlanCreated, reportScrollY, inline },
  ref,
) {
  const [step, setStep] = useState<CreatePlanStep>('destination');
  const [location, setLocation] = useState('');
  const [range, setRange] = useState<DateRange>({ start: null, end: null });

  const reset = useCallback(() => {
    createPlanCache.location = '';
    createPlanCache.range = { start: null, end: null };
    createPlanCache.places = { free: [], byDate: {} };
    setStep('destination');
    setLocation('');
    setRange({ start: null, end: null });
  }, []);

  useImperativeHandle(ref, () => ({ reset }), [reset]);

  // Covers callers that mount/unmount CreatePlan normally (e.g. HomeScreen's
  // 'createPlan' overlay) — MyPlan's inline flow keeps this permanently
  // mounted and calls `reset` imperatively instead, since mount only fires once.
  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLocationChange = useCallback((value: string) => {
    setLocation(value);
    createPlanCache.location = value;
  }, []);

  const handleRangeChange = useCallback((value: DateRange) => {
    setRange(value);
    createPlanCache.range = value;
  }, []);

  const stepIndex = STEPS.indexOf(step);

  function goNext() {
    if (stepIndex < STEPS.length - 1) setStep(STEPS[stepIndex + 1]);
  }

  function goBack() {
    if (stepIndex > 0) setStep(STEPS[stepIndex - 1]);
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: 16,
        }}
      >
        <Text style={{ fontSize: 22, fontWeight: '600', color: '#09090b' }}>New Plan</Text>
        <Button
          variant="secondary"
          size="icon"
          className="rounded-full w-8 h-8"
          onPress={() =>
            Alert.alert('Discard plan?', 'Your progress will be lost if you leave now.', [
              { text: 'Continue editing', style: 'cancel' },
              { text: 'Discard', style: 'destructive', onPress: onClose },
            ])
          }
        >
          <Ionicons name="close" size={18} color="#3a3a3c" />
        </Button>
      </View>

      {/* Step content */}
      {step === 'destination' && (
        <PlanDestination
          onNext={goNext}
          location={location}
          onLocationChange={handleLocationChange}
          range={range}
          onRangeChange={handleRangeChange}
        />
      )}
      {step === 'places' && (
        <PlanPlace
          onBack={goBack}
          onConfirm={onPlanCreated}
          location={location}
          range={range}
          reportScrollY={reportScrollY}
          inline={inline}
        />
      )}
    </View>
  );
});

export default CreatePlan;
