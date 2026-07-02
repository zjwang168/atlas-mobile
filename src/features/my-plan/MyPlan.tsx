import { useState } from 'react';
import { FlatList, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import PlanCard from '@/components/plan-card/PlanCard';
import { usePlanDelete } from '@/components/plan-card/usePlanDelete';
import { mockUser } from '../../../mock-data/mockUser';
import CreatePlan from './create-plan/CreatePlan';
import { useHome } from '../home/HomeContext';
import type { SavedPlan } from './create-plan/savePlan';

const CREATE_ITEM = { id: '__create__', title: 'Create a plan', placeCount: 0, imageUrl: undefined };

function buildGridData(plans: typeof import('../../../mock-data/mockPlans').mockPlans) {
  const items = [CREATE_ITEM, ...plans];
  if (items.length % 2 !== 0) items.push({ id: '__spacer__', title: '', placeCount: 0, imageUrl: undefined });
  return items;
}

type MyPlanProps = {
  onAvatarPress?: () => void;
  onScroll?: (y: number) => void;
  bottomInset?: number;
  /** Renders a condensed header only — used when the panel is in compact snap state */
  compact?: boolean;
  /** Called when create-plan mode is entered or exited, so the parent can adjust panel height */
  onCreateModeChange?: (active: boolean) => void;
};

export default function MyPlan({
  onAvatarPress,
  onScroll,
  bottomInset = 0,
  compact = false,
  onCreateModeChange,
}: MyPlanProps) {
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const { plans, editMode, toggleEditMode, requestDelete, addPlan } = usePlanDelete();
  const { setOverlay, setTabBarVisible } = useHome();

  function enterCreateMode() {
    setShowCreatePlan(true);
    onCreateModeChange?.(true);
    setTabBarVisible(false);
  }

  function exitCreateMode() {
    setShowCreatePlan(false);
    onCreateModeChange?.(false);
    setTabBarVisible(true);
  }

  if (compact) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingVertical: 8,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '600', color: '#09090b' }}>My plan</Text>
        <TouchableOpacity onPress={onAvatarPress} activeOpacity={0.85}>
          <Avatar alt={mockUser.avatarFallback} style={{ width: 32, height: 32 }}>
            {mockUser.avatarUri ? <AvatarImage source={{ uri: mockUser.avatarUri }} /> : null}
            <AvatarFallback>
              <Text style={{ fontSize: 11, fontWeight: '500' }}>{mockUser.avatarFallback}</Text>
            </AvatarFallback>
          </Avatar>
        </TouchableOpacity>
      </View>
    );
  }

  function handlePlanCreated(plan: SavedPlan) {
    addPlan({ id: plan.id, title: plan.title, placeCount: plan.placeCount, imageUrl: plan.imageUrl });
    exitCreateMode();
    setOverlay({ kind: 'planDetail', planId: plan.id });
  }

  if (showCreatePlan) {
    return (
      <CreatePlan
        onClose={exitCreateMode}
        onPlanCreated={handlePlanCreated}
        reportScrollY={onScroll ?? (() => {})}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: 16,
        }}
      >
        <Text style={{ fontSize: 28, fontWeight: '600', lineHeight: 34, color: '#09090b' }}>
          My plan
        </Text>
        <View style={{ height: 40, justifyContent: 'center' }}>
          <Button variant="ghost" size="sm" onPress={toggleEditMode}>
            <Text style={{ fontSize: 15, fontWeight: '500', color: '#007aff' }}>
              {editMode ? 'Done' : 'Edit'}
            </Text>
          </Button>
        </View>
      </View>

      {/* 2-column plan grid */}
      <FlatList
        data={buildGridData(plans)}
        keyExtractor={(item) => item.id}
        numColumns={2}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset, gap: 24 }}
        columnWrapperStyle={{ gap: 16 }}
        onScroll={(e) => onScroll?.(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        renderItem={({ item }) =>
          item.id === '__spacer__' ? (
            <View style={{ flex: 1 }} />
          ) : (
            <PlanCard
              title={item.title}
              placeCount={item.placeCount}
              imageUrl={item.imageUrl}
              create={item.id === '__create__'}
              deletionMode={editMode}
              onPress={
                item.id === '__create__'
                  ? enterCreateMode
                  : item.id === '__spacer__'
                  ? undefined
                  : () => setOverlay({ kind: 'planDetail', planId: item.id })
              }
              onDeletePress={item.id !== '__create__' ? () => requestDelete(item.id) : undefined}
            />
          )
        }
      />

    </View>
  );
}
