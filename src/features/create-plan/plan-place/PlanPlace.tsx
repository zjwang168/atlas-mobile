import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';

type PlanPlaceProps = {
  onBack: () => void;
};

export default function PlanPlace({ onBack }: PlanPlaceProps) {
  return (
    <View style={{ flex: 1, paddingHorizontal: 20 }}>
      <Input placeholder="Search for a place" className="mb-8" />

      <Button variant="secondary" onPress={onBack} size="lg" className="rounded-xl">
        <Text>Back</Text>
      </Button>
    </View>
  );
}
