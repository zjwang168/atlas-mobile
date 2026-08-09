import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Text } from '@/components/ui/text';
import { useHome } from '@/features/home/HomeContext';
import { mockUser } from '../../../mock-data/mockUser';
import type { SnapState } from '../../components/content-panel/ContentPanel';
import AtlasBuilder from './atlas-builder/AtlasBuilder';
import type { DraftPlace } from './atlas-builder/AtlasBuilder';
import { memo, useCallback, useEffect, useState } from 'react';
import { TouchableOpacity, View } from 'react-native';

type MyPlanProps = {
  onAvatarPress?: () => void;
  compact?: boolean;
  snapTo?: (state: SnapState, animated?: boolean) => void;
  active?: boolean;
  onExit?: () => void;
};

function MyPlan({ onAvatarPress, compact = false, snapTo, active = false, onExit }: MyPlanProps) {
  const { setOverlay, setActiveSidekick } = useHome();
  const [builderVisible, setBuilderVisible] = useState(false);
  const [buildSeed, setBuildSeed] = useState<DraftPlace[] | null>(null);
  const [draftItems, setDraftItems] = useState<DraftPlace[]>([]);
  const [buildCenter, setBuildCenter] = useState<[number, number] | undefined>();
  const [buildBounds, setBuildBounds] = useState<{ ne: [number, number]; sw: [number, number] } | undefined>();
  const [builderKey, setBuilderKey] = useState(0);

  const openBuilder = useCallback(() => {
    // Keep the shared map visible above the Atlas editor rather than turning
    // the editor into a full-screen white page.
    snapTo?.('default');
    setBuildSeed(null);
    setDraftItems([]);
    setBuildCenter(undefined);
    setBuildBounds(undefined);
    setBuilderKey((value) => value + 1);
    setBuilderVisible(true);
  }, [snapTo]);
  const closeBuilder = useCallback(() => {
    setBuilderVisible(false);
    setBuildSeed(null);
    setDraftItems([]);
    setBuildCenter(undefined);
    setBuildBounds(undefined);
    snapTo?.('default');
    onExit?.();
  }, [onExit, snapTo]);
  const openBuildPlan = useCallback((_location: string, candidates: DraftPlace[], center?: [number, number], bounds?: { ne: [number, number]; sw: [number, number] }) => {
    setBuildSeed(candidates);
    setBuildCenter(center);
    setBuildBounds(bounds);
    setBuilderVisible(true);
  }, []);
  const handleFirstPlaceAdded = useCallback(() => {
    snapTo?.('tall');
  }, [snapTo]);

  useEffect(() => {
    if (!compact && active && !builderVisible) openBuilder();
  }, [active, builderVisible, compact, openBuilder]);

  if (compact) {
    return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 }}><Text style={{ fontSize: 18, fontWeight: '600', color: '#09090b' }}>Atlas</Text><TouchableOpacity onPress={onAvatarPress}><Avatar alt={mockUser.avatarFallback} style={{ width: 32, height: 32 }}>{mockUser.avatarUri ? <AvatarImage source={{ uri: mockUser.avatarUri }} /> : null}<AvatarFallback><Text style={{ fontSize: 11 }}>{mockUser.avatarFallback}</Text></AvatarFallback></Avatar></TouchableOpacity></View>;
  }

  if (builderVisible) {
    return <AtlasBuilder key={builderKey} initialCandidates={buildSeed ?? undefined} initialItems={draftItems} initialCenter={buildCenter} initialBounds={buildBounds} started={buildSeed !== null} onItemsChange={setDraftItems} onFirstPlaceAdded={handleFirstPlaceAdded} onClose={closeBuilder} onBuildPlan={openBuildPlan} onSaved={(atlasId, askAI) => {
      closeBuilder();
      if (askAI) setActiveSidekick('aiChat');
      else setOverlay({ kind: 'atlasDetail', atlasId });
    }} />;
  }

  return <View style={{ flex: 1 }} />;
}

export default memo(MyPlan);
