import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Image, useColorScheme, View } from 'react-native';
import { Text } from '@/components/ui/text';

import { Button } from '@/components/ui/button';
import { PlaceDetail } from '../../../types/place';
import { getOpenStatus } from '../utils/placeHours';

type PlaceOverviewSectionProps = {
  place: PlaceDetail;
};

export default function PlaceOverviewSection({ place }: PlaceOverviewSectionProps) {
  const status = useMemo(() => getOpenStatus(place.schedule), [place.schedule]);

  return (
    <View className="px-4 pt-1">
      <View className="flex-row items-start gap-3">
        <View className="h-28 flex-1 justify-between pt-1">
          <View className="gap-0.5">
            <Text className="text-sm leading-5 text-text-tertiary">{place.address}</Text>
            <Text
              className={`text-sm ${status.isOpen ? 'font-medium text-green-700' : 'font-normal text-text-tertiary'}`}
            >
              {status.statusLine}
            </Text>
          </View>

          <View className="flex-row gap-2">
            <ActionButton icon="navigate-outline" />
            <ActionButton icon="share-outline" />
            <ActionButton icon="heart-outline" />
            <ActionButton icon="ellipsis-horizontal" />
          </View>
        </View>

        <Image
          className="h-28 w-28 rounded-xl bg-muted"
          source={require('../../../../mock-data/image-placeholder/image-placeholder.jpg')}
        />
      </View>
    </View>
  );
}

function ActionButton({
  icon,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const colorScheme = useColorScheme();
  const foreground = colorScheme === 'dark' ? '#fafafa' : '#0a0a0a';

  return (
    <Button size="icon" variant="ghost" className="rounded-full bg-background">
      <Ionicons name={icon} size={20} color={foreground} />
    </Button>
  );
}
