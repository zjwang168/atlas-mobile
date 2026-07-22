import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, useColorScheme, View } from 'react-native';

import ContentPanel from '../../../../components/content-panel/ContentPanel';
import { useHome } from '../../../home/HomeContext';
import type { Atlas } from '@/types/atlas';
import type { PlaceDetail as PlaceDetailType } from '@/types/place';
import { PlaceCard } from '../../all-places/PlaceCard';
import AtlasOverviewSection from './AtlasOverviewSection';

// No real `atlas_places` join exists yet, so every atlas always shows an empty
// place list until that's wired up.
const NO_PLACES: PlaceDetailType[] = [];

function ItemSeparator() {
  return (
    <View style={{ height: 1, backgroundColor: 'rgba(60,60,67,0.07)', marginHorizontal: 16, marginVertical: 12 }} />
  );
}

type AtlasDetailProps = {
  atlasId: string | null;
  onDismiss: () => void;
  onHeightChange?: (height: number) => void;
};

export default function AtlasDetail({ atlasId, onDismiss, onHeightChange }: AtlasDetailProps) {
  const { atlases, deleteSavedPlace } = useHome();
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (atlasId) {
      setAtlas(atlases.find((a) => a.id === atlasId) ?? null);
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [atlasId, atlases]);

  const places = NO_PLACES;

  const handleDelete = useCallback((id: string) => {
    deleteSavedPlace(id);
  }, [deleteSavedPlace]);

  const renderItem = useCallback(
    ({ item }: { item: PlaceDetailType }) => <PlaceCard item={item} onDelete={handleDelete} />,
    [handleDelete],
  );

  const keyExtractor = useCallback((item: PlaceDetailType) => item.id, []);

  return (
    <ContentPanel
      visible={isVisible}
      onHidden={() => setAtlas(null)}
      zIndex={40}
      onHeightChange={onHeightChange}
      compactContent={({ snapTo }) =>
        atlas ? (
          <AtlasCompactView atlas={atlas} onDismiss={onDismiss} onExpand={() => snapTo('default')} />
        ) : null
      }
    >
      {({ reportScrollY, bottomInset }) => {
        if (!atlas) return null;
        return (
          <>
            <AtlasHeader atlas={atlas} onDismiss={onDismiss} />
            <FlatList
              data={places}
              keyExtractor={keyExtractor}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: bottomInset + 20 }}
              onScroll={(e) => reportScrollY(e.nativeEvent.contentOffset.y)}
              scrollEventThrottle={16}
              ListHeaderComponent={
                <View style={{ paddingBottom: 16 }}>
                  <AtlasOverviewSection atlas={atlas} placeCount={places.length} />
                </View>
              }
              ItemSeparatorComponent={ItemSeparator}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', paddingTop: 48, paddingHorizontal: 32 }}>
                  <Text className="text-text-secondary" style={typography.bodySmall}>
                    No places in this atlas yet.
                  </Text>
                </View>
              }
              renderItem={renderItem}
              showsVerticalScrollIndicator
            />
          </>
        );
      }}
    </ContentPanel>
  );
}

function AtlasHeader({ atlas, onDismiss }: { atlas: Atlas; onDismiss: () => void }) {
  const colorScheme = useColorScheme();
  const foreground = colorScheme === 'dark' ? '#fafafa' : '#0a0a0a';

  return (
    <View className="flex-row items-center px-4 pb-2 pt-1">
      <Text className="flex-1 h2 text-foreground" numberOfLines={1}>
        {atlas.title}
      </Text>

      <Button
        accessibilityLabel="Dismiss atlas details"
        onPress={onDismiss}
        size="icon"
        variant="ghost"
        className="h-12 w-12 rounded-full bg-background"
      >
        <Ionicons name="close" size={24} color={foreground} />
      </Button>
    </View>
  );
}

function AtlasCompactView({
  atlas,
  onDismiss,
  onExpand,
}: {
  atlas: Atlas;
  onDismiss: () => void;
  onExpand: () => void;
}) {
  const colorScheme = useColorScheme();
  const foreground = colorScheme === 'dark' ? '#fafafa' : '#18181B';

  return (
    <Pressable
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 }}
      onPress={onExpand}
    >
      <View className="flex-1 flex-row items-center gap-2">
        <Text style={{ fontSize: 20 }}>{atlas.emoji}</Text>
        <Text numberOfLines={1} className="flex-1 text-lg font-semibold text-foreground">
          {atlas.title}
        </Text>
      </View>

      <Button
        accessibilityLabel="Dismiss atlas details"
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
    </Pressable>
  );
}
