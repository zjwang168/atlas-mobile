import { Dimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import PlanDestination from './plan-destination/PlanDestination';
import PlanPlace from './plan-place/PlanPlace';
import type { PlacesState, PlannedPlace } from './plan-place/types';

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
  bottomInset?: number;
  reportScrollY: (y: number) => void;
  onOpenAddPlace: (onSelect: (places: PlannedPlace[]) => void) => void;
};

const SCREEN_HEIGHT = Dimensions.get('window').height;
export const CREATE_PLAN_HEIGHT = SCREEN_HEIGHT * 0.7;

export default function CreatePlan({ onClose, bottomInset = 0, reportScrollY, onOpenAddPlace }: CreatePlanProps) {
  const [step, setStep] = useState<CreatePlanStep>('destination');
  const [location, setLocation] = useState('');
  const [range, setRange] = useState<DateRange>({ start: null, end: null });

  useEffect(() => {
    createPlanCache.location = '';
    createPlanCache.range = { start: null, end: null };
    createPlanCache.places = { free: [], byDate: {} };
  }, []);

  function handleLocationChange(value: string) {
    setLocation(value);
    createPlanCache.location = value;
  }

  function handleRangeChange(value: DateRange) {
    setRange(value);
    createPlanCache.range = value;
  }

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
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="secondary" size="icon" className="rounded-full w-8 h-8">
              <Ionicons name="close" size={18} color="#3a3a3c" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard plan?</AlertDialogTitle>
              <AlertDialogDescription>
                Your progress will be lost if you leave now.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                <Text>Continue editing</Text>
              </AlertDialogCancel>
              <AlertDialogAction onPress={onClose}>
                <Text>Discard</Text>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </View>

      {/* Step content */}
      {step === 'destination' && (
        <PlanDestination
          onNext={goNext}
          bottomInset={bottomInset}
          location={location}
          onLocationChange={handleLocationChange}
          range={range}
          onRangeChange={handleRangeChange}
        />
      )}
      {step === 'places' && (
        <PlanPlace
          onBack={goBack}
          location={location}
          range={range}
          reportScrollY={reportScrollY}
          onOpenAddPlace={onOpenAddPlace}
        />
      )}
    </View>
  );
}
