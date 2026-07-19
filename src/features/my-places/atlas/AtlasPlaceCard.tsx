import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import { memo } from 'react';
import { Image, View } from 'react-native';

type AtlasPlaceCardProps = {
  name: string;
  thumbnailUrl?: string | null;
};

const SIZE = 96;

/** Memoized — rendered inside a horizontal row per atlas; keeps unrelated
    section re-renders from forcing every card to re-render. */
export const AtlasPlaceCard = memo(function AtlasPlaceCard({ name, thumbnailUrl }: AtlasPlaceCardProps) {
  return (
    <View style={{ width: SIZE }}>
      <View
        style={{
          width: SIZE,
          height: SIZE,
          borderRadius: 16,
          overflow: 'hidden',
          backgroundColor: '#e5e5ea',
        }}
      >
        {thumbnailUrl ? (
          <Image source={{ uri: thumbnailUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : null}
      </View>
      <Text
        numberOfLines={2}
        className="text-text-primary"
        style={[typography.bodySmallEmphasis, { marginTop: 8 }]}
      >
        {name}
      </Text>
    </View>
  );
});
