import { Text } from '@/components/ui/text';
import { useHome } from '@/features/home/HomeContext';
import { typography } from '@/theme/typography';
import { memo } from 'react';
import { Pressable, View } from 'react-native';

type AtlasCardProps = {
  atlasId: string;
  emoji: string;
  title: string;
};

/** Memoized — rendered inside a 3-per-row grid of atlases; keeps unrelated
    section re-renders from forcing every card to re-render. */
export const AtlasCard = memo(function AtlasCard({ atlasId, emoji, title }: AtlasCardProps) {
  const { setOverlay } = useHome();

  return (
    <Pressable
      onPress={() => setOverlay({ kind: 'atlasDetail', atlasId })}
      style={{ flexBasis: '31%', flexGrow: 0 }}
    >
      <View
        className="bg-muted"
        style={{
          width: '100%',
          aspectRatio: 1,
          borderRadius: 16,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 48, lineHeight: 56, textAlign: 'center' }}>{emoji}</Text>
      </View>
      <Text
        numberOfLines={2}
        className="text-text-primary"
        style={[typography.bodySmallEmphasis, { marginTop: 8, textAlign: 'center' }]}
      >
        {title}
      </Text>
    </Pressable>
  );
});
