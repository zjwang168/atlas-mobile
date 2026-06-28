import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import PlanLocation from './plan-location/PlanLocation';
import PlanDate from './plan-date/PlanDate';

type DateRange = { start: string | null; end: string | null };

type PlanDestinationProps = {
  onNext: () => void;
  bottomInset?: number;
};

export default function PlanDestination({ onNext, bottomInset = 0 }: PlanDestinationProps) {
  const [range, setRange] = useState<DateRange>({ start: null, end: null });

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <PlanLocation />
        <PlanDate range={range} onRangeChange={setRange} />
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: bottomInset }}>
        <Button onPress={onNext} size="lg" className="rounded-xl">
          <Text>Next</Text>
        </Button>
      </View>
    </View>
  );
}
