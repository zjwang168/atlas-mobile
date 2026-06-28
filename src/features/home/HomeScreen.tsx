import React, { useCallback, useMemo, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { Tabs } from 'react-native-screens';

import AddMenu from '../../components/add-menu/AddMenu';
import { mockPlaces } from '../../../mock-data/mockPlaces';

// Phosphor tab icons — template PNGs so they tint with tabBarTintColor.
// Outline (regular) when unselected, fill when selected.
const ICON_PLACES = require('../../../assets/tabs/tab-places.png');
const ICON_PLACES_FILL = require('../../../assets/tabs/tab-places-fill.png');
const ICON_PLAN = require('../../../assets/tabs/tab-plan.png');
const ICON_PLAN_FILL = require('../../../assets/tabs/tab-plan-fill.png');
// "+" — single state, rendered as-is (always dark) via imageSource.
const ICON_ADD = require('../../../assets/tabs/tab-add.png');
import { mockUser } from '../../../mock-data/mockUser';
import { ChatMessage, GeocodedLocation, ParseResult } from '../../types/route';
import TopNav from '../../components/top-nav/TopNav';
import PlaceDetail from '../place-detail/PlaceDetail';
import MapboxMap, { MapMarker } from '../map/MapboxMap';
import ContentPanel from '../../components/content-panel/ContentPanel';
import MyPlaces from '../my-places/MyPlaces';
import MyPlan from '../my-plan/MyPlan';
import { CREATE_PLAN_HEIGHT } from '../create-plan/CreatePlan';

// ---- Types ----

interface PlaceData {
  id: string;
  name: string;
  subtitle: string;
  latitude: number;
  longitude: number;
}

interface HomeScreenProps {
  onOpenImport?: () => void;
}

// Tab identifiers — must match the `screenKey` on each Tabs.Screen.
const TAB_PLACES = 'myPlaces';
const TAB_PLAN = 'travelPlan';
const TAB_ADD = 'add';

// ---- Helpers ----

const toMapMarkers = (places: PlaceData[]): MapMarker[] =>
  places.map((p) => ({
    id: p.id,
    latitude: p.latitude,
    longitude: p.longitude,
    title: p.name,
    description: p.subtitle,
  }));

const toRouteMarkers = (locations: GeocodedLocation[]): MapMarker[] =>
  locations.map((loc, i) => ({
    id: `route-${i}`,
    latitude: loc.latitude,
    longitude: loc.longitude,
    title: loc.name,
    description: loc.full_address,
  }));

const toRouteGeoJSON = (
  locations: GeocodedLocation[],
): GeoJSON.Feature<GeoJSON.LineString> => ({
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'LineString',
    coordinates: locations.map((loc) => [loc.longitude, loc.latitude]),
  },
});

// ---- Component ----

const HomeScreen: React.FC<HomeScreenProps> = ({ onOpenImport }) => {
  const defaultMarkers = useMemo(() => toMapMarkers(mockPlaces), []);

  const [selectedPlaceName, setSelectedPlaceName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>(TAB_PLACES);
  // Provenance of the last navigation state acknowledged by the native side.
  const [provenance, setProvenance] = useState(0);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  // Parse-route flow state
  const [parseResult] = useState<ParseResult | null>(null);

  const hasRouteData = parseResult !== null && parseResult.locations.length > 0;

  const routeGeoJSON = useMemo(() => {
    if (!parseResult?.route.ordered_locations.length) return undefined;
    return toRouteGeoJSON(parseResult.route.ordered_locations);
  }, [parseResult]);

  const routeMarkers = useMemo(() => {
    if (!parseResult?.route.ordered_locations.length) return undefined;
    return toRouteMarkers(parseResult.route.ordered_locations);
  }, [parseResult]);

  const routeCenter = useMemo((): [number, number] | undefined => {
    if (!parseResult?.route.ordered_locations.length) return undefined;
    const locs = parseResult.route.ordered_locations;
    const avgLat = locs.reduce((s, l) => s + l.latitude, 0) / locs.length;
    const avgLng = locs.reduce((s, l) => s + l.longitude, 0) / locs.length;
    return [avgLng, avgLat];
  }, [parseResult]);

  // Native tab selection — accept the new state and remember its provenance.
  // Guard TAB_ADD: it should never become the active screen — it only opens the menu.
  const handleTabSelected = useCallback((e: any) => {
    const { selectedScreenKey, provenance: p } = e.nativeEvent;
    setProvenance(p);
    if (selectedScreenKey === TAB_ADD) {
      setAddMenuOpen(true);
    } else {
      setActiveTab(selectedScreenKey);
    }
  }, []);

  // "+" tab has preventNativeSelection — its tap fires this instead of navigating.
  const handleTabSelectionPrevented = useCallback(() => {
    setAddMenuOpen(true);
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      <Tabs.Host
        navStateRequest={{ selectedScreenKey: activeTab, baseProvenance: provenance }}
        onTabSelected={handleTabSelected}
        onTabSelectionPrevented={handleTabSelectionPrevented}
        ios={{ tabBarMinimizeBehavior: 'onScrollDown', tabBarTintColor: '#12C170' }}
      >
        {/* My Places */}
        <Tabs.Screen
          screenKey={TAB_PLACES}
          title="My Places"
          ios={{
            icon: { type: 'templateSource', templateSource: ICON_PLACES },
            selectedIcon: { type: 'templateSource', templateSource: ICON_PLACES_FILL },
          }}
        >
          <View style={styles.screen}>
            <MapboxMap
              markers={defaultMarkers}
              centerCoordinate={[-122.3321, 47.6062]}
              zoomLevel={12}
              onMarkerPress={(marker) => setSelectedPlaceName(marker.title ?? null)}
            />
            <ContentPanel
              initialSnap="default"
              zIndex={30}
              visible={selectedPlaceName === null}
              compactContent={() => (
                <MyPlaces
                  compact
                  avatarUri={mockUser.avatarUri}
                  avatarFallback={mockUser.avatarFallback}
                />
              )}
            >
              {({ reportScrollY }) => (
                <MyPlaces
                  onPlacePress={(place) => setSelectedPlaceName(place.name)}
                  onScroll={reportScrollY}
                  avatarUri={mockUser.avatarUri}
                  avatarFallback={mockUser.avatarFallback}
                />
              )}
            </ContentPanel>
          </View>
        </Tabs.Screen>

        {/* My Plan */}
        <Tabs.Screen
          screenKey={TAB_PLAN}
          title="My Plan"
          ios={{
            icon: { type: 'templateSource', templateSource: ICON_PLAN },
            selectedIcon: { type: 'templateSource', templateSource: ICON_PLAN_FILL },
          }}
        >
          <View style={styles.screen}>
            <MapboxMap
              markers={routeMarkers ?? defaultMarkers}
              centerCoordinate={routeCenter ?? [-122.3321, 47.6062]}
              zoomLevel={hasRouteData ? 10 : 12}
              routeGeoJSON={routeGeoJSON}
              routeMarkers={routeMarkers}
              onMarkerPress={(marker) => setSelectedPlaceName(marker.title ?? null)}
            />
            <ContentPanel
              initialSnap="default"
              zIndex={30}
              visible={selectedPlaceName === null}
              defaultSnapHeight={isCreatingPlan ? CREATE_PLAN_HEIGHT : undefined}
              compactContent={() => <MyPlan compact />}
            >
              {({ reportScrollY }) => (
                <MyPlan
                  onScroll={reportScrollY}
                  onCreateModeChange={setIsCreatingPlan}
                />
              )}
            </ContentPanel>
          </View>
        </Tabs.Screen>

        {/* "+" — search role positions it as a separate trailing circle and
            pushes the main pill to the left. The plus icon overrides the system
            search glyph. preventNativeSelection keeps it from navigating; the
            tap opens the RN pop-up menu instead. */}
        <Tabs.Screen
          screenKey={TAB_ADD}
          title="Add"
          preventNativeSelection
          ios={{ systemItem: 'search', icon: { type: 'imageSource', imageSource: ICON_ADD } }}
        >
          <View style={styles.screen} />
        </Tabs.Screen>
      </Tabs.Host>

      {/* "+" pop-up menu — RN overlay above the native tab controller */}
      <AddMenu
        visible={addMenuOpen}
        onClose={() => setAddMenuOpen(false)}
        onImportPlaces={() => {
          setAddMenuOpen(false);
          onOpenImport?.();
        }}
        onChatWithAI={() => {
          setAddMenuOpen(false);
          setActiveTab(TAB_PLAN);
        }}
      />

      {/* Overlays — RN siblings rendered above the native tab controller */}
      <TopNav />
      <PlaceDetail
        placeName={selectedPlaceName}
        onDismiss={() => setSelectedPlaceName(null)}
        onEdit={(place) => console.log('[HomeScreen] Edit place:', place.name)}
      />
    </View>
  );
};

// ---- Styles ----

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  screen: {
    flex: 1,
  },
});

export default HomeScreen;
