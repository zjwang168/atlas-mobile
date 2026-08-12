import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, useColorScheme, View } from 'react-native';
import { useAppDialog } from '@/components/feedback/AppDialog';

import ContentPanel from '../../../../components/content-panel/ContentPanel';
import { useHome } from '../../../home/HomeContext';
import { toPlaceDetail } from '@/services/place/placeService';
import type { Atlas } from '@/types/atlas';
import type { PlaceDetail as PlaceDetailType } from '@/types/place';
import { PlaceCard } from '../../all-places/PlaceCard';
import AtlasOverviewSection from './AtlasOverviewSection';

function ItemSeparator() {
  return (
    <View style={{ height: 1, backgroundColor: 'rgba(60,60,67,0.07)', marginHorizontal: 16, marginVertical: 12 }} />
  );
}

type AtlasDetailProps = {
  atlasId: string | null;
  onDismiss: () => void;
  snapGroup?: string;
  onHeightChange?: (height: number) => void;
};

export default function AtlasDetail({ atlasId, onDismiss, snapGroup, onHeightChange }: AtlasDetailProps) {
  const { show: showDialog } = useAppDialog();
  const { atlases, savedPlaces, setOverlay, atlasPlaces, addPlacesToAtlas, removePlaceFromAtlas, deleteAtlas } = useHome();
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

  // This atlas's join rows, sorted for display — atlasPlaces itself covers every
  // atlas and is loaded once by HomeContext, same as savedPlaces/atlases.
  const atlasPlaceRows = useMemo(() => {
    if (!atlasId) return [];
    return atlasPlaces.filter((row) => row.atlas_id === atlasId).sort((a, b) => a.sort_order - b.sort_order);
  }, [atlasId, atlasPlaces]);

  // atlas_places.id (the join row, needed to remove membership) keyed by place_id,
  // since PlaceCard's onDelete only gives back the place id.
  const joinRowIdByPlaceId = useMemo(
    () => new Map(atlasPlaceRows.map((row) => [row.place_id, row.id])),
    [atlasPlaceRows],
  );

  const places = useMemo(() => {
    const savedById = new Map(savedPlaces.map((place) => [place.id, place]));
    return atlasPlaceRows
      .map((row) => savedById.get(row.place_id))
      .filter((place): place is NonNullable<typeof place> => Boolean(place))
      .map(toPlaceDetail);
  }, [atlasPlaceRows, savedPlaces]);

  // Removes the place from this atlas only — the saved place itself is untouched.
  const handleDelete = useCallback((placeId: string) => {
    const joinRowId = joinRowIdByPlaceId.get(placeId);
    if (joinRowId) removePlaceFromAtlas(joinRowId);
  }, [joinRowIdByPlaceId, removePlaceFromAtlas]);

  const handleAddPress = useCallback(() => {
    if (!atlasId) return;
    const excludeIds = atlasPlaceRows.map((row) => row.place_id);
    setOverlay({
      kind: 'addPlace',
      excludeIds,
      returnTo: { kind: 'atlasDetail', atlasId },
      onSelect: (selected) => {
        addPlacesToAtlas(atlasId, selected.map((place) => place.id));
      },
    });
  }, [atlasId, atlasPlaceRows, setOverlay, addPlacesToAtlas]);

  const handleDeletePress = useCallback(() => {
    if (!atlasId || !atlas) return;
    const placeCount = places.length;
    const message = placeCount > 0
      ? `Delete "${atlas.title}"? Its ${placeCount} ${placeCount === 1 ? 'place' : 'places'} will stay in My Places but won't be grouped in this atlas anymore. This can't be undone.`
      : `Delete "${atlas.title}"? This can't be undone.`;
    showDialog({
      title: 'Delete Atlas?',
      message,
      tone: 'danger',
      actions: [
        { label: 'Keep Atlas' },
        {
          label: 'Delete',
          variant: 'destructive',
          onPress: () => {
            deleteAtlas(atlasId);
            setOverlay({ kind: 'none' });
          },
        },
      ],
    });
  }, [atlasId, atlas, places.length, deleteAtlas, setOverlay, showDialog]);

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
      snapGroup={snapGroup}
      minSnap="default"
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
                  <AtlasOverviewSection atlas={atlas} placeCount={places.length} onAddPress={handleAddPress} onDeletePress={handleDeletePress} />
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
