import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, useColorScheme, View } from 'react-native';

import { PlaceDetail } from '../../types/place';

type PlaceCompactViewProps = {
  place: PlaceDetail;
  onDismiss: () => void;
  onExpand: () => void;
  onLayout: (height: number) => void;
};

export default function PlaceCompactView({
  place,
  onDismiss,
  onExpand,
  onLayout,
}: PlaceCompactViewProps) {
  const colorScheme = useColorScheme();
  const foreground = colorScheme === 'dark' ? '#fafafa' : '#18181B';

  return (
    <Pressable
      className="flex-row items-center gap-3 px-4 pb-6"
      onPress={onExpand}
      onLayout={(e) => onLayout(e.nativeEvent.layout.height)}
    >
      <View className="flex-1">
        <Text numberOfLines={1} className="text-lg font-semibold text-foreground">
          {place.name}
        </Text>
        <Text numberOfLines={1} className="mt-0.5 text-xs text-label">
          {place.address}
        </Text>
      </View>

      <View className="flex-row items-center gap-1">
        <Pressable
          accessibilityLabel="Share place"
          onPress={(e) => e.stopPropagation()}
          className="h-10 w-10 items-center justify-center rounded-full bg-background"
          style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
        >
          <Ionicons name="share-outline" size={19} color={foreground} />
        </Pressable>

        <Pressable
          accessibilityLabel="Open in maps"
          onPress={(e) => e.stopPropagation()}
          className="h-10 w-10 items-center justify-center rounded-full bg-background"
          style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
        >
          <Ionicons name="map-outline" size={19} color={foreground} />
        </Pressable>

        <Pressable
          accessibilityLabel="Dismiss place details"
          onPress={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="h-10 w-10 items-center justify-center rounded-full bg-background"
          style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
        >
          <Ionicons name="close" size={20} color={foreground} />
        </Pressable>
      </View>
    </Pressable>
  );
}
