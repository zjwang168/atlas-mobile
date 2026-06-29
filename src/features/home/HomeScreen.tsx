import React, { useCallback, useMemo, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';

import AddMenu from '../../components/add-menu/AddMenu';
import TopBlurFade from '../../components/ui/top-blur-fade';
import { mockPlaces } from '../../../mock-data/mockPlaces';
import { GeocodedLocation, ParseResult } from '../../types/route';
import TopNav from '../../components/top-nav/TopNav';
import PlaceDetail from '../place-detail/PlaceDetail';
import PlanDetail from '../my-plan/plan-detail/PlanDetail';
import AddPlaceToPlan from '../my-plan/add-place-to-plan/AddPlaceToPlan';
import MapboxMap, { MapMarker } from '../map/MapboxMap';
import { HomeProvider, useHome } from './HomeContext';
import HomeTabBar, { TAB_PLACES, TAB_PLAN } from './HomeTabBar';
import HomePanel from './HomePanel';

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

// ---- Root export — provides the Home context ----

export default function HomeScreen({ onOpenImport }: HomeScreenProps) {
  return (
    <HomeProvider>
      <HomeScreenContent onOpenImport={onOpenImport} />
    </HomeProvider>
  );
}

// ---- Inner component — consumes the context ----

function HomeScreenContent({ onOpenImport }: HomeScreenProps) {
  const { overlay, setOverlay } = useHome();
  const defaultMarkers = useMemo(() => toMapMarkers(mockPlaces), []);

  const [activeTab, setActiveTab] = useState<string>(TAB_PLACES);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  // Parse-route flow state (route rendered on the plan tab map)
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

  const handleTabChange = useCallback((tab: string) => setActiveTab(tab), []);
  const handleAddPress = useCallback(() => setAddMenuOpen(true), []);

  // Map config is driven by route data only — never by which tab is active.
  // This keeps the map reference stable across tab switches so the camera doesn't reset.
  const mapMarkers = routeMarkers ?? defaultMarkers;
  const mapCenter = useMemo<[number, number]>(
    () => routeCenter ?? [-122.3321, 47.6062],
    [routeCenter],
  );
  const mapZoom = hasRouteData ? 10 : 12;

  const panelVisible = overlay.kind === 'none';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* Single full-screen map behind everything */}
      <MapboxMap
        markers={mapMarkers}
        centerCoordinate={mapCenter}
        zoomLevel={mapZoom}
        routeGeoJSON={routeGeoJSON}
        routeMarkers={routeMarkers}
        onMarkerPress={(marker) =>
          setOverlay({ kind: 'placeDetail', placeName: marker.title ?? '' })
        }
      />

      <TopBlurFade />
      <TopNav />

      {/* Single content panel — preserves snap state and scroll position across tab switches */}
      <HomePanel activeTab={activeTab} visible={panelVisible} />

      {/* Native tab bar */}
      <HomeTabBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onAddPress={handleAddPress}
      />

      {/* "+" pop-up menu */}
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

      {/* Full-screen overlays — driven by HomeContext, above everything */}
      <PlaceDetail
        placeName={overlay.kind === 'placeDetail' ? overlay.placeName : null}
        onDismiss={() => setOverlay({ kind: 'none' })}
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
});
