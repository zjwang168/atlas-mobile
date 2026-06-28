import { Dimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
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

type CreatePlanStep = 'destination' | 'places';

const STEPS: CreatePlanStep[] = ['destination', 'places'];

type CreatePlanProps = {
  onClose: () => void;
  bottomInset?: number;
};

const SCREEN_HEIGHT = Dimensions.get('window').height;
export const CREATE_PLAN_HEIGHT = SCREEN_HEIGHT * 0.7;

export default function CreatePlan({ onClose, bottomInset = 0 }: CreatePlanProps) {
  const [step, setStep] = useState<CreatePlanStep>('destination');

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

      {/* Step indicator */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 6, marginBottom: 24 }}>
        {STEPS.map((s, i) => (
          <View
            key={s}
            style={{
              height: 3,
              flex: 1,
              borderRadius: 2,
              backgroundColor: i <= stepIndex ? '#09090b' : '#e5e5ea',
            }}
          />
        ))}
      </View>

      {/* Step content */}
      {step === 'destination' && <PlanDestination onNext={goNext} bottomInset={bottomInset} />}
      {step === 'places' && <PlanPlace onBack={goBack} />}
    </View>
  );
}
