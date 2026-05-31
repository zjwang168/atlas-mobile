// src/features/home/HomeScreen.tsx
import React, { useCallback, useMemo, useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet
} from 'react-native';

import { mockPlaces } from '../../data/mockPlaces';
import { parseLink } from '../../services/apiService';
import { ChatMessage, GeocodedLocation, ParseResult } from '../../types/route';
import MapboxMap, { MapMarker } from '../map/MapboxMap';
import SearchBar from './SearchBar';
import Sidekick from './Sidekick';

// ---- Types ----

/** Represents a place data item from mock data */
interface PlaceData {
  id: string;
  name: string;
  subtitle: string;
  latitude: number;
  longitude: number;
}

// ---- Helpers ----

/**
 * Converts PlaceData items into MapMarker format
 * expected by the MapboxMap component.
 */
const toMapMarkers = (places: PlaceData[]): MapMarker[] =>
  places.map((place) => ({
    id: place.id,
    latitude: place.latitude,
    longitude: place.longitude,
    title: place.name,
    description: place.subtitle,
  }));

/** Convert ordered geocoded locations into MapMarker format */
const toRouteMarkers = (locations: GeocodedLocation[]): MapMarker[] =>
  locations.map((loc, index) => ({
    id: `route-${index}`,
    latitude: loc.latitude,
    longitude: loc.longitude,
    title: loc.name,
    description: loc.full_address,
  }));

/** Convert ordered locations into a GeoJSON LineString for route rendering */
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

/** Generate a unique chat message ID */
const uid = (): string => `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

/** Format distance in km for readable display */
function formatDistanceSummary(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m total`;
  if (km < 10) return `${km.toFixed(1)} km total`;
  return `${Math.round(km)} km total`;
}

// ---- Component ----

interface HomeScreenProps {
  /** Optional callback to open the ImportScreen overlay (used by App.tsx) */
  onOpenImport?: () => void;
}

const HomeScreen: React.FC<HomeScreenProps> = ({ onOpenImport }) => {
  // Transform mock data into map markers
  const defaultMarkers: MapMarker[] = useMemo(() => toMapMarkers(mockPlaces), []);

  // State for parse/fetch flow
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Fetching Reddit post...');
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Track whether we have active route data to display
  const hasRouteData = parseResult !== null && parseResult.locations.length > 0;

  // Compute route display props
  const routeGeoJSON = useMemo(() => {
    if (!parseResult?.route.ordered_locations.length) return undefined;
    return toRouteGeoJSON(parseResult.route.ordered_locations);
  }, [parseResult]);

  const routeMarkers = useMemo(() => {
    if (!parseResult?.route.ordered_locations.length) return undefined;
    return toRouteMarkers(parseResult.route.ordered_locations);
  }, [parseResult]);

  // Compute camera target from route locations (center of first and last point)
  const routeCenter = useMemo((): [number, number] | undefined => {
    if (!parseResult?.route.ordered_locations.length) return undefined;
    const locs = parseResult.route.ordered_locations;
    const latSum = locs.reduce((s, l) => s + l.latitude, 0);
    const lngSum = locs.reduce((s, l) => s + l.longitude, 0);
    const avgLat = latSum / locs.length;
    const avgLng = lngSum / locs.length;
    return [avgLng, avgLat];
  }, [parseResult]);

  /** Handle URL submission from the SearchBar */
  const handleSend = useCallback(async (url: string) => {
    setIsLoading(true);
    setError(null);
    setMessages([]);

    // Animate through loading messages
    const loadingSteps = [
      'Fetching Reddit post...',
      'AI analyzing locations...',
      'Geocoding places...',
      'Planning best route...',
    ];
    let stepIndex = 0;
    const interval = setInterval(() => {
      stepIndex = (stepIndex + 1) % loadingSteps.length;
      setLoadingMessage(loadingSteps[stepIndex]);
    }, 2000);

    try {
      const result = await parseLink(url);
      setParseResult(result);

      // Add system message with the result
      const sysMsg: ChatMessage = {
        id: uid(),
        role: 'system',
        text: `Found ${result.locations.length} places from "${result.title}". Route distance: ${result.route.total_distance_km} km.`,
        timestamp: Date.now(),
      };

      // Add an assistant message with summary
      let summary = `I extracted **${result.locations.length} places** from this post.\n\n`;
      summary += `**Route**: ${formatDistanceSummary(result.route.total_distance_km)}\n\n`;
      summary += '**Places in order**:\n';
      result.route.ordered_locations.forEach((loc, i) => {
        summary += `${i + 1}. ${loc.name}\n`;
      });

      if (result.removed_noise && result.removed_noise.length > 0) {
        summary += '\n**Filtered out**:\n';
        result.removed_noise.forEach((n) => {
          summary += `• ${n}\n`;
        });
      }

      const assistantMsg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        text: summary,
        timestamp: Date.now(),
      };

      setMessages([sysMsg, assistantMsg]);
    } catch (err: any) {
      const errMsg = err?.message || 'An unexpected error occurred.';
      setError(errMsg);

      const errorMsg: ChatMessage = {
        id: uid(),
        role: 'system',
        text: `⚠️ Error: ${errMsg}`,
        timestamp: Date.now(),
      };
      setMessages([errorMsg]);
    } finally {
      clearInterval(interval);
      setIsLoading(false);
    }
  }, []);

  /** Handle follow-up messages in the Sidekick chat */
  const handleSendMessage = useCallback(
    async (text: string) => {
      // Add user message
      const userMsg: ChatMessage = {
        id: uid(),
        role: 'user',
        text,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // Basic auto-reply for MVP (no separate DeepSeek call from frontend)
      const autoReply: ChatMessage = {
        id: uid(),
        role: 'assistant',
        text: `I found ${parseResult?.locations.length || 0} places. You can view them on the map! Try pasting another Reddit link to explore more.`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, autoReply]);
    },
    [parseResult],
  );

  /** Handle history button press */
  const handleHistoryPress = useCallback(() => {
    // MVP: toggle the bottom sheet to show past results
    // For now, just log. In future: show a history list overlay.
    console.log('[HomeScreen] History pressed');
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* Search bar floating at top */}
      <SearchBar
        onSend={handleSend}
        isLoading={isLoading}
        onHistoryPress={handleHistoryPress}
      />

      {/* Mapbox map filling the entire screen */}
      <MapboxMap
        markers={defaultMarkers}
        centerCoordinate={routeCenter ?? [-122.3321, 47.6062]}
        zoomLevel={hasRouteData ? 10 : 12}
        routeGeoJSON={routeGeoJSON}
        routeMarkers={routeMarkers}
        onMarkerPress={(marker) => {
          console.log('Marker pressed:', marker.title);
          // TODO: Navigate to PlaceDetailScreen
        }}
      />

      {/* Sidekick bottom sheet */}
      <Sidekick
        parseResult={parseResult}
        isLoading={isLoading}
        loadingMessage={loadingMessage}
        messages={messages}
        onSendMessage={handleSendMessage}
        error={error}
      />
    </SafeAreaView>
  );
};

// ---- Styles ----

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
});

export default HomeScreen;
