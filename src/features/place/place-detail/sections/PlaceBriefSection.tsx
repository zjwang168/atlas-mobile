import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { PlaceDetail } from '../../../../types/place';
import { getOpenStatus } from '../../utils/placeHours';

type PlaceBriefSectionProps = {
  place: PlaceDetail;
};

export default function PlaceBriefSection({ place }: PlaceBriefSectionProps) {
  const status = useMemo(() => getOpenStatus(place.schedule), [place.schedule]);

  return (
    <View className="px-4.5 pt-1">
      <View className="flex-row items-start gap-3">
        <View className="h-28 flex-1 justify-between pt-1">
          <View className="gap-0.5">
            <Text className="text-sm leading-5 text-gray-500">{place.address}</Text>
            <Text
              className={`text-sm font-semibold ${status.isOpen ? 'text-green-700' : 'text-gray-500'}`}
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
          className="h-28 w-28 rounded-xl bg-gray-200"
          source={require('../../../../data/image-placeholder/image-placeholder.jpg')}
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
  return (
    <Pressable
      className="h-10 w-10 items-center justify-center rounded-full bg-gray-100"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Ionicons name={icon} size={20} color="#374151" />
    </Pressable>
  );
}
