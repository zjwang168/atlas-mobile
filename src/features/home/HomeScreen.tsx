import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Platform, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import TopNav, { type TopMode } from '../../components/top-nav/TopNav';
import TopBlurFade from '../../components/ui/top-blur-fade';
import type { SavedPlace } from '../../services/place/placeService';
import MapboxMap, { MapboxMapHandle, MapMarker } from '../map/MapboxMap';
import { SNAP_HEIGHTS } from '../../components/content-panel/ContentPanel';
import { useContentPanelSnapGroup } from '../../components/content-panel/ContentPanelSnapProvider';
import AddPlace from '../add-place/AddPlace';
import CreatePlan from '../my-plan/create-plan/CreatePlan';
import type { SavedPlan } from '../my-plan/create-plan/savePlan';
import { EventDetail } from '../event-detail/EventDetail';
import PlanDetail from '../my-plan/plan-detail/PlanDetail';
import PlaceDetail from '../place-detail/PlaceDetail';
import AtlasDetail from '../my-places/atlas/atlas-detail/AtlasDetail';
import AIChatBox from '../atlas-ai/ai-chat/AIChatBox';
import DebugPanel from '@/dev/DebugPanel';
import { useAppDialog } from '@/components/feedback/AppDialog';
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
import ProfileSettings from '../profile/ProfileSettings';
import { isSanFranciscoLocationTestEnabled } from '@/services/location/locationService';

const HOME_PANEL_SNAP_GROUP = 'home-main';
const CONTINENTAL_US_BOUNDS = { ne: [-66.9, 49.4] as [number, number], sw: [-124.85, 24.4] as [number, number] };
// Approximate settle time of ContentPanel's snap spring (damping 22 / stiffness
// 200 / mass 0.9) — see below for why the map's padding recompute waits this long
// after a group snap change instead of reacting immediately.
const PANEL_SPRING_SETTLE_DELAY = 380;
const SHEET_OVERLAY_HANDOFF_DELAY = 360;
const SHEET_DISMISS_FALLBACK_DELAY = 750;
const IOS_HOME_SHEET_SHORT_FRACTION = 0.30;
const IOS_HOME_SHEET_DEFAULT_FRACTION = 0.60;
const IOS_HOME_SHEET_TALL_FRACTION = 0.94;
// Treat the map as still centered on the user while its camera is within
// roughly one city block of the current GPS coordinate.
const USER_CENTER_TOLERANCE_DEGREES = 0.0008;

// ---- Types ----

interface HomeScreenProps {
  onOpenImport?: () => void;
  onOpenChatHistory?: () => void;
  externalOverlayVisible?: boolean;
  chatHistoryExitRequest?: number;
}

// ---- Helpers ----

const toMapMarkersFromSaved = (places: SavedPlace[]): MapMarker[] =>
  places.map((p) => ({
    id: p.id,
    latitude: p.latitude,
    longitude: p.longitude,
    title: p.special_role ? p.special_role[0].toUpperCase() + p.special_role.slice(1) : p.name,
    description: p.subtitle,
    tone: p.special_role ?? 'saved',
  }));

// ---- Root export — HomeProvider is now in App.tsx ----

export default function HomeScreen({
  onOpenImport,
  onOpenChatHistory,
  externalOverlayVisible = false,
  chatHistoryExitRequest = 0,
}: HomeScreenProps) {
  return (
    <HomeScreenContent
      onOpenImport={onOpenImport}
      onOpenChatHistory={onOpenChatHistory}
      externalOverlayVisible={externalOverlayVisible}
      chatHistoryExitRequest={chatHistoryExitRequest}
    />
  );
}

// ---- Inner component — consumes the context ----

function HomeScreenContent({
  onOpenImport,
  onOpenChatHistory,
  externalOverlayVisible = false,
  chatHistoryExitRequest = 0,
}: HomeScreenProps) {
  const { show: showDialog } = useAppDialog();
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
    atlasMapState,
  } = useHome();
  const [groupSnapState, setGroupSnapState] = useContentPanelSnapGroup(HOME_PANEL_SNAP_GROUP, 'default');
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
  const [isMapCenteredOnUser, setIsMapCenteredOnUser] = useState(true);
  const [accountOpen, setAccountOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [standaloneChatVisible, setStandaloneChatVisible] = useState(false);
  const [chatPresentationVisible, setChatPresentationVisible] = useState(false);
  const [chatMapOpen, setChatMapOpen] = useState(false);
  const [standaloneChatKey, setStandaloneChatKey] = useState(0);
  const [standaloneChatPrompt, setStandaloneChatPrompt] = useState<string | null>(null);
  const [chatPresented, setChatPresented] = useState(false);
  const [mainSheetPaused, setMainSheetPaused] = useState(false);
  const pendingSheetActionRef = useRef<(() => void) | null>(null);
  const pendingSheetFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabOrder = useMemo(() => [TAB_PLACES, TAB_PLAN, TAB_PROFILE], []);

  // The home map and My Places list deliberately share one source of truth.
  const mapCenter = useMemo(() => {
    if (atlasMapState?.centerCoordinate) return atlasMapState.centerCoordinate;
    if (selectedPlaceCoordinate) return selectedPlaceCoordinate;
    if (userLocation) return userLocation;
    return [-122.3321, 47.6062] as [number, number];
  }, [atlasMapState?.centerCoordinate, selectedPlaceCoordinate, userLocation]);

  // savedPlaces 常驻标记
  const savedMarkers = useMemo(
    () => toMapMarkersFromSaved(savedPlaces),
    [savedPlaces],
  );

  const mapMarkers = useMemo(() => {
    if (atlasMapState) return atlasMapState.markers;
    if (!isSanFranciscoLocationTestEnabled) return savedMarkers;
    return [{
      id: 'test-user-location',
      longitude: userLocation[0],
      latitude: userLocation[1],
      title: 'You',
      tone: 'location' as const,
      pulsing: true,
      alwaysShowLabel: true,
    }, ...savedMarkers];
  }, [atlasMapState, savedMarkers, userLocation]);

  // 动态 zoom 级别
  const mapZoom = useMemo(() => {
    if (atlasMapState?.zoomLevel) return atlasMapState.zoomLevel;
    if (selectedPlaceCoordinate) return 15;
    return 12;
  }, [atlasMapState?.zoomLevel, selectedPlaceCoordinate]);

  const panelVisible = !chatMapOpen && (overlay.kind === 'none' || overlay.kind === 'search');
  const historyChatRequested = activeSidekick === 'aiChat' && (panelVisible || chatMapOpen);
  const chatRequested = standaloneChatVisible || historyChatRequested;
  const chatVisible = chatPresentationVisible && !chatMapOpen;
  const effectiveTabBarVisible = tabBarVisible && !chatVisible && !chatMapOpen;
  // On iOS the persistent native sheet owns the only visible tab bar.
  // Keeping the React Native copy hidden prevents it flashing through while
  // the sheet hands off to Add, Chat, or Account overlays.
  const rootTabBarVisible = Platform.OS !== 'ios' && effectiveTabBarVisible;
  const mainSheetVisible =
    Platform.OS === 'ios' &&
    overlay.kind === 'none' &&
    !externalOverlayVisible &&
    !chatMapOpen &&
    !chatVisible &&
    !accountOpen &&
    !authOpen &&
    !mainSheetPaused &&
    (activeTab === TAB_PLACES || activeTab === TAB_PLAN);

  useEffect(() => {
    if (
      !externalOverlayVisible &&
      !chatVisible &&
      !accountOpen &&
      !authOpen &&
      overlay.kind === 'none'
    ) {
      setMainSheetPaused(false);
    }
  }, [accountOpen, authOpen, chatVisible, externalOverlayVisible, overlay.kind]);

  const finishMainSheetHandoff = useCallback(() => {
    if (pendingSheetFallbackRef.current) {
      clearTimeout(pendingSheetFallbackRef.current);
      pendingSheetFallbackRef.current = null;
    }
    const pendingAction = pendingSheetActionRef.current;
    pendingSheetActionRef.current = null;
    if (pendingAction) {
      pendingAction();
      return;
    }
    setMainSheetPaused(false);
  }, []);

  const presentAboveMainSheet = useCallback((action: () => void) => {
    if (Platform.OS !== 'ios' || !mainSheetVisible) {
      action();
      return;
    }

    pendingSheetActionRef.current = action;
    setMainSheetPaused(true);
    // Native sheet dismissal normally invokes onDismiss. Some interrupted
    // presentations do not deliver that callback; complete the handoff rather
    // than leaving every sheet and navigation control hidden above the map.
    pendingSheetFallbackRef.current = setTimeout(
      finishMainSheetHandoff,
      SHEET_DISMISS_FALLBACK_DELAY,
    );
  }, [finishMainSheetHandoff, mainSheetVisible]);

  const handleMainSheetDismissed = useCallback(() => {
    finishMainSheetHandoff();
  }, [finishMainSheetHandoff]);

  useEffect(() => () => {
    if (pendingSheetFallbackRef.current) clearTimeout(pendingSheetFallbackRef.current);
  }, []);

  useEffect(() => {
    if (!chatRequested) {
      setChatPresentationVisible(false);
      setChatMapOpen(false);
      return;
    }
    // Import handoffs already animate their own result sheet away. Showing the
    // chat surface in the next frame prevents an intermediate My Places frame.
    setActiveTab(TAB_CHAT);
    const timeoutId = setTimeout(() => setChatPresentationVisible(true), 16);
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
  const bottomPanelActive = mainPanelActive || overlay.kind === 'placeDetail' || overlay.kind === 'eventDetail' || overlay.kind === 'atlasDetail' || overlay.kind === 'addPlace';
  const nativeMainPanelActive =
    Platform.OS === 'ios' &&
    mainSheetVisible &&
    (activeTab === TAB_PLACES || activeTab === TAB_PLAN);
  const settledBottomPanelHeight = nativeMainPanelActive
    ? settledPanelSnapState === 'short'
      ? screenHeight * IOS_HOME_SHEET_SHORT_FRACTION
      : settledPanelSnapState === 'tall'
        ? screenHeight * IOS_HOME_SHEET_TALL_FRACTION
        : screenHeight * IOS_HOME_SHEET_DEFAULT_FRACTION
    : SNAP_HEIGHTS[settledPanelSnapState];
  // SwiftUI's fractional detent is resolved inside the presentation
  // container, so its real on-screen height can differ from
  // `screenHeight * fraction` by a few points. Preserve the live measured
  // height when the detent settles instead of replacing it with that estimate.
  const liveNativePanelHeightRef = useRef(
    screenHeight * IOS_HOME_SHEET_DEFAULT_FRACTION,
  );
  // The home map follows only the short and default native-sheet detents.
  // A large sheet still reports `tall` for its own content/scroll behavior,
  // but must not push the map beyond the default (60%) camera position.
  const mapFollowingPanelHeight = nativeMainPanelActive
    ? liveNativePanelHeightRef.current
    : settledBottomPanelHeight;
  const atlasCameraVerticalOffset = atlasMapState?.cameraVerticalOffset ?? 0;
  const lockAtlasCameraToScreen = Boolean(atlasMapState?.lockCameraToScreen);
  // Tracks the live panel height without React state — the panel reports it every
  // animation frame while dragging/snapping, and nothing else needs to reactively
  // read it, so pushing it through setState would re-render the whole screen 60x/sec.
  const bottomPanelHeightRef = useRef(settledBottomPanelHeight);
  const atlasMapStateRef = useRef(atlasMapState);
  atlasMapStateRef.current = atlasMapState;
  const mapRef = useRef<MapboxMapHandle>(null);
  // Recomputed whenever the active bottom panel toggles OR its resolved snap state
  // changes, so a discrete camera recenter (e.g. selecting a different marker while
  // the panel is at a non-default snap height) uses padding matching the panel's
  // *current* height instead of a frozen default — this still goes through
  // MapboxMap's prop-driven, animated camera path so hiding/showing the panel eases
  // the map padding smoothly. Per-frame drag tracking stays on the ref-based path below.
  const mapPadding = useMemo(() => ({
    paddingTop: 0,
    // The agreed formula: HJ's settledBottomPanelHeight, because the native
    // sheet's detents are screen fractions rather than SNAP_HEIGHTS, plus
    // Jay's atlasCameraVerticalOffset. Either side alone breaks the other's
    // camera. Math.max(0, …) is Jay's — the offset can be negative.
    paddingBottom: bottomPanelActive && !lockAtlasCameraToScreen
      ? Math.max(0, mapFollowingPanelHeight + atlasCameraVerticalOffset)
      : 0,
    paddingLeft: 0,
    paddingRight: 0,
  }), [atlasCameraVerticalOffset, bottomPanelActive, lockAtlasCameraToScreen, mapFollowingPanelHeight]);
  useEffect(() => {
    bottomPanelHeightRef.current = mapPadding.paddingBottom;
  }, [mapPadding]);
  // Per-frame panel height updates — pushed straight to the map's camera via ref,
  // bypassing React re-render entirely.
  const handlePanelHeightChange = useCallback((height: number) => {
    if (nativeMainPanelActive) {
      liveNativePanelHeightRef.current = height;
    }
    bottomPanelHeightRef.current = height;
    const currentAtlasMapState = atlasMapStateRef.current;
    // Bounds-owned Atlas cameras must only be moved by fitBounds. A native
    // padding-only setCamera call after fitBounds can replace its calculated
    // zoom with the Camera's previous state.
    if (!currentAtlasMapState?.lockCameraToScreen && !currentAtlasMapState?.bounds) {
      const verticalOffset = currentAtlasMapState?.cameraVerticalOffset ?? 0;
      mapRef.current?.setPaddingBottom(
        bottomPanelActive ? Math.max(0, height + verticalOffset) : 0,
        currentAtlasMapState?.smoothPanelCameraFollow ? undefined : 0,
      );
    }
    currentAtlasMapState?.onPanelHeightChange?.(height);
  }, [bottomPanelActive, nativeMainPanelActive]);

  // A panel may already be resting when the Atlas overlay mounts, so its
  // height listener is not guaranteed to emit an initial frame. Seed the
  // popup position from the current snap height immediately.
  useEffect(() => {
    if (!atlasMapState?.onPanelHeightChange || !bottomPanelActive) return;
    const panelHeight = Math.max(0, mapPadding.paddingBottom - atlasCameraVerticalOffset);
    atlasMapState.onPanelHeightChange(panelHeight);
  }, [atlasCameraVerticalOffset, atlasMapState?.onPanelHeightChange, bottomPanelActive, mapPadding.paddingBottom]);

  const handleAddPress = useCallback(() => {
    if (!onOpenImport) return;
    // Add Places is a fresh browsing flow. Do not carry a previously selected
    // saved/special place (especially School) into its camera state.
    setSelectedPlaceId(null);
    setSelectedPlaceCoordinate(null);
    presentAboveMainSheet(() => {
      onOpenImport();
    });
  }, [onOpenImport, presentAboveMainSheet, setSelectedPlaceCoordinate, setSelectedPlaceId]);
  const handleChatPress = useCallback(() => {
    presentAboveMainSheet(() => {
      setStandaloneChatPrompt(null);
      setStandaloneChatVisible(true);
      setChatPresented(true);
    });
  }, [presentAboveMainSheet]);
  const handleChatVoiceTranscript = useCallback((text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    presentAboveMainSheet(() => {
      setActiveHistoryItem(null);
      setActiveSidekick('none');
      setStandaloneChatPrompt(prompt);
      setStandaloneChatKey((current) => current + 1);
      setStandaloneChatVisible(true);
      setChatPresented(true);
    });
  }, [presentAboveMainSheet, setActiveHistoryItem, setActiveSidekick]);
  const handleChatVoiceError = useCallback((message: string) => {
    showDialog({ title: 'Voice input unavailable', message, tone: 'warning' });
  }, [showDialog]);
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
  useEffect(() => {
    if (chatHistoryExitRequest > 0) animateToTab(TAB_PLACES);
  }, [animateToTab, chatHistoryExitRequest]);
  const handleTabChange = useCallback((tab: string) => {
    animateToTab(tab);
  }, [animateToTab]);
  const handlePlanExit = useCallback(() => {
    animateToTab(TAB_PLACES);
  }, [animateToTab]);
  const nativeBottomBar = useMemo(() => (
    effectiveTabBarVisible ? (
      <HomeTabBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onAddPress={handleAddPress}
        onChatPress={handleChatPress}
        onChatVoiceTranscript={handleChatVoiceTranscript}
        onChatVoiceError={handleChatVoiceError}
      />
    ) : undefined
  ), [activeTab, effectiveTabBarVisible, handleAddPress, handleChatPress, handleChatVoiceError, handleChatVoiceTranscript, handleTabChange]);

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
    setIsMapCenteredOnUser(true);
    mapRef.current?.flyTo(coordinate);
  }, [refreshUserLocation]);

  const handleHomeViewportChanged = useCallback((center: [number, number]) => {
    const isCentered =
      Math.abs(center[0] - userLocation[0]) <= USER_CENTER_TOLERANCE_DEGREES &&
      Math.abs(center[1] - userLocation[1]) <= USER_CENTER_TOLERANCE_DEGREES;
    setIsMapCenteredOnUser(isCentered);
  }, [userLocation]);

  const handleMarkerPress = useCallback((marker: MapMarker) => {
    setSelectedPlaceId(marker.id);
    setSelectedPlaceCoordinate([marker.longitude, marker.latitude]);
  }, [setSelectedPlaceId, setSelectedPlaceCoordinate]);

  const handleHomeMapPress = useCallback(() => {
    setSelectedPlaceId(null);
  }, [setSelectedPlaceId]);

  useEffect(() => {
    if (!selectedPlaceId || savedPlaces.some((place) => place.id === selectedPlaceId)) return;
    setSelectedPlaceId(null);
    setSelectedPlaceCoordinate(null);
  }, [savedPlaces, selectedPlaceId, setSelectedPlaceCoordinate, setSelectedPlaceId]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* Single full-screen map behind everything */}
      <MapboxMap
        ref={mapRef}
        markers={mapMarkers}
        centerCoordinate={mapCenter}
        zoomLevel={mapZoom}
        cameraKey={atlasMapState?.cameraKey}
        cameraAnimationDurationMs={atlasMapState?.cameraAnimationDurationMs ?? (atlasMapState ? 1500 : selectedPlaceId ? 450 : 1200)}
        resetCameraOrientation={atlasMapState?.resetCameraOrientation}
        bounds={overlay.kind === 'createPlan' ? CONTINENTAL_US_BOUNDS : atlasMapState?.bounds}
        padding={mapPadding}
        minimumBoundsZoom={atlasMapState?.minimumBoundsZoom}
        disableRecommendedClustering={atlasMapState?.disableRecommendedClustering}
        cameraScreenOffsetY={atlasMapState?.cameraScreenOffsetY}
        routeGeoJSON={atlasMapState?.routeGeoJSON}
        routeVariant={atlasMapState?.routeVariant}
        routeDistanceLabels={atlasMapState?.routeDistanceLabels}
        // An Atlas owns the map selection while it is active. In particular,
        // `null` is meaningful here: it prevents a previously selected Saved
        // Place from being carried into an Atlas as a seemingly random pin.
        selectedMarkerId={atlasMapState ? atlasMapState.selectedMarkerId ?? null : selectedPlaceId}
        deletingMarkerId={atlasMapState?.deletingMarkerId}
        onMarkerPress={atlasMapState?.onMarkerPress ?? handleMarkerPress}
        onMapPress={atlasMapState?.onMapPress ?? handleHomeMapPress}
        onViewportChanged={atlasMapState?.onViewportChanged ?? handleHomeViewportChanged}
        onBoundsCameraApplied={atlasMapState?.onBoundsCameraApplied}
        // HJ turned the compass off outright; their `!atlasMapState` would
        // bring it back on the home map.
        compassEnabled={false}
        markerPopup={atlasMapState?.markerPopup}
        showUserLocation={locationStatus === 'granted' && !isSanFranciscoLocationTestEnabled}
      />

      {!atlasMapState?.hideChrome ? (
        <>
          <TopBlurFade />
          <TopNav
            onNavigatePress={handleLocatePress}
            isCenteredOnUser={isMapCenteredOnUser}
            topMode={topMode}
            onTopModeChange={setTopMode}
            showTopMode={activeTab === TAB_PLACES && !atlasMapState}
            onAvatarPress={handleAccountPress}
          />
        </>
      ) : null}

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
                onExitPlan={handlePlanExit}
                isActive={activeTab === TAB_PLAN}
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
          onExitPlan={handlePlanExit}
          isActive={activeTab === TAB_PLAN}
          bottomBar={nativeBottomBar}
        />
      ) : null}

      {/* Atlas draws its own controls above the shared map, never inside a
          panel — see AtlasMapState.overlay. */}
      {atlasMapState?.overlay}

      <AIChatBox
        key={
          standaloneChatVisible
            ? `atlas-ai-standalone-${standaloneChatKey}`
            : (activeHistoryItem?.id ?? 'atlas-ai-empty')
        }
        places={standaloneChatVisible ? [] : (activeHistoryItem?.places ?? parsedPlaces)}
        onClose={() => {
          setChatMapOpen(false);
          setStandaloneChatVisible(false);
          setActiveHistoryItem(null);
          setActiveSidekick('none');
          animateToTab(TAB_PLACES);
        }}
        initialPrompt={standaloneChatVisible ? standaloneChatPrompt : null}
        autoSendInitialPrompt={Boolean(standaloneChatVisible && standaloneChatPrompt)}
        onOpenHistory={() => {
          // Chat history is mounted by AppContent, outside this screen. The
          // full-screen chat surface has a higher local z-index, so leave it
          // before opening history instead of rendering the sheet beneath it.
          setChatMapOpen(false);
          setChatPresentationVisible(false);
          setStandaloneChatVisible(false);
          setActiveSidekick('none');
          onOpenChatHistory?.();
        }}
        showLanding={standaloneChatVisible}
        title={standaloneChatVisible ? undefined : activeHistoryItem?.title}
        visible={chatPresented}
        conversationId={
          standaloneChatVisible
            ? null
            : (activeHistoryItem?.sessionInitializing ? null : (activeHistoryItem?.id ?? null))
        }
        importWelcome={standaloneChatVisible ? null : (activeHistoryItem?.importWelcome ?? null)}
        initialImportWelcome={standaloneChatVisible ? null : (activeHistoryItem?.initialImportWelcome ?? null)}
        initialWelcomeText={standaloneChatVisible ? null : (activeHistoryItem?.initialWelcomeText ?? null)}
        initialSessionId={standaloneChatVisible ? null : (activeHistoryItem?.initialSessionId ?? null)}
        sessionInitializing={standaloneChatVisible ? false : Boolean(activeHistoryItem?.sessionInitializing)}
        atlasWelcome={standaloneChatVisible ? null : (activeHistoryItem?.atlasWelcome ?? null)}
        onPresentationMapOpen={() => setChatMapOpen(true)}
        onPresentationMapReturn={() => setChatMapOpen(false)}
        onPresentationMapClose={() => {
          setChatMapOpen(false);
          setStandaloneChatVisible(false);
          setActiveHistoryItem(null);
          setActiveSidekick('none');
          animateToTab(TAB_PLACES);
        }}
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
          onChatVoiceTranscript={handleChatVoiceTranscript}
          onChatVoiceError={handleChatVoiceError}
        />
      </Animated.View>

      <ProfileSettings
        visible={accountOpen}
        onClose={() => setAccountOpen(false)}
        onRequestSignIn={() => setAuthOpen(true)}
      />
      <AccountModal visible={authOpen} onClose={() => setAuthOpen(false)} />

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
        onDismiss={() => {
          const next = overlay.kind === 'placeDetail'
            ? (overlay.returnTo ?? { kind: 'none' as const })
            : { kind: 'none' as const };
          // A PlaceDetail dragged to 'full' leaves 'full' in the shared snap group,
          // which the home panel then inherits. The home panel's resting height is
          // 'default', so reset the group when dismissing back to it — panels that
          // hand off to another overlay keep the group as-is.
          if (next.kind === 'none') setGroupSnapState('default');
          setOverlay(next);
        }}
        onEdit={(place) => {
          if (__DEV__) console.log('[HomeScreen] Edit place:', place.name);
        }}
        snapGroup={HOME_PANEL_SNAP_GROUP}
        onHeightChange={overlay.kind === 'placeDetail' ? handlePanelHeightChange : undefined}
      />

      <EventDetail
        event={overlay.kind === 'eventDetail' ? overlay.event : null}
        onDismiss={() => {
          const next = overlay.kind === 'eventDetail'
            ? (overlay.returnTo ?? { kind: 'none' as const })
            : { kind: 'none' as const };
          // Same shared-snap-group reset as PlaceDetail above.
          if (next.kind === 'none') setGroupSnapState('default');
          setOverlay(next);
        }}
        snapGroup={HOME_PANEL_SNAP_GROUP}
        onHeightChange={overlay.kind === 'eventDetail' ? handlePanelHeightChange : undefined}
      />

      <PlanDetail
        planId={overlay.kind === 'planDetail' ? overlay.planId : null}
        onDismiss={() => setOverlay({ kind: 'none' })}
      />

      <AtlasDetail
        atlasId={overlay.kind === 'atlasDetail' ? overlay.atlasId : null}
        onDismiss={() => {
          setOverlay({ kind: 'none' });
          animateToTab(TAB_PLACES);
        }}
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
