import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Platform, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import TopNav, { type TopMode } from '../../components/top-nav/TopNav';
import TopBlurFade from '../../components/ui/top-blur-fade';
import type { ParsedPlace } from '../../services/import/importService';
import type { SavedPlace } from '../../services/place/placeService';
import type { PlaceDetail as PlaceDetailRecord } from '../../types/place';
import MapboxMap, { MapboxMapHandle, MapMarker } from '../map/MapboxMap';
import { SNAP_HEIGHTS } from '../../components/content-panel/ContentPanel';
import { useContentPanelSnapGroup } from '../../components/content-panel/ContentPanelSnapProvider';
import AddPlace from '../add-place/AddPlace';
import CreatePlan from '../my-plan/create-plan/CreatePlan';
import type { SavedPlan } from '../my-plan/create-plan/savePlan';
import PlanDetail from '../my-plan/plan-detail/PlanDetail';
import PlaceDetail from '../place-detail/PlaceDetail';
import AtlasDetail from '../my-places/atlas/atlas-detail/AtlasDetail';
import AIChatBox from '../atlas-ai/ai-chat/AIChatBox';
import DebugPanel from '@/dev/DebugPanel';
import { useHome } from './HomeContext';
import HomePanel from './HomePanel';
import HomeTabBar, {
  TAB_CHAT,
  TAB_PLACES,
  TAB_PLAN,
  TAB_PROFILE,
} from './HomeTabBar';
import SearchPanel from '../search/SearchPanel';
import AccountModal from '../auth/AccountModal';

const HOME_PANEL_SNAP_GROUP = 'home-main';
// Approximate settle time of ContentPanel's snap spring (damping 22 / stiffness
// 200 / mass 0.9) — see below for why the map's padding recompute waits this long
// after a group snap change instead of reacting immediately.
const PANEL_SPRING_SETTLE_DELAY = 380;
const SHEET_OVERLAY_HANDOFF_DELAY = 360;

// ---- Types ----

interface HomeScreenProps {
  onOpenImport?: () => void;
  onOpenChatHistory?: () => void;
  externalOverlayVisible?: boolean;
}

// ---- Helpers ----

const toMapMarkersFromParsed = (places: ParsedPlace[]): MapMarker[] =>
  places.map((p) => ({
    id: p.id,
    latitude: p.latitude,
    longitude: p.longitude,
    title: p.name,
    description: p.subtitle,
  }));

const toMapMarkersFromSaved = (places: SavedPlace[]): MapMarker[] =>
  places.map((p) => ({
    id: p.id,
    latitude: p.latitude,
    longitude: p.longitude,
    title: p.name,
    description: p.subtitle,
  }));

// Compute median center from parsed places
const medianCenter = (places: ParsedPlace[]): [number, number] => {
  if (places.length === 0) return [-122.3321, 47.6062];
  const mid = (values: number[]) => {
    const s = [...values].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return [mid(places.map((p) => p.longitude)), mid(places.map((p) => p.latitude))];
};

// ---- Root export — HomeProvider is now in App.tsx ----

export default function HomeScreen({
  onOpenImport,
  onOpenChatHistory,
  externalOverlayVisible = false,
}: HomeScreenProps) {
  return (
    <HomeScreenContent
      onOpenImport={onOpenImport}
      onOpenChatHistory={onOpenChatHistory}
      externalOverlayVisible={externalOverlayVisible}
    />
  );
}

// ---- Inner component — consumes the context ----

function HomeScreenContent({
  onOpenImport,
  onOpenChatHistory,
  externalOverlayVisible = false,
}: HomeScreenProps) {
  const { height: screenHeight } = useWindowDimensions();
  const {
    overlay,
    setOverlay,
    tabBarVisible,
    parsedPlaces,
    setParsedPlaces,
    selectedPlaceCoordinate,
    setSelectedPlaceCoordinate,
    selectedPlaceId,
    setSelectedPlaceId,
    activeHistoryItem,
    setActiveHistoryItem,
    activeSidekick,
    setActiveSidekick,
    userLocation,
    locationStatus,
    refreshUserLocation,
    savedPlaces,
  } = useHome();
  const [groupSnapState] = useContentPanelSnapGroup(HOME_PANEL_SNAP_GROUP, 'default');
  // `groupSnapState` now updates ~1 frame after a drag-release (broadcast early so a
  // panel switching mid-spring doesn't inherit a stale value) — but this screen's own
  // subscription drives the map's discrete camera-padding recenter below, which is
  // expensive enough that firing it mid-spring competes with the panel's own height
  // animation on the JS thread and stutters it. Delaying this copy until roughly the
  // spring's settle time keeps the recenter from overlapping the drag animation, same
  // as when the group write itself was deferred to spring completion.
  const [settledPanelSnapState, setSettledPanelSnapState] = useState(groupSnapState);
  useEffect(() => {
    if (groupSnapState === settledPanelSnapState) return;
    const timeout = setTimeout(() => setSettledPanelSnapState(groupSnapState), PANEL_SPRING_SETTLE_DELAY);
    return () => clearTimeout(timeout);
  }, [groupSnapState, settledPanelSnapState]);
  const tabBarOpacity = useRef(
    new Animated.Value(Platform.OS === 'ios' ? 0 : 1),
  ).current;
  const pagerTranslateX = useRef(new Animated.Value(0)).current;
  const pagerWidth = useMemo(() => Dimensions.get('window').width, []);

  const [activeTab, setActiveTab] = useState<string>(TAB_PLACES);
  const [topMode, setTopMode] = useState<TopMode>('saved');
  const [accountOpen, setAccountOpen] = useState(false);
  const [standaloneChatVisible, setStandaloneChatVisible] = useState(false);
  const [chatPresentationVisible, setChatPresentationVisible] = useState(false);
  const [standaloneChatKey, setStandaloneChatKey] = useState(0);
  const [chatPresented, setChatPresented] = useState(false);
  const [mainSheetPaused, setMainSheetPaused] = useState(false);
  const pendingSheetActionRef = useRef<(() => void) | null>(null);
  // Their marker-delete animation. `homePanelVisible` is deliberately not
  // carried over — the native sheet's own visibility model (mainSheetVisible)
  // replaced it.
  const [deletingMarker, setDeletingMarker] = useState<MapMarker | null>(null);
  const tabOrder = useMemo(() => [TAB_PLACES, TAB_PLAN, TAB_PROFILE], []);

  // Use parsedPlaces from HomeContext (set by App.tsx after parse)
  const hasParsedPlaces = parsedPlaces.length > 0;

  // 地图中心：优先使用选中地点坐标，其次使用 parsedPlaces 的中心，
  // 再次使用用户 GPS 定位，最后用默认值（西雅图）
  const mapCenter = useMemo(() => {
    if (selectedPlaceCoordinate) return selectedPlaceCoordinate;
    if (hasParsedPlaces) return medianCenter(parsedPlaces);
    if (userLocation) return userLocation;
    return [-122.3321, 47.6062] as [number, number];
  }, [selectedPlaceCoordinate, hasParsedPlaces, parsedPlaces, userLocation]);

  // savedPlaces 常驻标记
  const savedMarkers = useMemo(
    () => toMapMarkersFromSaved(savedPlaces),
    [savedPlaces],
  );

  // parsedPlaces 临时标记（有解析结果时显示）
  const parsedMarkers = useMemo(
    () => (hasParsedPlaces ? toMapMarkersFromParsed(parsedPlaces) : []),
    [parsedPlaces, hasParsedPlaces],
  );

  // 合并标记：有 parsedPlaces 时优先显示解析结果，否则显示已保存地点
  const mapMarkers = useMemo(() => {
    const markers = hasParsedPlaces ? parsedMarkers : savedMarkers;
    return deletingMarker && !markers.some((marker) => marker.id === deletingMarker.id)
      ? [...markers, deletingMarker]
      : markers;
  }, [savedMarkers, parsedMarkers, hasParsedPlaces, deletingMarker]);

  // 动态 zoom 级别
  const mapZoom = useMemo(() => {
    if (selectedPlaceCoordinate) return 15;
    if (hasParsedPlaces) return 10;
    return 12;
  }, [selectedPlaceCoordinate, hasParsedPlaces]);

  const panelVisible = overlay.kind === 'none' || overlay.kind === 'search';
  const historyChatRequested = activeSidekick === 'aiChat' && panelVisible;
  const chatRequested = standaloneChatVisible || historyChatRequested;
  const chatVisible = chatPresentationVisible;
  const effectiveTabBarVisible = tabBarVisible && !chatVisible;
  // On iOS the persistent native sheet owns the only visible tab bar.
  // Keeping the React Native copy hidden prevents it flashing through while
  // the sheet hands off to Add, Chat, or Account overlays.
  const rootTabBarVisible = Platform.OS !== 'ios' && effectiveTabBarVisible;
  const mainSheetVisible =
    Platform.OS === 'ios' &&
    overlay.kind === 'none' &&
    !externalOverlayVisible &&
    !chatVisible &&
    !accountOpen &&
    !mainSheetPaused &&
    (activeTab === TAB_PLACES || activeTab === TAB_PLAN);

  useEffect(() => {
    if (
      !externalOverlayVisible &&
      !chatVisible &&
      !accountOpen &&
      overlay.kind === 'none'
    ) {
      setMainSheetPaused(false);
    }
  }, [accountOpen, chatVisible, externalOverlayVisible, overlay.kind]);

  const presentAboveMainSheet = useCallback((action: () => void) => {
    if (Platform.OS !== 'ios' || !mainSheetVisible) {
      action();
      return;
    }

    pendingSheetActionRef.current = action;
    setMainSheetPaused(true);
  }, [mainSheetVisible]);

  const handleMainSheetDismissed = useCallback(() => {
    const pendingAction = pendingSheetActionRef.current;
    pendingSheetActionRef.current = null;
    pendingAction?.();
  }, []);

  useEffect(() => {
    if (!chatRequested) {
      setChatPresentationVisible(false);
      return;
    }
    // Let the selector travel from My Places to Chat before the chat surface
    // covers the tab bar, so opening AI feels like one continuous transition.
    setActiveTab(TAB_CHAT);
    const timeoutId = setTimeout(() => setChatPresentationVisible(true), 280);
    return () => clearTimeout(timeoutId);
  }, [chatRequested]);

  useEffect(() => {
    Animated.timing(tabBarOpacity, {
      toValue: rootTabBarVisible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [rootTabBarVisible, tabBarOpacity]);

  useEffect(() => {
    if (!chatVisible) {
      setChatPresented(false);
      return;
    }

    if (Platform.OS !== 'ios') {
      setChatPresented(true);
      return;
    }

    const timeout = setTimeout(() => {
      setChatPresented(true);
    }, SHEET_OVERLAY_HANDOFF_DELAY);
    return () => clearTimeout(timeout);
  }, [chatVisible]);

  useEffect(() => {
    if (activeHistoryItem) {
      setStandaloneChatVisible(false);
    }
  }, [activeHistoryItem]);

  // Any bottom panel that should push the map center up — the main pager panel,
  // the PlaceDetail overlay, the AtlasDetail overlay, or the AddPlace overlay —
  // drives the same padding-tracking path.
  const mainPanelActive = Platform.OS === 'ios' ? mainSheetVisible : panelVisible;
  const bottomPanelActive = mainPanelActive || overlay.kind === 'placeDetail' || overlay.kind === 'atlasDetail' || overlay.kind === 'addPlace';
  const nativeMainPanelActive =
    Platform.OS === 'ios' &&
    (activeTab === TAB_PLACES || activeTab === TAB_PLAN);
  const settledBottomPanelHeight = nativeMainPanelActive
    ? settledPanelSnapState === 'short'
      ? screenHeight * 0.40
      : settledPanelSnapState === 'tall'
        ? screenHeight * 0.94
        : screenHeight * 0.54
    : SNAP_HEIGHTS[settledPanelSnapState];
  // Tracks the live panel height without React state — the panel reports it every
  // animation frame while dragging/snapping, and nothing else needs to reactively
  // read it, so pushing it through setState would re-render the whole screen 60x/sec.
  const bottomPanelHeightRef = useRef(settledBottomPanelHeight);
  const mapRef = useRef<MapboxMapHandle>(null);
  const deletingMarkerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Recomputed whenever the active bottom panel toggles OR its resolved snap state
  // changes, so a discrete camera recenter (e.g. selecting a different marker while
  // the panel is at a non-default snap height) uses padding matching the panel's
  // *current* height instead of a frozen default — this still goes through
  // MapboxMap's prop-driven, animated camera path so hiding/showing the panel eases
  // the map padding smoothly. Per-frame drag tracking stays on the ref-based path below.
  const mapPadding = useMemo(() => ({
    paddingTop: 0,
    paddingBottom: bottomPanelActive ? settledBottomPanelHeight : 0,
    paddingLeft: 0,
    paddingRight: 0,
  }), [bottomPanelActive, settledBottomPanelHeight]);
  useEffect(() => {
    bottomPanelHeightRef.current = mapPadding.paddingBottom;
  }, [mapPadding]);
  // Per-frame panel height updates — pushed straight to the map's camera via ref,
  // bypassing React re-render entirely.
  const handlePanelHeightChange = useCallback((height: number) => {
    bottomPanelHeightRef.current = height;
    mapRef.current?.setPaddingBottom(bottomPanelActive ? height : 0);
  }, [bottomPanelActive]);

  const handleAddPress = useCallback(() => {
    if (!onOpenImport) return;
    presentAboveMainSheet(() => {
      onOpenImport();
    });
  }, [onOpenImport, presentAboveMainSheet]);
  const handleChatPress = useCallback(() => {
    presentAboveMainSheet(() => {
      setStandaloneChatVisible(true);
      setChatPresented(true);
    });
  }, [presentAboveMainSheet]);
  const handleAccountPress = useCallback(() => {
    presentAboveMainSheet(() => {
      setAccountOpen(true);
    });
  }, [presentAboveMainSheet]);
  const handleNewChat = useCallback(() => {
    setActiveHistoryItem(null);
    setActiveSidekick('none');
    setStandaloneChatVisible(true);
    setStandaloneChatKey((current) => current + 1);
  }, [setActiveHistoryItem, setActiveSidekick]);
  const animateToTab = useCallback((tab: string) => {
    const idx = Math.max(0, tabOrder.indexOf(tab));
    Animated.spring(pagerTranslateX, {
      toValue: -idx * pagerWidth,
      useNativeDriver: true,
      damping: 20,
      stiffness: 180,
      mass: 0.85,
    }).start();
    setActiveTab(tab);
  }, [pagerTranslateX, pagerWidth, tabOrder]);
  const handleTabChange = useCallback((tab: string) => {
    animateToTab(tab);
  }, [animateToTab]);

  useEffect(() => {
    animateToTab(activeTab);
  }, []);
  // --- Search & History handlers ---
  // SearchPanel is a root-level RN overlay, so on iOS it would render beneath
  // the native places sheet. Going through presentAboveMainSheet lets the sheet
  // finish dismissing first instead of the two animating over each other.
  const handleSearchPress = useCallback(() => {
    presentAboveMainSheet(() => {
      setOverlay({ kind: 'search' });
    });
  }, [presentAboveMainSheet, setOverlay]);

  /** Locate button: take a fresh fix, then recenter on whatever came back.
      A refused permission resolves to the default centre rather than failing,
      so the button always moves the camera somewhere sensible. */
  const handleLocatePress = useCallback(async () => {
    const coordinate = await refreshUserLocation();
    mapRef.current?.flyTo(coordinate);
  }, [refreshUserLocation]);

  const handleMarkerPress = useCallback((marker: MapMarker) => {
    setSelectedPlaceId(marker.id);
    setSelectedPlaceCoordinate([marker.longitude, marker.latitude]);
  }, [setSelectedPlaceId, setSelectedPlaceCoordinate]);

  const handleDeleteInitiated = useCallback((place: PlaceDetailRecord) => {
    if (deletingMarkerTimerRef.current) clearTimeout(deletingMarkerTimerRef.current);
    setDeletingMarker({ id: place.id, longitude: place.longitude, latitude: place.latitude, title: place.name, description: place.subtitle });
    deletingMarkerTimerRef.current = setTimeout(() => setDeletingMarker(null), 470);
  }, []);

  useEffect(() => () => {
    if (deletingMarkerTimerRef.current) clearTimeout(deletingMarkerTimerRef.current);
  }, []);

  useEffect(() => {
    if (hasParsedPlaces || !selectedPlaceId || savedPlaces.some((place) => place.id === selectedPlaceId)) return;
    setSelectedPlaceId(null);
  }, [hasParsedPlaces, savedPlaces, selectedPlaceId, setSelectedPlaceId]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* Single full-screen map behind everything */}
      <MapboxMap
        ref={mapRef}
        markers={mapMarkers}
        centerCoordinate={mapCenter}
        zoomLevel={mapZoom}
        padding={mapPadding}
        selectedMarkerId={selectedPlaceId}
        deletingMarkerId={deletingMarker?.id}
        onMarkerPress={handleMarkerPress}
        showUserLocation={locationStatus === 'granted'}
      />

      <TopBlurFade />
      <TopNav
        onNavigatePress={handleLocatePress}
        topMode={topMode}
        onTopModeChange={setTopMode}
        showTopMode={activeTab === TAB_PLACES}
        onAvatarPress={handleAccountPress}
      />

      <View style={styles.pagerViewport} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.pager,
            {
              width: pagerWidth * tabOrder.length,
              transform: [{ translateX: pagerTranslateX }],
            },
          ]}
          pointerEvents="box-none"
        >
          <View style={{ width: pagerWidth, flex: 1, height: '100%' }}>
            {Platform.OS !== 'ios' ? (
              <HomePanel
                activeTab={TAB_PLACES}
                snapGroup={HOME_PANEL_SNAP_GROUP}
                visible={panelVisible && activeTab === TAB_PLACES}
                onHeightChange={panelVisible && activeTab === TAB_PLACES ? handlePanelHeightChange : undefined}
                onSearchPress={handleSearchPress}
                onDeleteInitiated={handleDeleteInitiated}
              />
            ) : null}
          </View>
          <View style={{ width: pagerWidth, flex: 1, height: '100%' }}>
            {Platform.OS !== 'ios' ? (
              <HomePanel
                activeTab={TAB_PLAN}
                snapGroup={HOME_PANEL_SNAP_GROUP}
                visible={panelVisible}
                onHeightChange={panelVisible && activeTab === TAB_PLAN ? handlePanelHeightChange : undefined}
              />
            ) : null}
          </View>
          <View style={{ width: pagerWidth, flex: 1, height: '100%' }}>
            <View style={styles.profilePage}>
              <Text style={styles.profileTitle}>Profile</Text>
              <Text style={styles.profileSubtitle}>Your profile is coming soon.</Text>
            </View>
          </View>
        </Animated.View>
      </View>

      {Platform.OS === 'ios' &&
      (activeTab === TAB_PLACES || activeTab === TAB_PLAN) ? (
        <HomePanel
          activeTab={activeTab}
          topMode={topMode}
          snapGroup={HOME_PANEL_SNAP_GROUP}
          visible={mainSheetVisible}
          onHeightChange={mainSheetVisible ? handlePanelHeightChange : undefined}
          onDismissed={handleMainSheetDismissed}
          onSearchPress={handleSearchPress}
          onDeleteInitiated={handleDeleteInitiated}
          bottomBar={effectiveTabBarVisible ? (
            <HomeTabBar
              activeTab={activeTab}
              onTabChange={handleTabChange}
              onAddPress={handleAddPress}
              onChatPress={handleChatPress}
              bottomOffset={0}
            />
          ) : undefined}
        />
      ) : null}

      <AIChatBox
        key={
          standaloneChatVisible
            ? `atlas-ai-standalone-${standaloneChatKey}`
            : (activeHistoryItem?.id ?? 'atlas-ai-empty')
        }
        places={standaloneChatVisible ? [] : (activeHistoryItem?.places ?? parsedPlaces)}
        onClose={() => {
          setStandaloneChatVisible(false);
          setActiveHistoryItem(null);
          setActiveSidekick('none');
          animateToTab(TAB_PLACES);
        }}
        onOpenHistory={onOpenChatHistory}
        onNewChat={handleNewChat}
        showLanding={standaloneChatVisible}
        title={standaloneChatVisible ? undefined : activeHistoryItem?.title}
        visible={chatPresented}
        conversationId={standaloneChatVisible ? null : (activeHistoryItem?.id ?? null)}
      />

      {/* Native tab bar — fades out when overlay features request it */}
      <Animated.View
        style={{ opacity: tabBarOpacity }}
        pointerEvents={rootTabBarVisible ? 'box-none' : 'none'}
      >
        <HomeTabBar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onAddPress={handleAddPress}
          onChatPress={handleChatPress}
        />
      </Animated.View>

      <AccountModal visible={accountOpen} onClose={() => setAccountOpen(false)} />

      {/* Full-screen overlays — driven by HomeContext, above everything */}

      {/* Search Panel */}
      {overlay.kind === 'search' && (
        <SearchPanel onClose={() => setOverlay({ kind: 'none' })} />
      )}

      {overlay.kind === 'debug' && (
        <DebugPanel onClose={() => setOverlay({ kind: 'none' })} />
      )}

      {/* CreatePlan full-screen overlay — triggered by "Add to plan" from SaveScreen.
          Stays mounted underneath the AddPlace overlay when AddPlace was opened
          from within the wizard (returnTo.kind === 'createPlan'), so returning
          from AddPlace doesn't remount CreatePlan and trigger its mount-time
          reset() — see CreatePlan.tsx. */}
      {(overlay.kind === 'createPlan' || (overlay.kind === 'addPlace' && overlay.returnTo?.kind === 'createPlan')) && (
        <View style={StyleSheet.absoluteFill}>
          <CreatePlan
            onClose={() => {
              setOverlay({ kind: 'none' });
              // Clear parsed places so map resets to default markers
              setParsedPlaces([]);
            }}
            onPlanCreated={(plan: SavedPlan) => {
              setOverlay({ kind: 'planDetail', planId: plan.id });
            }}
            reportScrollY={() => {}}
          />
        </View>
      )}

      <PlaceDetail
        placeId={overlay.kind === 'placeDetail' ? overlay.placeId : null}
        onDismiss={() => setOverlay(overlay.kind === 'placeDetail' ? (overlay.returnTo ?? { kind: 'none' }) : { kind: 'none' })}
        onEdit={(place) => {
          if (__DEV__) console.log('[HomeScreen] Edit place:', place.name);
        }}
        snapGroup={HOME_PANEL_SNAP_GROUP}
        onHeightChange={overlay.kind === 'placeDetail' ? handlePanelHeightChange : undefined}
      />

      <PlanDetail
        planId={overlay.kind === 'planDetail' ? overlay.planId : null}
        onDismiss={() => setOverlay({ kind: 'none' })}
      />

      <AtlasDetail
        atlasId={overlay.kind === 'atlasDetail' ? overlay.atlasId : null}
        onDismiss={() => setOverlay({ kind: 'none' })}
        snapGroup={HOME_PANEL_SNAP_GROUP}
        onHeightChange={overlay.kind === 'atlasDetail' ? handlePanelHeightChange : undefined}
      />

      <AddPlace
        visible={overlay.kind === 'addPlace'}
        onDismiss={() => setOverlay(overlay.kind === 'addPlace' ? (overlay.returnTo ?? { kind: 'none' }) : { kind: 'none' })}
        onSelect={(places) => {
          if (overlay.kind !== 'addPlace') return;
          overlay.onSelect(places);
          setOverlay(overlay.returnTo ?? { kind: 'none' });
        }}
        snapGroup={HOME_PANEL_SNAP_GROUP}
        onHeightChange={overlay.kind === 'addPlace' ? handlePanelHeightChange : undefined}
        excludeIds={overlay.kind === 'addPlace' ? overlay.excludeIds : undefined}
      />
    </View>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  pager: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  pagerViewport: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  profilePage: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: 112,
    paddingHorizontal: 28,
  },
  profileTitle: {
    color: '#09090B',
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  profileSubtitle: {
    marginTop: 10,
    color: '#8E8E93',
    fontSize: 16,
    lineHeight: 22,
  },
});
