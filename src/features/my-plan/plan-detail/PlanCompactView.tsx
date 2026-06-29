import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, useColorScheme, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import type { SavedPlan } from '../create-plan/savePlan';

type PlanCompactViewProps = {
  plan: SavedPlan;
  onDismiss: () => void;
  onExpand: () => void;
};

export default function PlanCompactView({ plan, onDismiss, onExpand }: PlanCompactViewProps) {
  const colorScheme = useColorScheme();
  const foreground = colorScheme === 'dark' ? '#fafafa' : '#18181B';

  return (
    <Pressable
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 }}
      onPress={onExpand}
    >
      <View className="flex-1">
        <Text numberOfLines={1} className="text-lg font-semibold text-foreground">
          {plan.title}
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-xs text-text-tertiary">
          {plan.location}
        </Text>
      </View>

      <View className="flex-row items-center gap-1">
        <Button
          accessibilityLabel="Share plan"
          onPress={(e) => e.stopPropagation()}
          size="icon"
          variant="ghost"
          className="rounded-full bg-background"
        >
          <Ionicons name="share-outline" size={19} color={foreground} />
        </Button>

        <Button
          accessibilityLabel="Dismiss plan details"
          onPress={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          size="icon"
          variant="ghost"
          className="rounded-full bg-background"
        >
          <Ionicons name="close" size={20} color={foreground} />
        </Button>
      </View>
    </Pressable>
  );
}
