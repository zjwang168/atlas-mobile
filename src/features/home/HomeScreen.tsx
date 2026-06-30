// src/features/home/HomeScreen.tsx
import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { mockPlaces } from '../../data/mockPlaces';
import { chat, getConversation, getConversations, parseLink } from '../../services/apiService';
import {
  ChatMessage,
  Conversation,
  GeocodedLocation,
  ParseResult,
  ParseResultV2,
} from '../../types/route';
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

  // v2 Agentic session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);

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
      const result = await parseLink(url) as ParseResultV2;
      setParseResult(result);

      // Store session_id if returned (v2 agentic pipeline)
      if (result.session_id) {
        setSessionId(result.session_id);
      }

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

  /** Send a follow-up message to the agent backend */
  const handleChat = useCallback(async (message: string) => {
    if (!sessionId) return;

    setIsLoading(true);
    try {
      const result = await chat({ session_id: sessionId, message });

      // Add assistant response to messages
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        text: result.response,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);

      // Update locations/route if modified by agent
      if (result.locations) {
        setParseResult(prev => prev ? {
          ...prev,
          locations: result.locations!,
          route: result.route || prev.route,
        } : prev);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

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

  /** Toggle the conversation history panel */
  const toggleHistory = useCallback(async () => {
    if (!showHistory) {
      // Load conversations
      try {
        const convs = await getConversations();
        setConversations(convs);
      } catch (err) {
        console.error('Failed to load conversations:', err);
      }
    }
    setShowHistory(!showHistory);
  }, [showHistory]);

  /** Load a saved conversation from history */
  const loadConversation = useCallback(async (convId: string) => {
    try {
      const detail = await getConversation(convId);
      // Restore session
      setSessionId(detail.session.session_id);
      // Restore locations and route
      const restoredResult: ParseResult = {
        title: detail.session.title,
        locations: detail.session.locations,
        route: detail.session.route || {
          ordered_locations: detail.session.locations,
          total_distance_km: 0,
          segments: [],
        },
        removed_noise: null,
      };
      setParseResult(restoredResult);
      // Restore messages
      setMessages(detail.messages.map((m: any) => ({
        id: m.id || uid(),
        role: m.role,
        text: m.content,
        timestamp: typeof m.timestamp === 'number' ? m.timestamp : Date.now(),
      })));
      setShowHistory(false);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  /** Delete a location by index and update map markers */
  const handleDeleteLocation = useCallback((index: number) => {
    if (!parseResult) return;

    const newLocations = [...parseResult.locations];
    newLocations.splice(index, 1);

    // Also remove from route ordered_locations
    const newRoute = { ...parseResult.route };
    if (newRoute.ordered_locations) {
      newRoute.ordered_locations = newRoute.ordered_locations.filter(
        (_, i) => i !== index,
      );
    }

    setParseResult({
      ...parseResult,
      locations: newLocations,
      route: newRoute,
    });
  }, [parseResult]);

  /** Save a location (placeholder for MVP — logs to console) */
  const handleSaveLocation = useCallback(async (location: GeocodedLocation) => {
    // For MVP: just log it
    console.log('Save location:', location.name);
    // TODO: Integrate with collections feature
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* Search bar floating at top */}
      <SearchBar
        onSend={handleSend}
        isLoading={isLoading}
        onHistoryPress={toggleHistory}
      />

      {/* History panel */}
      {showHistory && (
        <View style={styles.historyPanel}>
          <Text style={styles.historyTitle}>Conversation History</Text>
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.historyItem}
                onPress={() => loadConversation(item.id)}
              >
                <Text style={styles.historyItemTitle}>{item.title || 'Untitled'}</Text>
                <Text style={styles.historyItemMeta}>
                  {item.location_count} places · {item.message_count} messages
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

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
        onChat={sessionId ? handleChat : undefined}
        sessionId={sessionId}
        error={error}
        onDeleteLocation={handleDeleteLocation}
        onSaveLocation={handleSaveLocation}
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
  historyPanel: {
    position: 'absolute',
    top: 80,
    left: 10,
    right: 10,
    maxHeight: 300,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    zIndex: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  historyItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  historyItemTitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  historyItemMeta: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
});

export default HomeScreen;
