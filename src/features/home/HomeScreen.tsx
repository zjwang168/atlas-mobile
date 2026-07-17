import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, StatusBar, StyleSheet, View } from 'react-native';

import TopNav from '../../components/top-nav/TopNav';
import TopBlurFade from '../../components/ui/top-blur-fade';
import type { ParsedPlace } from '../../services/import/importService';
import type { SavedPlace } from '../../services/place/placeService';
import MapboxMap, { MapboxMapHandle, MapMarker } from '../map/MapboxMap';
import AddPlaceToPlan from '../my-plan/add-place-to-plan/AddPlaceToPlan';
import CreatePlan from '../my-plan/create-plan/CreatePlan';
import type { SavedPlan } from '../my-plan/create-plan/savePlan';
import PlanDetail from '../my-plan/plan-detail/PlanDetail';
import PlaceDetail from '../place-detail/PlaceDetail';
import AIChatBox from '../atlas-ai/ai-chat/AIChatBox';
import DebugPanel from '@/dev/DebugPanel';
import { useHome } from './HomeContext';
import HomePanel from './HomePanel';
import HomeTabBar, { TAB_PLACES, TAB_PLAN } from './HomeTabBar';
import SearchPanel from '../search/SearchPanel';

// ---- Types ----

interface HomeScreenProps {
  onOpenImport?: () => void;
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

export default function HomeScreen({ onOpenImport }: HomeScreenProps) {
  return <HomeScreenContent onOpenImport={onOpenImport} />;
}

// ---- Inner component — consumes the context ----

function HomeScreenContent({ onOpenImport }: HomeScreenProps) {
  const {
    overlay,
    setOverlay,
    tabBarVisible,
    chatHistory,
    setChatHistory,
    parsedPlaces,
    setParsedPlaces,
    refreshSavedPlaces,
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
  } = useHome();
  const tabBarOpacity = useRef(new Animated.Value(1)).current;
  const pagerTranslateX = useRef(new Animated.Value(0)).current;
  const pagerWidth = useMemo(() => Dimensions.get('window').width, []);

  useEffect(() => {
    Animated.timing(tabBarOpacity, {
      toValue: tabBarVisible ? 1 : 0,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [tabBarVisible]);

  const [activeTab, setActiveTab] = useState<string>(TAB_PLACES);
  const tabOrder = useMemo(() => [TAB_PLACES, TAB_PLAN], []);

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
    if (hasParsedPlaces) return parsedMarkers;
    return savedMarkers;
  }, [savedMarkers, parsedMarkers, hasParsedPlaces]);

  // 动态 zoom 级别
  const mapZoom = useMemo(() => {
    if (selectedPlaceCoordinate) return 15;
    if (hasParsedPlaces) return 10;
    return 12;
  }, [selectedPlaceCoordinate, hasParsedPlaces]);

  // 地图 padding：当 ContentPanel 可见时补偿底部高度
  const contentPanelHeight = useMemo(() => {
    // 根据屏幕高度估算 ContentPanel 的 default snap 高度 (55%)
    return Dimensions.get('window').height * 0.55;
  }, []);
  const panelVisible = overlay.kind === 'none' || overlay.kind === 'search';
  // Tracks the live panel height without React state — the panel reports it every
  // animation frame while dragging/snapping, and nothing else needs to reactively
  // read it, so pushing it through setState would re-render the whole screen 60x/sec.
  const bottomPanelHeightRef = useRef(contentPanelHeight);
  const mapRef = useRef<MapboxMapHandle>(null);
  // Only recomputed when panel visibility toggles (a rare, discrete event) — this
  // still goes through MapboxMap's prop-driven, animated camera path so hiding/
  // showing the panel eases the map padding smoothly.
  const mapPadding = useMemo(() => ({
    paddingTop: 0,
    paddingBottom: panelVisible ? bottomPanelHeightRef.current : 0,
    paddingLeft: 0,
    paddingRight: 0,
  }), [panelVisible]);
  // Per-frame panel height updates — pushed straight to the map's camera via ref,
  // bypassing React re-render entirely.
  const handlePanelHeightChange = useCallback((height: number) => {
    bottomPanelHeightRef.current = height;
    mapRef.current?.setPaddingBottom(panelVisible ? height : 0);
  }, [panelVisible]);

  const handleAddPress = useCallback(() => {
    onOpenImport?.();
  }, [onOpenImport]);
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

  // --- PlaceDetail back handler ---
  const handlePlaceDetailBack = useCallback(() => {
    setOverlay({ kind: 'none' });
    setSelectedPlaceCoordinate(null);
    setSelectedPlaceId(null);
  }, [setOverlay, setSelectedPlaceCoordinate, setSelectedPlaceId]);

  const handleMarkerPress = useCallback((marker: MapMarker) => {
    setSelectedPlaceId(marker.id);
    setSelectedPlaceCoordinate([marker.longitude, marker.latitude]);
  }, [setSelectedPlaceId, setSelectedPlaceCoordinate]);

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
        onMarkerPress={handleMarkerPress}
      />

      <TopBlurFade />
      <TopNav onSearchPress={handleSearchPress} />

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
              visible={panelVisible}
              onHeightChange={handlePanelHeightChange}
            />
          </View>
          <View style={{ width: pagerWidth, flex: 1, height: '100%' }}>
            <HomePanel
              activeTab={TAB_PLAN}
              visible={panelVisible}
              onHeightChange={handlePanelHeightChange}
            />
          </View>
        </Animated.View>
      </View>

      <AIChatBox
        key={activeHistoryItem?.id ?? 'atlas-ai-empty'}
        places={activeHistoryItem?.places ?? parsedPlaces}
        onClose={() => {
          setActiveHistoryItem(null);
          setParsedPlaces([]);
          setSelectedPlaceCoordinate(null);
          setSelectedPlaceId(null);
          setActiveSidekick('none');
        }}
        title={activeHistoryItem?.title}
        visible={activeSidekick === 'aiChat' && panelVisible}
        onHeightChange={handlePanelHeightChange}
        conversationId={activeHistoryItem?.id ?? null}
        onPlacesCommitted={(newPlaces) => {
          const currentItem = activeHistoryItem;
          if (!currentItem) return;

          const existing = currentItem.places ?? [];
          const merged = [...existing];
          newPlaces.forEach((place) => {
            const duplicate = merged.some(
              (item) =>
                item.name === place.name &&
                Math.abs(item.latitude - place.latitude) < 0.0002 &&
                Math.abs(item.longitude - place.longitude) < 0.0002,
            );
            if (!duplicate) merged.push(place);
          });

          const nextItem = {
            ...currentItem,
            places: merged,
            locationCount: merged.length,
          };
          setActiveHistoryItem(nextItem);
          setParsedPlaces(merged);
          setSelectedPlaceCoordinate([merged[0].longitude, merged[0].latitude]);
          setChatHistory(chatHistory.map((item) => (item.id === nextItem.id ? nextItem : item)));
          refreshSavedPlaces().catch((error) => {
            console.warn('[HomeScreen] refreshSavedPlaces after chat commit failed:', error);
          });
        }}
      />

      {/* Native tab bar — fades out when overlay features request it */}
      <Animated.View
        style={{ opacity: tabBarOpacity }}
        pointerEvents={tabBarVisible ? 'box-none' : 'none'}
      >
        <HomeTabBar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onAddPress={handleAddPress}
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

      {/* CreatePlan full-screen overlay — triggered by "Add to plan" from SaveScreen */}
      {overlay.kind === 'createPlan' && (
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
        placeName={overlay.kind === 'placeDetail' ? overlay.placeName : null}
        onDismiss={() => {
          setOverlay({ kind: 'none' });
          setSelectedPlaceCoordinate(null);
          setSelectedPlaceId(null);
        }}
        onBack={handlePlaceDetailBack}
        onEdit={(place) => console.log('[HomeScreen] Edit place:', place.name)}
      />

      <PlanDetail
        planId={overlay.kind === 'planDetail' ? overlay.planId : null}
        onDismiss={() => setOverlay({ kind: 'none' })}
      />

      <AddPlaceToPlan
        visible={overlay.kind === 'addPlaceToPlan'}
        onDismiss={() => setOverlay({ kind: 'none' })}
        onSelect={(places) => {
          if (overlay.kind === 'addPlaceToPlan') overlay.onSelect(places);
          setOverlay({ kind: 'none' });
        }}
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
});
