import Ionicons from '@expo/vector-icons/Ionicons';
import { useColorScheme, View } from 'react-native';
import { Text } from '@/components/ui/text';

import { Button } from '@/components/ui/button';
import type { Atlas } from '@/types/atlas';

type AtlasOverviewSectionProps = {
  atlas: Atlas;
  placeCount: number;
  onAddPress?: () => void;
  onDeletePress?: () => void;
};

export default function AtlasOverviewSection({ atlas, placeCount, onAddPress, onDeletePress }: AtlasOverviewSectionProps) {
  return (
    <View className="px-4 pt-1">
      <View className="flex-row items-stretch gap-3">
        <View className="h-28 flex-1 justify-between pt-1">
          <View className="gap-0.5">
            <Text className="text-sm leading-5 text-text-tertiary">
              {placeCount} {placeCount === 1 ? 'place' : 'places'}
            </Text>
            <Text className="text-sm text-text-tertiary" numberOfLines={2}>
              {atlas.description || 'No description yet.'}
            </Text>
          </View>

          <View className="flex-row gap-2">
            <ActionButton icon="add" onPress={onAddPress} />
            <ActionButton icon="share-outline" />
            <ActionButton icon="pencil-outline" />
            <ActionButton icon="trash-outline" onPress={onDeletePress} />
            <ActionButton icon="ellipsis-horizontal" />
          </View>
        </View>

        <View className="h-28 w-28 items-center justify-center overflow-hidden rounded-xl bg-muted">
          <Text style={{ fontSize: 40, lineHeight: 48, textAlign: 'center' }}>{atlas.emoji}</Text>
        </View>
      </View>
    </View>
  );
}

function ActionButton({
  icon,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress?: () => void;
}) {
  const colorScheme = useColorScheme();
  const foreground = colorScheme === 'dark' ? '#fafafa' : '#0a0a0a';

  return (
    <Button size="icon" variant="ghost" className="rounded-full bg-background" onPress={onPress}>
      <Ionicons name={icon} size={20} color={foreground} />
    </Button>
  );
}
