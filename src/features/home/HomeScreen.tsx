import React, { useCallback, useMemo, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';

import { mockPlaces } from '../../../mock-data/mockPlaces';
import { ChatMessage, GeocodedLocation, ParseResult } from '../../types/route';
import BottomBar from '../../components/bottom-nav/BottomBar';
import TopNav from '../../components/top-nav/TopNav';
import PlaceDetail from '../place-detail/PlaceDetail';
import MapboxMap, { MapMarker } from '../map/MapboxMap';
import HomePanel from './HomePanel';
import AddPlace from '../add-place/AddPlace';
import { HomeProvider, useHome } from './HomeContext';

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

// ---- Root export — just provides the context ----

interface HomeScreenProps {
  onOpenImport?: () => void;
}

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

  const [activeTab, setActiveTab] = useState<'myPlaces' | 'travelPlan'>('myPlaces');

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

  const routeCenter = useMemo((): [number, number] | undefined => {
    if (!parseResult?.route.ordered_locations.length) return undefined;
    const locs = parseResult.route.ordered_locations;
    const avgLat = locs.reduce((s, l) => s + l.latitude, 0) / locs.length;
    const avgLng = locs.reduce((s, l) => s + l.longitude, 0) / locs.length;
    return [avgLng, avgLat];
  }, [parseResult]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      const userMsg: ChatMessage = { id: uid(), role: 'user', text, timestamp: Date.now() };
      setMessages((prev) => [...prev, userMsg]);
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

      <MapboxMap
        markers={defaultMarkers}
        centerCoordinate={routeCenter ?? [-122.3321, 47.6062]}
        zoomLevel={hasRouteData ? 10 : 12}
        routeGeoJSON={routeGeoJSON}
        routeMarkers={routeMarkers}
        onMarkerPress={(marker) =>
          setOverlay({ kind: 'placeDetail', placeName: marker.title ?? '' })
        }
      />

      <TopNav />

      <HomePanel
        activeTab={activeTab}
        parseResult={parseResult}
        isLoading={isLoading}
        loadingMessage={loadingMessage}
        messages={messages}
        onSendMessage={handleSendMessage}
        error={error}
      />

      <PlaceDetail
        placeName={overlay.kind === 'placeDetail' ? overlay.placeName : null}
        onDismiss={() => setOverlay({ kind: 'none' })}
        onEdit={(place) => console.log('[HomeScreen] Edit place:', place.name)}
      />

      <AddPlace
        visible={overlay.kind === 'addPlace'}
        onDismiss={() => setOverlay({ kind: 'none' })}
        onSelect={(places) => {
          if (overlay.kind === 'addPlace') overlay.onSelect(places);
          setOverlay({ kind: 'none' });
        }}
      />

      <BottomBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onAddPlace={onOpenImport}
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
