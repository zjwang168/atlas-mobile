import { Dimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

type CreatePlanStep = 'date-location' | 'places';

type CreatePlanProps = {
  onClose: () => void;
  bottomInset?: number;
};

const SCREEN_HEIGHT = Dimensions.get('window').height;
export const CREATE_PLAN_HEIGHT = SCREEN_HEIGHT * 0.7;

export default function CreatePlan({ onClose, bottomInset = 0 }: CreatePlanProps) {
  const [step, setStep] = useState<CreatePlanStep>('date-location');

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
        <View style={{ height: 3, flex: 1, borderRadius: 2, backgroundColor: '#09090b' }} />
        <View
          style={{
            height: 3,
            flex: 1,
            borderRadius: 2,
            backgroundColor: step === 'places' ? '#09090b' : '#e5e5ea',
          }}
        />
      </View>

      {/* Step content */}
      {step === 'date-location' ? (
        <DateLocationStep onNext={() => setStep('places')} />
      ) : (
        <PlacesStep onBack={() => setStep('date-location')} />
      )}
    </View>
  );
}

function DateLocationStep({ onNext }: { onNext: () => void }) {
  return (
    <View style={{ flex: 1, paddingHorizontal: 20 }}>
      <Text className="text-muted-foreground text-sm mb-6">Step 1 — When and where?</Text>

      <Input
        placeholder="Select dates"
        editable={false}
        className="mb-3 h-13"
      />
      <Input
        placeholder="Search destination"
        className="mb-8"
      />

      <Button onPress={onNext} size="lg" className="rounded-xl">
        <Text>Next</Text>
      </Button>
    </View>
  );
}

function PlacesStep({ onBack }: { onBack: () => void }) {
  return (
    <View style={{ flex: 1, paddingHorizontal: 20 }}>
      <Text className="text-muted-foreground text-sm mb-6">Step 2 — Add places</Text>

      <Input
        placeholder="Search for a place"
        className="mb-6"
      />

      <Button variant="secondary" onPress={onBack} size="lg" className="rounded-xl">
        <Text>Back</Text>
      </Button>
    </View>
  );
}
