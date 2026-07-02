// src/features/home/HomeScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

import { mockPlaces } from '../../data/mockPlaces';
import { chat, getConversation, getConversations, getMemories, parseLink } from '../../services/apiService';
import {
  ChatMessage,
  Conversation,
  GeocodedLocation,
  MemoryItem,
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
    sentiment: loc.sentiment,
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

  // Force map re-render when new parse result arrives (fixes map not centering)
  const [mapRefreshKey, setMapRefreshKey] = useState(0);

  // Custom center override when user taps a location in the list
  const [customCenter, setCustomCenter] = useState<[number, number] | undefined>(undefined);
  // Custom zoom override when user taps a location
  const [customZoom, setCustomZoom] = useState<number | undefined>(undefined);

  // Selected marker ID for list→map linkage
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);

  // Compute the selected index from marker id (e.g., "route-3" → 3)
  const selectedLocationIndex = selectedMarkerId
    ? parseInt(selectedMarkerId.replace('route-', ''), 10)
    : -1;

  // Sidekick tab state — controlled from HomeScreen for marker→tab switching
  const [sidekickTab, setSidekickTab] = useState<'chat' | 'locations'>('chat');

  // Memory panel state
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);

  // When selectedMarkerId changes (e.g., from map marker tap), switch Sidekick to Locations tab
  useEffect(() => {
    if (selectedMarkerId) {
      setSidekickTab('locations');
    }
  }, [selectedMarkerId]);

  // Track whether we have active route data to display
  const hasRouteData = parseResult !== null && parseResult.locations.length > 0;

  // Check if any locations have negative sentiment (red markers)
  const hasNegativeLocations = parseResult?.locations?.some(
    loc => loc.sentiment === 'negative'
  );

  // Compute route display props
  const routeGeoJSON = useMemo(() => {
    if (!parseResult?.route.ordered_locations.length) return undefined;
    return toRouteGeoJSON(parseResult.route.ordered_locations);
  }, [parseResult]);

  const routeMarkers = useMemo(() => {
    if (!parseResult?.route.ordered_locations.length) return undefined;
    return toRouteMarkers(parseResult.route.ordered_locations);
  }, [parseResult]);

  // Compute camera target — center on the DENSEST cluster of points
  // instead of the geometric average. This avoids centering on empty
  // areas when some locations have wrong coordinates.
  const routeCenter = useMemo((): [number, number] | undefined => {
    if (!parseResult?.route.ordered_locations.length) return undefined;
    const locs = parseResult.route.ordered_locations;

    if (locs.length <= 3) {
      // For few points, use average
      const latSum = locs.reduce((s, l) => s + l.latitude, 0);
      const lngSum = locs.reduce((s, l) => s + l.longitude, 0);
      return [lngSum / locs.length, latSum / locs.length];
    }

    // Grid clustering: divide into ~0.2° x 0.2° cells (~20km at mid-latitudes)
    // Find the cell with the most points, return its center
    const grid: Record<string, { lats: number[]; lngs: number[] }> = {};
    const GRID_SIZE = 0.2;

    for (const loc of locs) {
      const cellX = Math.round(loc.longitude / GRID_SIZE);
      const cellY = Math.round(loc.latitude / GRID_SIZE);
      const key = `${cellX},${cellY}`;
      if (!grid[key]) grid[key] = { lats: [], lngs: [] };
      grid[key].lats.push(loc.latitude);
      grid[key].lngs.push(loc.longitude);
    }

    // Find densest cell
    let maxCount = 0;
    let bestCell = { lats: [0] as number[], lngs: [0] as number[] };
    for (const key of Object.keys(grid)) {
      const count = grid[key].lats.length;
      if (count > maxCount) {
        maxCount = count;
        bestCell = grid[key];
      }
    }

    // Return center of densest cell
    const latSum = bestCell.lats.reduce((s, l) => s + l, 0);
    const lngSum = bestCell.lngs.reduce((s, l) => s + l, 0);
    return [lngSum / bestCell.lngs.length, latSum / bestCell.lats.length];
  }, [parseResult]);

  // Use customCenter if set, otherwise use routeCenter, otherwise default
  const mapCenter = useMemo((): [number, number] => {
  // 1. 确定基础中心点
    const baseCenter = customCenter ?? routeCenter ?? [-122.3321, 47.6062];
    
    // 2. 应用纬度偏移量 (正值向上，负值向下)
    // 这里的 0.005 是偏移量，你可以根据实际效果调整，数值越大，点上移越多
    const LATITUDE_OFFSET = -0.008; 
    
    // 返回 [经度, 纬度 + 偏移量]
    return [baseCenter[0], baseCenter[1] + LATITUDE_OFFSET];
    }, [customCenter, routeCenter]);

  // Use customZoom if set, otherwise use default based on route data
  const mapZoom = customZoom ?? (hasNegativeLocations ? 13 : hasRouteData ? 10 : 12);

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
      setCustomCenter(undefined);
      setCustomZoom(undefined);
      setMapRefreshKey(prev => prev + 1);  // Force map re-render on new result

      // Store session_id if returned (v2 agentic pipeline)
      if (result.session_id) {
        setSessionId(result.session_id);
      }

      // Auto-save to Supabase after successful parse
      if (result.session_id) {
        try {
          const { saveSession } = await import('../../services/apiService');
          await saveSession(result.session_id);
        } catch (err) {
          console.log('[HomeScreen] Auto-save failed (Supabase may not be configured)');
        }
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
      // Reset map to center on the restored conversation's locations
      setCustomCenter(undefined);
      setCustomZoom(undefined);
      setSelectedMarkerId(null);
      setMapRefreshKey(prev => prev + 1);
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

  /** Handle pressing a location in the list — center the map and select the marker */
  const handleLocationPress = useCallback((location: GeocodedLocation) => {
    setCustomCenter([location.longitude, location.latitude]);
    setCustomZoom(13.5);

    // Find the marker index and set it as selected
    if (parseResult?.route.ordered_locations) {
      const markerIndex = parseResult.route.ordered_locations.findIndex(
        l => l.name === location.name
      );
      if (markerIndex >= 0) {
        setSelectedMarkerId(`route-${markerIndex}`);
      }
    }
  }, [parseResult]);

  /** Handle delete a conversation from history */
  const handleDeleteConversation = useCallback(async (convId: string) => {
    try {
      const { deleteConversation } = await import('../../services/apiService');
      await deleteConversation(convId);
      setConversations(prev => prev.filter(c => c.id !== convId));
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  }, []);

  /** Toggle memory panel — load memories from backend */
  const toggleMemoryPanel = useCallback(async () => {
    if (!showMemoryPanel) {
      setLoadingMemories(true);
      try {
        const data = await getMemories();
        setMemories(data.memories || []);
      } catch (err) {
        console.error('Failed to load memories:', err);
      } finally {
        setLoadingMemories(false);
      }
    }
    setShowMemoryPanel(prev => !prev);
  }, [showMemoryPanel]);

  /** Format category for display */
  const categoryEmoji: Record<string, string> = {
    preference: '⭐',
    visited_place: '📍',
    interest: '❤️',
    disliked: '👎',
    plan: '📋',
  };

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
        <>
          {/* Overlay - tap to close */}
          <TouchableOpacity
            style={styles.historyOverlay}
            activeOpacity={1}
            onPress={() => setShowHistory(false)}
          />
          <View style={styles.historyPanel}>
            <Text style={styles.historyTitle}>Conversation History</Text>
            <FlatList
              data={conversations}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.historyItemRow}>
                  <TouchableOpacity
                    style={styles.historyItemContent}
                    onPress={() => loadConversation(item.id)}
                  >
                    <Text style={styles.historyItemTitle}>{item.title || 'Untitled'}</Text>
                    <Text style={styles.historyItemMeta}>
                      {item.location_count} places · {item.message_count} messages
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.historyDeleteButton}
                    onPress={() => handleDeleteConversation(item.id)}
                  >
                    <Text style={styles.historyDeleteText}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          </View>
        </>
      )}

      {/* Memory panel */}
      {showMemoryPanel && (
        <>
          {/* Overlay - tap to close */}
          <TouchableOpacity
            style={styles.memoryOverlay}
            activeOpacity={1}
            onPress={() => setShowMemoryPanel(false)}
          />
          <View style={styles.memoryPanel}>
            <Text style={styles.memoryPanelTitle}>🧠 Long-Term Memory</Text>
            {loadingMemories ? (
              <View style={styles.memoryLoadingContainer}>
                <ActivityIndicator size="small" color="#007AFF" />
                <Text style={styles.memoryLoadingText}>Loading memories...</Text>
              </View>
            ) : memories.length === 0 ? (
              <View style={styles.memoryLoadingContainer}>
                <Text style={styles.memoryEmptyText}>
                  No memories yet.{'\n'}Start exploring to build your travel profile.
                </Text>
              </View>
            ) : (
              <FlatList
                data={memories}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.memoryList}
                renderItem={({ item }) => (
                  <View style={styles.memoryCard}>
                    <View style={styles.memoryCardHeader}>
                      <Text style={styles.memoryCardEmoji}>
                        {categoryEmoji[item.category] || '📌'}
                      </Text>
                      <Text style={styles.memoryCardCategory}>{item.category}</Text>
                    </View>
                    <Text style={styles.memoryCardKey}>{item.key}</Text>
                    <Text style={styles.memoryCardValue}>{item.value}</Text>
                  </View>
                )}
              />
            )}
          </View>
        </>
      )}

      {/* Memory floating button */}
      <TouchableOpacity style={styles.memoryButton} onPress={toggleMemoryPanel}>
        <Text style={styles.memoryButtonIcon}>🧠</Text>
      </TouchableOpacity>

      {/* Mapbox map filling the entire screen */}
      <MapboxMap
        markers={defaultMarkers}
        centerCoordinate={mapCenter}
        zoomLevel={mapZoom}
        routeMarkers={routeMarkers}
        onMarkerPress={(marker) => {
          const sentimentLabels: Record<string, string> = {
            positive: 'Recommended',
            neutral: 'Neutral',
            negative: 'Not Recommended',
          };
          const label = marker.sentiment ? sentimentLabels[marker.sentiment] || 'Unknown' : 'Unrated';
      const address = marker.description ? ` (${marker.description})` : '';
      console.log(`Marker pressed: ${marker.title}${address} Label: ${label}`);
      // TODO: Navigate to PlaceDetailScreen
    }}
    selectedMarkerId={selectedMarkerId}
    onSelectedMarkerChange={setSelectedMarkerId}
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
        onLocationPress={handleLocationPress}
        selectedLocationIndex={selectedLocationIndex >= 0 ? selectedLocationIndex : undefined}
        activeTab={sidekickTab}
        onTabChange={setSidekickTab}
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
  historyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 25,
  },
  historyPanel: {
    position: 'absolute',
    top: 120,
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
  historyItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  historyItemContent: {
    flex: 1,
    paddingVertical: 10,
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
  historyDeleteButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  historyDeleteText: {
    fontSize: 16,
  },

  /* Memory button */
  memoryButton: {
    position: 'absolute',
    top: 120,
    left: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  memoryButtonIcon: {
    fontSize: 20,
  },

  /* Memory panel */
  memoryOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 25,
  },
  memoryPanel: {
    position: 'absolute',
    top: 160,
    left: 10,
    right: 10,
    maxHeight: 400,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    zIndex: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  memoryPanelTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111',
    marginBottom: 12,
  },
  memoryLoadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  memoryLoadingText: {
    marginTop: 8,
    fontSize: 14,
    color: '#888',
  },
  memoryEmptyText: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
  },
  memoryList: {
    paddingBottom: 8,
  },
  memoryCard: {
    backgroundColor: '#F9F9FB',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  memoryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  memoryCardEmoji: {
    fontSize: 14,
    marginRight: 6,
  },
  memoryCardCategory: {
    fontSize: 11,
    fontWeight: '700',
    color: '#007AFF',
    textTransform: 'uppercase',
  },
  memoryCardKey: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
    marginBottom: 4,
  },
  memoryCardValue: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
});

export default HomeScreen;
