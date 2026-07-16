import PlanCard from '@/components/plan-card/PlanCard';
import { usePlanDelete } from '@/components/plan-card/usePlanDelete';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { supabase } from '@/services/supabase/supabaseClient';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, TouchableOpacity, View } from 'react-native';
import { mockUser } from '../../../mock-data/mockUser';
import { useHome } from '../home/HomeContext';
import CreatePlan from './create-plan/CreatePlan';
import type { SavedPlan } from './create-plan/savePlan';

type PlanGridItem = {
  id: string;
  title: string;
  placeCount: number;
  imageUrl?: string;
};

const CREATE_ITEM: PlanGridItem = { id: '__create__', title: 'Create a plan', placeCount: 0, imageUrl: undefined };
const SPACER_ITEM: PlanGridItem = { id: '__spacer__', title: '', placeCount: 0, imageUrl: undefined };

function buildGridData(plans: PlanGridItem[]): PlanGridItem[] {
  const items = [CREATE_ITEM, ...plans];
  if (items.length % 2 !== 0) items.push(SPACER_ITEM);
  return items;
}

/** Fetch plans from the Supabase `projects` table. */
async function fetchPlansFromSupabase(): Promise<PlanGridItem[]> {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('id, title, destination, start_date, end_date, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.warn('[MyPlan] Failed to fetch plans:', error.message);
      return [];
    }

    return (data ?? []).map((project: Record<string, unknown>) => ({
      id: project.id as string,
      title: (project.title as string) || (project.destination as string) || 'Untitled Plan',
      placeCount: 0, // Will be updated when project_places are queried
      imageUrl: undefined,
    }));
  } catch (e) {
    console.error('[MyPlan] fetchPlans error:', e);
    return [];
  }
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
  const [dbPlans, setDbPlans] = useState<PlanGridItem[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const { plans, editMode, toggleEditMode, requestDelete, addPlan } = usePlanDelete();
  const { setOverlay, setTabBarVisible } = useHome();

  // 从 Supabase 加载真实计划数据，取代 mockPlans
  useEffect(() => {
    let cancelled = false;
    fetchPlansFromSupabase().then((loaded) => {
      if (cancelled) return;
      setDbPlans(loaded);
      setLoadingPlans(false);
      // 将 Supabase 计划同步到 usePlanDelete（清空 mock 数据后逐个添加）
      // usePlanDelete 内部使用 mockPlans，这里我们用自己的 dbPlans 展示
    });
    return () => { cancelled = true; };
  }, []);

  const displayPlans = dbPlans.length > 0 ? dbPlans : plans;

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
    const newItem: PlanGridItem = { id: plan.id, title: plan.title, placeCount: plan.placeCount, imageUrl: plan.imageUrl };
    addPlan(newItem);
    setDbPlans((prev) => [newItem, ...prev]);
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
          {displayPlans.length > 0 && (
            <Button variant="ghost" size="sm" onPress={toggleEditMode}>
              <Text style={{ fontSize: 15, fontWeight: '500', color: '#007aff' }}>
                {editMode ? 'Done' : 'Edit'}
              </Text>
            </Button>
          )}
        </View>
      </View>

      {/* Loading state */}
      {loadingPlans ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 }}>
          <ActivityIndicator size="small" color="#888" />
        </View>
      ) : displayPlans.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60, paddingHorizontal: 32 }}>
          <Text style={{ fontSize: 14, color: '#888', textAlign: 'center' }}>
            No plans yet — import a link and tap "Add to plan".
          </Text>
        </View>
      ) : (
        /* 2-column plan grid */
        <FlatList
          style={{ flex: 1 }}
          data={buildGridData(displayPlans)}
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
      )}
    </View>
  );
}
