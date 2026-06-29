import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import PlanLocation from './plan-location/PlanLocation';
import PlanDate from './plan-date/PlanDate';
import type { DateRange } from '../CreatePlan';

type PlanDestinationProps = {
  onNext: () => void;
  location: string;
  onLocationChange: (value: string) => void;
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
};

export default function PlanDestination({
  onNext,
  location,
  onLocationChange,
  range,
  onRangeChange,
}: PlanDestinationProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <PlanLocation value={location} onChangeText={onLocationChange} />
        <PlanDate range={range} onRangeChange={onRangeChange} />
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: insets.bottom + 16 }}>
        <Button onPress={onNext} size="lg" className="rounded-full w-full">
          <Text>Next</Text>
        </Button>
      </View>
    </View>
  );
}
