import PlanCard from './PlanCard';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ActivityIndicator, Animated, FlatList, TouchableOpacity, View } from 'react-native';
import { mockUser } from '../../../mock-data/mockUser';
import type { SnapState } from '../../components/content-panel/ContentPanel';
import { useHome } from '../home/HomeContext';
import CreatePlan, { CreatePlanHandle } from './create-plan/CreatePlan';
import { deleteSavedPlan, listSavedPlans, type SavedPlan } from './create-plan/savePlan';

type PlanGridItem = {
  id: string;
  title: string;
  placeCount: number;
  imageUrl?: string;
};

const CREATE_ITEM: PlanGridItem = { id: '__create__', title: 'Create a plan', placeCount: 0, imageUrl: undefined };
const SPACER_ITEM: PlanGridItem = { id: '__spacer__', title: '', placeCount: 0, imageUrl: undefined };

// 160ms fade out -> 60ms pause -> content swap -> 60ms pause -> 160ms fade in.
const FADE_DURATION = 160;
const SWAP_PAUSE = 60;

function buildGridData(plans: PlanGridItem[]): PlanGridItem[] {
  const items = [CREATE_ITEM, ...plans];
  if (items.length % 2 !== 0) items.push(SPACER_ITEM);
  return items;
}

type PlanGridCellProps = {
  item: PlanGridItem;
  editMode: boolean;
  onPressCreate: () => void;
  onSelectPlan: (id: string) => void;
  onRequestDelete: (id: string) => void;
};

/** Memoized so unrelated re-renders of MyPlan (e.g. editMode toggling) don't
    force every visible PlanCard to re-render — only rows whose own props
    actually changed do (mirrors AllPlaces.tsx's PlaceRow). */
const PlanGridCell = memo(function PlanGridCell({
  item,
  editMode,
  onPressCreate,
  onSelectPlan,
  onRequestDelete,
}: PlanGridCellProps) {
  if (item.id === '__spacer__') return <View style={{ flex: 1 }} />;
  const isCreate = item.id === '__create__';
  return (
    <PlanCard
      title={item.title}
      placeCount={item.placeCount}
      imageUrl={item.imageUrl}
      create={isCreate}
      deletionMode={editMode}
      onPress={isCreate ? onPressCreate : () => onSelectPlan(item.id)}
      onDeletePress={isCreate ? undefined : () => onRequestDelete(item.id)}
    />
  );
});

type MyPlanProps = {
  onAvatarPress?: () => void;
  onScroll?: (y: number) => void;
  bottomInset?: number;
  verticalScrollEnabled?: boolean;
  /** Renders a condensed header only — used when the panel is in compact snap state */
  compact?: boolean;
  /** ContentPanel's imperative snap function — called directly (not via a state/prop
      round trip) so the panel-height animation starts in the same tick as the
      content cross-fade instead of a render behind it. */
  snapTo?: (state: SnapState, animated?: boolean) => void;
};

function MyPlan({
  onAvatarPress,
  onScroll,
  bottomInset = 0,
  verticalScrollEnabled = true,
  compact = false,
  snapTo,
}: MyPlanProps) {
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  // Both the grid and CreatePlan stay permanently mounted (mirrors
  // ContentPanel's compact/default crossfade) — no unmount/remount at the
  // swap point, so there's no window where a heavy mount (CreatePlan's
  // calendar etc.) can race against the animation and cause a visible flash.
  // Each side has its own opacity so the two halves can run as a strict
  // timeline (fade out, pause, swap, pause, fade in) instead of a smooth
  // simultaneous crossfade.
  const gridOpacity = useRef(new Animated.Value(1)).current;
  const createOpacity = useRef(new Animated.Value(0)).current;
  const createPlanRef = useRef<CreatePlanHandle>(null);
  const [dbPlans, setDbPlans] = useState<PlanGridItem[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const { setOverlay, setTabBarVisible } = useHome();

  // Load real plans from Supabase (via savePlan.ts's planService-backed listSavedPlans).
  useEffect(() => {
    let cancelled = false;
    listSavedPlans().then((loaded) => {
      if (cancelled) return;
      setDbPlans(loaded.map((plan) => ({
        id: plan.id,
        title: plan.title,
        placeCount: plan.placeCount,
        imageUrl: plan.imageUrl,
      })));
      setLoadingPlans(false);
    }).catch((error) => {
      if (cancelled) return;
      console.warn('[MyPlan] Failed to load plans:', error);
      setLoadingPlans(false);
    });
    return () => { cancelled = true; };
  }, []);

  const toggleEditMode = useCallback(() => setEditMode((prev) => !prev), []);

  const gridData = useMemo(() => buildGridData(dbPlans), [dbPlans]);

  const enterCreateMode = useCallback(() => {
    snapTo?.('tall');
    setTabBarVisible(false);
    Animated.sequence([
      Animated.timing(gridOpacity, { toValue: 0, duration: FADE_DURATION, useNativeDriver: true }),
      Animated.delay(SWAP_PAUSE),
    ]).start(({ finished }) => {
      if (!finished) return;
      createPlanRef.current?.reset();
      setShowCreatePlan(true);
      Animated.sequence([
        Animated.delay(SWAP_PAUSE),
        Animated.timing(createOpacity, { toValue: 1, duration: FADE_DURATION, useNativeDriver: true }),
      ]).start();
    });
  }, [snapTo, setTabBarVisible, gridOpacity, createOpacity]);

  const exitCreateMode = useCallback(() => {
    snapTo?.('default');
    setTabBarVisible(true);
    Animated.sequence([
      Animated.timing(createOpacity, { toValue: 0, duration: FADE_DURATION, useNativeDriver: true }),
      Animated.delay(SWAP_PAUSE),
    ]).start(({ finished }) => {
      if (!finished) return;
      setShowCreatePlan(false);
      Animated.sequence([
        Animated.delay(SWAP_PAUSE),
        Animated.timing(gridOpacity, { toValue: 1, duration: FADE_DURATION, useNativeDriver: true }),
      ]).start();
    });
  }, [snapTo, setTabBarVisible, gridOpacity, createOpacity]);

  const handlePlanCreated = useCallback((plan: SavedPlan) => {
    const newItem: PlanGridItem = { id: plan.id, title: plan.title, placeCount: plan.placeCount, imageUrl: plan.imageUrl };
    setDbPlans((prev) => [newItem, ...prev]);
    exitCreateMode();
    setOverlay({ kind: 'planDetail', planId: plan.id });
  }, [exitCreateMode, setOverlay]);

  const onSelectPlan = useCallback((id: string) => {
    setOverlay({ kind: 'planDetail', planId: id });
  }, [setOverlay]);

  const onRequestDelete = useCallback((id: string) => {
    const plan = dbPlans.find((p) => p.id === id);
    if (!plan) return;
    Alert.alert('Delete Plan', `Are you sure you want to delete "${plan.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setDbPlans((prev) => prev.filter((p) => p.id !== id));
          deleteSavedPlan(id).catch((error) => {
            console.warn('[MyPlan] Failed to delete plan:', error);
            setDbPlans((prev) => [plan, ...prev]);
          });
        },
      },
    ]);
  }, [dbPlans]);

  const keyExtractor = useCallback((item: PlanGridItem) => item.id, []);

  const renderItem = useCallback(
    ({ item }: { item: PlanGridItem }) => (
      <PlanGridCell
        item={item}
        editMode={editMode}
        onPressCreate={enterCreateMode}
        onSelectPlan={onSelectPlan}
        onRequestDelete={onRequestDelete}
      />
    ),
    [editMode, enterCreateMode, onSelectPlan, onRequestDelete],
  );

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

  return (
    <View style={{ flex: 1 }}>
      <Animated.View
        pointerEvents={showCreatePlan ? 'none' : 'auto'}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: gridOpacity }}
      >
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
            {dbPlans.length > 0 && (
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
        ) : (
          /* 2-column plan grid — gridData always includes the "Create a plan" card, even with 0 real plans */
          <FlatList
            style={{ flex: 1 }}
            data={gridData}
            scrollEnabled={verticalScrollEnabled}
            keyExtractor={keyExtractor}
            numColumns={2}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomInset, gap: 24 }}
            columnWrapperStyle={{ gap: 16 }}
            onScroll={(e) => onScroll?.(e.nativeEvent.contentOffset.y)}
            scrollEventThrottle={16}
            renderItem={renderItem}
          />
        )}
      </Animated.View>

      <Animated.View
        pointerEvents={showCreatePlan ? 'auto' : 'none'}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: createOpacity }}
      >
        <CreatePlan
          ref={createPlanRef}
          onClose={exitCreateMode}
          onPlanCreated={handlePlanCreated}
          reportScrollY={onScroll ?? (() => {})}
          inline
        />
      </Animated.View>
    </View>
  );
}

export default memo(MyPlan);
