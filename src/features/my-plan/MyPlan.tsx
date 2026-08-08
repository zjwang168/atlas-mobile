import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Text } from '@/components/ui/text';
import { useHome } from '@/features/home/HomeContext';
import { mockUser } from '../../../mock-data/mockUser';
import type { SnapState } from '../../components/content-panel/ContentPanel';
import AtlasBuilder from './atlas-builder/AtlasBuilder';
import PlanCard from './PlanCard';
import { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Share, TouchableOpacity, View } from 'react-native';

type MyPlanProps = {
  onAvatarPress?: () => void;
  onScroll?: (y: number) => void;
  bottomInset?: number;
  compact?: boolean;
  snapTo?: (state: SnapState, animated?: boolean) => void;
};

type GridItem = { id: string; title: string; placeCount: number; imageUrl?: string; create?: boolean };

function MyPlan({ onAvatarPress, onScroll, bottomInset = 0, compact = false, snapTo }: MyPlanProps) {
  const { atlases, atlasPlaces, setOverlay, setActiveSidekick, deleteAtlas } = useHome();
  const [editing, setEditing] = useState(false);
  const [builderVisible, setBuilderVisible] = useState(false);

  const data = useMemo<GridItem[]>(() => [
    { id: '__create__', title: 'Create an Atlas', placeCount: 0, create: true },
    ...atlases.map((atlas) => ({
      id: atlas.id,
      title: atlas.title,
      placeCount: atlasPlaces.filter((row) => row.atlas_id === atlas.id).length,
    })),
  ], [atlases, atlasPlaces]);

  const openBuilder = useCallback(() => {
    // Keep the shared map visible above the Atlas editor rather than turning
    // the editor into a full-screen white page.
    snapTo?.('default');
    setBuilderVisible(true);
  }, [snapTo]);
  const closeBuilder = useCallback(() => {
    setBuilderVisible(false);
    snapTo?.('default');
  }, [snapTo]);

  const shareAtlas = useCallback(async (item: GridItem) => {
    await Share.share({
      title: item.title,
      message: `View ${item.title} in OurAtlas.`,
    });
  }, []);

  if (compact) {
    return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 }}><Text style={{ fontSize: 18, fontWeight: '600', color: '#09090b' }}>Atlas</Text><TouchableOpacity onPress={onAvatarPress}><Avatar alt={mockUser.avatarFallback} style={{ width: 32, height: 32 }}>{mockUser.avatarUri ? <AvatarImage source={{ uri: mockUser.avatarUri }} /> : null}<AvatarFallback><Text style={{ fontSize: 11 }}>{mockUser.avatarFallback}</Text></AvatarFallback></Avatar></TouchableOpacity></View>;
  }

  if (builderVisible) {
    return <AtlasBuilder onClose={closeBuilder} onSaved={(atlasId, askAI) => {
      closeBuilder();
      if (askAI) setActiveSidekick('aiChat');
      else setOverlay({ kind: 'atlasDetail', atlasId });
    }} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 28, fontWeight: '700', color: '#09090b' }}>Atlas</Text>
        <TouchableOpacity onPress={() => setEditing((value) => !value)}><Text style={{ color: '#007AFF', fontSize: 15, fontWeight: '600' }}>{editing ? 'Done' : 'Edit'}</Text></TouchableOpacity>
      </View>
      <FlatList
        data={data}
        numColumns={2}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset + 20, gap: 22 }}
        columnWrapperStyle={{ gap: 16 }}
        onScroll={(event) => onScroll?.(event.nativeEvent.contentOffset.y)}
        renderItem={({ item }) => <View style={{ flex: 1 }}><PlanCard title={item.title} placeCount={item.placeCount} imageUrl={item.imageUrl} create={item.create} deletionMode={editing && !item.create} onPress={item.create ? openBuilder : () => setOverlay({ kind: 'atlasDetail', atlasId: item.id })} onLongPress={!item.create ? () => shareAtlas(item) : undefined} onDeletePress={!item.create ? () => deleteAtlas(item.id) : undefined} /></View>}
      />
    </View>
  );
}

export default memo(MyPlan);
