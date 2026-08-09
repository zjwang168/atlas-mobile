import { Text } from '@/components/ui/text';
import { useHome } from '@/features/home/HomeContext';
import { typography } from '@/theme/typography';
import { memo } from 'react';
import { Image, Pressable, View } from 'react-native';

type AtlasCardProps = {
  atlasId: string;
  emoji: string;
  title: string;
};

/** Memoized — rendered inside a 3-per-row grid of atlases; keeps unrelated
    section re-renders from forcing every card to re-render. */
export const AtlasCard = memo(function AtlasCard({ atlasId, emoji, title }: AtlasCardProps) {
  const { setOverlay, savedPlaces, atlasPlaces } = useHome();
  const coverUri = (() => {
    const rows = atlasPlaces.filter((row) => row.atlas_id === atlasId).sort((a, b) => a.sort_order - b.sort_order);
    const savedById = new Map(savedPlaces.map((place) => [place.id, place]));
    for (const row of rows) {
      const uri = row.place_id ? savedById.get(row.place_id)?.photo_url : row.photo_url;
      if (uri) return uri;
    }
    return null;
  })();

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
        {coverUri ? <Image source={{ uri: coverUri }} style={{ position: 'absolute', width: '100%', height: '100%' }} resizeMode="cover" /> : null}
        {coverUri ? <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.2)' }} /> : null}
        {coverUri ? <View style={{ position: 'absolute', right: 9, bottom: 9, width: 30, height: 30, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 17, lineHeight: 20 }}>{emoji}</Text></View> : <Text style={{ fontSize: 48, lineHeight: 56, textAlign: 'center' }}>{emoji}</Text>}
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
