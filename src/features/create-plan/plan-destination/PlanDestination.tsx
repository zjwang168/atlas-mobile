import { ScrollView, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import PlanLocation from './plan-location/PlanLocation';
import PlanDate from './plan-date/PlanDate';
import type { DateRange } from '../CreatePlan';

type PlanDestinationProps = {
  onNext: () => void;
  bottomInset?: number;
  location: string;
  onLocationChange: (value: string) => void;
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
};

export default function PlanDestination({
  onNext,
  bottomInset = 0,
  location,
  onLocationChange,
  range,
  onRangeChange,
}: PlanDestinationProps) {
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

      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: bottomInset }}>
        <Button onPress={onNext} size="lg" className="rounded-xl">
          <Text>Next</Text>
        </Button>
      </View>
    </View>
  );
}
