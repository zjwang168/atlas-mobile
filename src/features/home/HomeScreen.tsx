import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, StatusBar, StyleSheet, Text, View } from 'react-native';

import TopNav from '../../components/top-nav/TopNav';
import TopBlurFade from '../../components/ui/top-blur-fade';
import type { SavedPlace } from '../../services/place/placeService';
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

const HOME_PANEL_SNAP_GROUP = 'home-main';
const CONTINENTAL_US_BOUNDS = { ne: [-66.9, 49.4] as [number, number], sw: [-124.85, 24.4] as [number, number] };
const ATLAS_PANEL_CAMERA_CLEARANCE = 32;
// Approximate settle time of ContentPanel's snap spring (damping 22 / stiffness
// 200 / mass 0.9) — see below for why the map's padding recompute waits this long
// after a group snap change instead of reacting immediately.
const PANEL_SPRING_SETTLE_DELAY = 380;

// ---- Types ----

interface HomeScreenProps {
  onOpenImport?: () => void;
  onOpenChatHistory?: () => void;
}

// ---- Helpers ----

const toMapMarkersFromSaved = (places: SavedPlace[]): MapMarker[] =>
  places.map((p) => ({
    id: p.id,
    latitude: p.latitude,
    longitude: p.longitude,
    title: p.name,
    description: p.subtitle,
  }));

// ---- Root export — HomeProvider is now in App.tsx ----

export default function HomeScreen({ onOpenImport, onOpenChatHistory }: HomeScreenProps) {
  return (
    <HomeScreenContent
      onOpenImport={onOpenImport}
      onOpenChatHistory={onOpenChatHistory}
    />
  );
}

// ---- Inner component — consumes the context ----

function HomeScreenContent({ onOpenImport, onOpenChatHistory }: HomeScreenProps) {
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
    savedPlaces,
    atlasMapState,
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
  const tabBarOpacity = useRef(new Animated.Value(1)).current;
  const pagerTranslateX = useRef(new Animated.Value(0)).current;
  const pagerWidth = useMemo(() => Dimensions.get('window').width, []);

  const [activeTab, setActiveTab] = useState<string>(TAB_PLACES);
  const [standaloneChatVisible, setStandaloneChatVisible] = useState(false);
  const [chatPresentationVisible, setChatPresentationVisible] = useState(false);
  const [standaloneChatKey, setStandaloneChatKey] = useState(0);
  const [homePanelVisible, setHomePanelVisible] = useState(true);
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
    return savedMarkers;
  }, [atlasMapState, savedMarkers]);

  // 动态 zoom 级别
  const mapZoom = useMemo(() => {
    if (atlasMapState?.zoomLevel) return atlasMapState.zoomLevel;
    if (selectedPlaceCoordinate) return 15;
    return 12;
  }, [atlasMapState?.zoomLevel, selectedPlaceCoordinate]);

  const panelVisible = overlay.kind === 'none' || overlay.kind === 'search';
  const historyChatRequested = activeSidekick === 'aiChat' && panelVisible;
  const chatRequested = standaloneChatVisible || historyChatRequested;
  const chatVisible = chatPresentationVisible;
  const effectiveTabBarVisible = tabBarVisible && !chatVisible;

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
      toValue: effectiveTabBarVisible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [effectiveTabBarVisible, tabBarOpacity]);

  useEffect(() => {
    if (activeHistoryItem) {
      setStandaloneChatVisible(false);
    }
  }, [activeHistoryItem]);

  // Any bottom panel that should push the map center up — the main pager panel,
  // the PlaceDetail overlay, the AtlasDetail overlay, or the AddPlace overlay —
  // drives the same padding-tracking path.
  const bottomPanelActive = (panelVisible && homePanelVisible) || overlay.kind === 'placeDetail' || overlay.kind === 'atlasDetail' || overlay.kind === 'addPlace';
  // Tracks the live panel height without React state — the panel reports it every
  // animation frame while dragging/snapping, and nothing else needs to reactively
  // read it, so pushing it through setState would re-render the whole screen 60x/sec.
  const bottomPanelHeightRef = useRef(SNAP_HEIGHTS[settledPanelSnapState]);
  const mapRef = useRef<MapboxMapHandle>(null);
  // Recomputed whenever the active bottom panel toggles OR its resolved snap state
  // changes, so a discrete camera recenter (e.g. selecting a different marker while
  // the panel is at a non-default snap height) uses padding matching the panel's
  // *current* height instead of a frozen default — this still goes through
  // MapboxMap's prop-driven, animated camera path so hiding/showing the panel eases
  // the map padding smoothly. Per-frame drag tracking stays on the ref-based path below.
  const mapPadding = useMemo(() => ({
    paddingTop: 0,
    paddingBottom: bottomPanelActive ? SNAP_HEIGHTS[settledPanelSnapState] + (atlasMapState ? ATLAS_PANEL_CAMERA_CLEARANCE : 0) : 0,
    paddingLeft: 0,
    paddingRight: 0,
  }), [atlasMapState, bottomPanelActive, settledPanelSnapState]);
  useEffect(() => {
    bottomPanelHeightRef.current = mapPadding.paddingBottom;
  }, [mapPadding]);
  // Per-frame panel height updates — pushed straight to the map's camera via ref,
  // bypassing React re-render entirely.
  const handlePanelHeightChange = useCallback((height: number) => {
    bottomPanelHeightRef.current = height;
    mapRef.current?.setPaddingBottom(bottomPanelActive ? height + (atlasMapState ? ATLAS_PANEL_CAMERA_CLEARANCE : 0) : 0);
  }, [atlasMapState, bottomPanelActive]);

  const handleAddPress = useCallback(() => {
    onOpenImport?.();
  }, [onOpenImport]);
  const handleChatPress = useCallback(() => {
    setStandaloneChatVisible(true);
  }, []);
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
  const handleSearchPress = useCallback(() => {
    setOverlay({ kind: 'search' });
  }, [setOverlay]);

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
        cameraAnimationDurationMs={atlasMapState ? 2000 : selectedPlaceId ? 450 : 1200}
        bounds={overlay.kind === 'createPlan' ? CONTINENTAL_US_BOUNDS : atlasMapState?.bounds}
        padding={mapPadding}
        routeGeoJSON={atlasMapState?.routeGeoJSON}
        selectedMarkerId={atlasMapState?.selectedMarkerId ?? selectedPlaceId}
        onMarkerPress={atlasMapState?.onMarkerPress ?? handleMarkerPress}
        onMapPress={atlasMapState?.onMapPress ?? handleHomeMapPress}
        compassEnabled={!atlasMapState}
        markerPopup={atlasMapState?.markerPopup}
      />

      <TopBlurFade />
      <TopNav onSearchPress={handleSearchPress} hideSearchButton={Boolean(atlasMapState?.hideTopSearchButton)} />

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
            <HomePanel
              activeTab={TAB_PLACES}
              snapGroup={HOME_PANEL_SNAP_GROUP}
              visible={panelVisible && homePanelVisible}
              onHeightChange={panelVisible && activeTab === TAB_PLACES ? handlePanelHeightChange : undefined}
            />
          </View>
          <View style={{ width: pagerWidth, flex: 1, height: '100%' }}>
            <HomePanel
              activeTab={TAB_PLAN}
              snapGroup={HOME_PANEL_SNAP_GROUP}
              visible={panelVisible && homePanelVisible}
              onHeightChange={panelVisible && activeTab === TAB_PLAN ? handlePanelHeightChange : undefined}
            />
          </View>
          <View style={{ width: pagerWidth, flex: 1, height: '100%' }}>
            <View style={styles.profilePage}>
              <Text style={styles.profileTitle}>Profile</Text>
              <Text style={styles.profileSubtitle}>Your profile is coming soon.</Text>
            </View>
          </View>
        </Animated.View>
      </View>

      {atlasMapState?.overlay}

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
        visible={chatVisible}
        conversationId={standaloneChatVisible ? null : (activeHistoryItem?.id ?? null)}
      />

      {/* Native tab bar — fades out when overlay features request it */}
      <Animated.View
        style={{ opacity: tabBarOpacity }}
        pointerEvents={effectiveTabBarVisible ? 'box-none' : 'none'}
      >
        <HomeTabBar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onAddPress={handleAddPress}
          onChatPress={handleChatPress}
        />
      </Animated.View>

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
        onEdit={(place) => console.log('[HomeScreen] Edit place:', place.name)}
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
