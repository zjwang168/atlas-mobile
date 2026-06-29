import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';

import { mockPlaces } from '../../../mock-data/mockPlaces';
import { ChatMessage, GeocodedLocation, ParseResult } from '../../types/route';
import BottomBar from '../../components/bottom-nav/BottomBar';
import TopNav from '../../components/top-nav/TopNav';
import PlaceDetail from '../place-detail/PlaceDetail';
import MapboxMap, { MapMarker } from '../map/MapboxMap';
import HomePanel from './HomePanel';
import AddPlace from '../add-place/AddPlace';
import type { PlannedPlace } from '../create-plan/plan-place/types';

// ---- Types ----

interface PlaceData {
  id: string;
  name: string;
  subtitle: string;
  latitude: number;
  longitude: number;
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

const uid = (): string => `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

function formatDistanceSummary(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m total`;
  if (km < 10) return `${km.toFixed(1)} km total`;
  return `${Math.round(km)} km total`;
}

// ---- Component ----

interface HomeScreenProps {
  /** Opens the ImportScreen overlay — passed down from App.tsx */
  onOpenImport?: () => void;
}

const HomeScreen: React.FC<HomeScreenProps> = ({ onOpenImport }) => {
  const defaultMarkers = useMemo(() => toMapMarkers(mockPlaces), []);

  const [selectedPlaceName, setSelectedPlaceName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'myPlaces' | 'travelPlan'>('myPlaces');
  const [showAddPlace, setShowAddPlace] = useState(false);
  const addPlaceCallbackRef = useRef<((places: PlannedPlace[]) => void) | null>(null);

  function handleOpenAddPlace(onSelect: (places: PlannedPlace[]) => void) {
    addPlaceCallbackRef.current = onSelect;
    setShowAddPlace(true);
  }

  function handleAddPlaceSelect(places: PlannedPlace[]) {
    addPlaceCallbackRef.current?.(places);
    addPlaceCallbackRef.current = null;
    setShowAddPlace(false);
  }

  // Parse-route flow state — populated by PlanMode when a link is submitted
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Fetching post...');
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const hasRouteData = parseResult !== null && parseResult.locations.length > 0;

  const routeGeoJSON = useMemo(() => {
    if (!parseResult?.route.ordered_locations.length) return undefined;
    return toRouteGeoJSON(parseResult.route.ordered_locations);
  }, [parseResult]);

  const routeMarkers = useMemo(() => {
    if (!parseResult?.route.ordered_locations.length) return undefined;
    return toRouteMarkers(parseResult.route.ordered_locations);
  }, [parseResult]);

  // Center camera on the mean of all route points
  const routeCenter = useMemo((): [number, number] | undefined => {
    if (!parseResult?.route.ordered_locations.length) return undefined;
    const locs = parseResult.route.ordered_locations;
    const avgLat = locs.reduce((s, l) => s + l.latitude, 0) / locs.length;
    const avgLng = locs.reduce((s, l) => s + l.longitude, 0) / locs.length;
    return [avgLng, avgLat];
  }, [parseResult]);

  /** Follow-up message handler passed to PlanMode */
  const handleSendMessage = useCallback(
    async (text: string) => {
      const userMsg: ChatMessage = { id: uid(), role: 'user', text, timestamp: Date.now() };
      setMessages((prev) => [...prev, userMsg]);

      // MVP auto-reply — real AI follow-up handled in PlanMode
      const autoReply: ChatMessage = {
        id: uid(),
        role: 'assistant',
        text: `I found ${parseResult?.locations.length ?? 0} places. View them on the map, or paste another link to start over.`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, autoReply]);
    },
    [parseResult],
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* Full-screen map — sits behind all panels */}
      <MapboxMap
        markers={defaultMarkers}
        centerCoordinate={routeCenter ?? [-122.3321, 47.6062]}
        zoomLevel={hasRouteData ? 10 : 12}
        routeGeoJSON={routeGeoJSON}
        routeMarkers={routeMarkers}
        onMarkerPress={(marker) => setSelectedPlaceName(marker.title ?? null)}
      />

      {/* Top nav — avatar left, search/globe/navigate right */}
      <TopNav />

      {/* Bottom content panel — hidden while place detail is open */}
      <HomePanel
        activeTab={activeTab}
        parseResult={parseResult}
        isLoading={isLoading}
        loadingMessage={loadingMessage}
        messages={messages}
        onSendMessage={handleSendMessage}
        error={error}
        onPlacePress={(place) => setSelectedPlaceName(place.name)}
        visible={selectedPlaceName === null && !showAddPlace}
        onOpenAddPlace={handleOpenAddPlace}
      />

      {/* Place detail overlay — slides up when a place is selected */}
      <PlaceDetail
        placeName={selectedPlaceName}
        onDismiss={() => setSelectedPlaceName(null)}
        onEdit={(place) => console.log('[HomeScreen] Edit place:', place.name)}
      />

      {/* Add place panel — slides up from HomeScreen level, fading out HomePanel */}
      <AddPlace
        visible={showAddPlace}
        onDismiss={() => setShowAddPlace(false)}
        onSelect={handleAddPlaceSelect}
      />

      {/* Tab bar + add-place button — always on top */}
      <BottomBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onAddPlace={onOpenImport}
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
});

export default HomeScreen;
