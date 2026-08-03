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
      <View className="flex-row items-stretch gap-3">
        <View className="h-28 flex-1 justify-between pt-1">
          <View className="gap-0.5">
            {/* Spacing here comes from the parent's `gap-0.5`, which emits
                nothing for a single child — so dropping this element drops its
                gap with it. */}
            {place.address ? (
              <Text className="text-sm leading-5 text-text-tertiary">{place.address}</Text>
            ) : null}
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

        <View className="h-28 w-28 overflow-hidden rounded-xl bg-muted">
          {place.thumbnailUrl ? (
            <Image
              source={{ uri: place.thumbnailUrl }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          ) : null}
        </View>
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
