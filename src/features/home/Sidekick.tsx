// src/features/home/Sidekick.tsx
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { ChatMessage, GeocodedLocation, ParseResult } from '../../types/route';

// ---- Types ----

interface SidekickProps {
  parseResult: ParseResult | null;
  isLoading: boolean;
  loadingMessage?: string;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  onChat?: (message: string) => void;  // Send to agent backend
  sessionId?: string | null;
  error: string | null;
  onDeleteLocation?: (index: number) => void;
  onSaveLocation?: (location: GeocodedLocation) => void;
  onLocationPress?: (location: GeocodedLocation) => void;
  activeTab?: 'chat' | 'locations';
  onTabChange?: (tab: 'chat' | 'locations') => void;
  /** Index of the selected location for list highlight + auto-scroll */
  selectedLocationIndex?: number;
}

// ---- Helpers ----

/** Format distance in km for display */
const formatDistance = (km: number): string => {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
};

// ---- Loading messages ----

const LOADING_STEPS = [
  'Fetching Reddit post...',
  'AI analyzing locations...',
  'Geocoding places...',
  'Planning best route...',
];

// ---- Component ----

const Sidekick: React.FC<SidekickProps> = ({
  parseResult,
  isLoading,
  loadingMessage,
  messages,
  onSendMessage,
  onChat,
  sessionId,
  error,
  onDeleteLocation,
  onSaveLocation,
  onLocationPress,
  activeTab: externalActiveTab,
  onTabChange,
  selectedLocationIndex,
}) => {
  const sheetRef = useRef<BottomSheet>(null);
  const locationListRef = useRef<FlatList<any>>(null);
  const snapPoints = useMemo(() => ['40%', '100%'], []);
  const [chatInput, setChatInput] = React.useState('');
  const [internalActiveTab, setInternalActiveTab] = useState<'chat' | 'locations'>('chat');

  const activeTab = externalActiveTab ?? internalActiveTab;
  const setActiveTab = onTabChange ?? setInternalActiveTab;

  const canSendChat = chatInput.trim().length > 0;

  // Auto-expand the bottom sheet when data arrives
  const hasContent = parseResult !== null || isLoading || messages.length > 0 || error !== null;

  /** Build the initial system message content when a result comes in */
  const resultContent = useMemo(() => {
    if (!parseResult) return null;

    const { title, locations, route, removed_noise } = parseResult;
    let content = `## ${title}\n\n`;
    content += `📍 **${locations.length} places found**\n\n`;

    content += '### Route (shortest path)\n';
    route.ordered_locations.forEach((loc, i) => {
      content += `${i + 1}. ${loc.name}\n`;
    });
    content += `\n🚗 **Total distance**: ${formatDistance(route.total_distance_km)}\n\n`;

    content += '### Locations\n';
    locations.forEach((loc) => {
      content += `• ${loc.name} (${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)})\n`;
    });

    if (removed_noise && removed_noise.length > 0) {
      content += '\n### Filtered out\n';
      removed_noise.forEach((n) => {
        content += `• ${n}\n`;
      });
    }

    return content;
  }, [parseResult]);

  /** Send a chat message — routes to agent backend or local fallback */
  const handleSendChat = useCallback(() => {
    if (!canSendChat) return;
    const text = chatInput.trim();
    setChatInput('');

    if (onChat && parseResult) {
      // Send to agent backend
      onChat(text);
    } else {
      // Local auto-reply (fallback)
      onSendMessage(text);
    }
  }, [canSendChat, chatInput, onChat, onSendMessage, parseResult]);

  /** Render a single message bubble */
  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const isUser = item.role === 'user';
      const isSystem = item.role === 'system';
      return (
        <View
          style={[
            styles.messageBubble,
            isUser
              ? styles.messageUser
              : isSystem
              ? styles.messageSystem
              : styles.messageAssistant,
          ]}
        >
          <Text
            style={[
              styles.messageText,
              isUser && styles.messageTextUser,
              isSystem && styles.messageTextSystem,
            ]}
          >
            {item.text}
          </Text>
        </View>
      );
    },
    [],
  );

  /** Idle state — nothing loaded yet */
  const renderIdle = () => (
    <View style={styles.centerContent}>
      <Text style={styles.sparkle}>✦</Text>
      <Text style={styles.idleTitle}>Paste a Reddit link to explore</Text>
      <Text style={styles.idleSubtitle}>
        I will extract places, plan a route, and show everything on the map.
      </Text>
    </View>
  );

  /** Loading state */
  const renderLoading = () => (
    <View style={styles.centerContent}>
      <ActivityIndicator size="large" color="#007AFF" />
      <Text style={styles.loadingText}>
        {loadingMessage || 'Analyzing...'}
      </Text>
    </View>
  );

  /** Result state — chat interface */
  const renderChat = () => (
    <View style={styles.chatContainer}>
      <BottomSheetFlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.chatList}
        showsVerticalScrollIndicator={false}
      />

      {/* Show hierarchy filtering info */}
      {(parseResult as any)?.removed_hierarchy?.length > 0 && (
        <View style={styles.hierarchyInfo}>
          <Text style={styles.hierarchyInfoTitle}>
            🗂️ Removed broader locations:
          </Text>
          {(parseResult as any).removed_hierarchy.map((h: any, i: number) => (
            <Text key={i} style={styles.hierarchyInfoText}>
              • {h.name} — {h.reason}
            </Text>
          ))}
        </View>
      )}

      {/* Chat input bar */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={styles.chatInputBar}>
          <TextInput
            value={chatInput}
            onChangeText={setChatInput}
            placeholder="Ask a follow-up..."
            placeholderTextColor="#9A9AA0"
            style={styles.chatInput}
            editable={!isLoading}
            returnKeyType="send"
            onSubmitEditing={handleSendChat}
          />
          <TouchableOpacity
            style={[
              styles.chatSendButton,
              !canSendChat && styles.chatSendButtonDisabled,
            ]}
            onPress={handleSendChat}
            disabled={!canSendChat}
          >
            <Text style={styles.chatSendIcon}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );

  /** Location list view — grouped by category with flat index for highlight + auto-scroll */
  const renderLocations = () => {
    const locations = parseResult?.locations ?? [];

    // Group by category
    const grouped: Record<string, GeocodedLocation[]> = {};
    const categoryOrder = [
      'Tourist Attractions', 'Dining & Drinking', 'Entertainment',
      'Museums & Exhibitions', 'Transit Hubs', 'Religious Sites', 'Others',
    ];

    for (const loc of locations) {
      const cat = loc.category || 'Others';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(loc);
    }

    const sentimentLabels: Record<string, { label: string; color: string }> = {
      positive: { label: 'Recommended', color: '#34C759' },
      neutral: { label: 'Neutral', color: '#007AFF' },
      negative: { label: 'Not Recommended', color: '#FF3B30' },
    };

    const visibleCategories = categoryOrder.filter(c => grouped[c]?.length > 0);

    if (visibleCategories.length === 0) {
      return (
        <View style={styles.centerContent}>
          <Text style={styles.idleSubtitle}>No locations found</Text>
        </View>
      );
    }

    // Build flat items: category headers + location items with global index
    type FlatItem =
      | { kind: 'header'; category: string }
      | { kind: 'location'; location: GeocodedLocation; globalIdx: number };

    const flatItems: FlatItem[] = [];
    let globalIdx = 0;
    for (const cat of visibleCategories) {
      flatItems.push({ kind: 'header', category: cat });
      for (const loc of grouped[cat]) {
        flatItems.push({ kind: 'location', location: loc, globalIdx });
        globalIdx++;
      }
    }

    return (
      <View style={styles.locationsContainer}>
        <FlatList
          ref={locationListRef}
          data={flatItems}
          keyExtractor={(item, i) =>
            item.kind === 'header' ? `hdr-${item.category}` : `loc-${item.globalIdx}`
          }
          contentContainerStyle={styles.locationsList}
          showsVerticalScrollIndicator={false}
          onScrollToIndexFailed={(info) => {
            // Fallback: estimate offset when item isn't measured yet
            locationListRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: true,
            });
          }}
          renderItem={({ item }) => {
            if (item.kind === 'header') {
              return <Text style={styles.categoryTitle}>🏷️ {item.category}</Text>;
            }

            const loc = item.location;
            const isSelected = selectedLocationIndex === item.globalIdx;
            const sentiment = loc.sentiment ? sentimentLabels[loc.sentiment] : null;

            return (
              <View style={[styles.locationItem, isSelected && styles.locationItemSelected]}>
                <TouchableOpacity
                  style={styles.locationInfoTouchable}
                  onPress={() => onLocationPress?.(loc)}
                >
                  <View style={styles.locationInfo}>
                    <Text style={styles.locationName}>{loc.name}</Text>
                    <Text style={styles.locationAddress}>{loc.full_address}</Text>
                    {sentiment && (
                      <View style={[styles.sentimentBadge, { backgroundColor: sentiment.color + '20' }]}>
                        <Text style={[styles.sentimentText, { color: sentiment.color }]}>
                          {sentiment.label}
                        </Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
                <View style={styles.locationActions}>
                  <TouchableOpacity
                    style={styles.locationActionButton}
                    onPress={() => {
                      Alert.alert('Delete', `Remove "${loc.name}"?`, [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => onDeleteLocation?.(item.globalIdx) },
                      ]);
                    }}
                  >
                    <Text style={styles.locationActionIcon}>🗑️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.locationActionButton}
                    onPress={() => onSaveLocation?.(loc)}
                  >
                    <Text style={styles.locationActionIcon}>⭐</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
        />
      </View>
    );
  };

  /** Scroll to the selected location in the list without expanding the sheet */
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Clear any pending scroll
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

    if (selectedLocationIndex !== undefined && selectedLocationIndex >= 0) {
      // Compute the flat array index (accounting for category headers)
      const locations = parseResult?.locations ?? [];
      const categoryOrder = [
        'Tourist Attractions', 'Dining & Drinking', 'Entertainment',
        'Museums & Exhibitions', 'Transit Hubs', 'Religious Sites', 'Others',
      ];
      const grouped: Record<string, GeocodedLocation[]> = {};
      for (const loc of locations) {
        const cat = loc.category || 'Others';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(loc);
      }
      const visibleCategories = categoryOrder.filter(c => grouped[c]?.length > 0);

      let flatIndex = 0;
      let found = false;
      let globalIdx = 0;
      for (const cat of visibleCategories) {
        flatIndex++; // skip the category header
        for (const _loc of grouped[cat]) {
          if (globalIdx === selectedLocationIndex) {
            found = true;
            break;
          }
          globalIdx++;
          flatIndex++;
        }
        if (found) break;
      }

      if (found && locationListRef.current) {
        // Small delay to let the layout settle after tab switch
        scrollTimeoutRef.current = setTimeout(() => {
          locationListRef.current?.scrollToIndex({
            index: flatIndex,
            animated: true,
            viewPosition: 0, // 0 = top of list
          });
        }, 300);
      }
    }

    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, [selectedLocationIndex, parseResult]);

  // Use state for BottomSheet index (controlled prop in v4+)
  // TEMP: Start at 0 to verify BottomSheet renders
  const [sheetIndex, setSheetIndex] = useState(0);

  // When content arrives, update the controlled index
  useEffect(() => {
    if (hasContent && sheetIndex === -1) {
      setSheetIndex(0);
    } else if (!hasContent) {
      setSheetIndex(-1);
    }
  }, [hasContent, sheetIndex]);

  return (
    <BottomSheet
      ref={sheetRef}
      snapPoints={snapPoints}
      index={sheetIndex}
      onChange={setSheetIndex}
      enablePanDownToClose={false}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handle}
    >
      {/* Show the sheet when we have a result, are loading, or have messages */}
      {(parseResult || isLoading || messages.length > 0) ? (
        <>
          {/* Error banner */}
          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>⚠️ {error}</Text>
            </View>
          )}

          {/* Tab bar — only show when parseResult exists */}
          {parseResult && (
            <View style={styles.tabBar}>
              <TouchableOpacity
                style={[styles.tab, activeTab === 'chat' && styles.activeTab]}
                onPress={() => setActiveTab('chat')}
              >
                <Text style={[styles.tabText, activeTab === 'chat' && styles.activeTabText]}>
                  💬 Chat
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, activeTab === 'locations' && styles.activeTab]}
                onPress={() => setActiveTab('locations')}
              >
                <Text style={[styles.tabText, activeTab === 'locations' && styles.activeTabText]}>
                  📍 Locations ({parseResult.locations.length})
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Content */}
          {isLoading && !parseResult
            ? renderLoading()
            : activeTab === 'chat'
              ? renderChat()
              : renderLocations()
          }
        </>
      ) : null}
    </BottomSheet>
  );
};

// ---- Styles ----

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D7D7DC',
  },

  /* Idle state */
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  sparkle: {
    fontSize: 32,
    marginBottom: 12,
  },
  idleTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
    textAlign: 'center',
  },
  idleSubtitle: {
    marginTop: 8,
    fontSize: 14,
    color: '#8A8A8E',
    textAlign: 'center',
    lineHeight: 20,
  },

  /* Loading */
  loadingText: {
    marginTop: 16,
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
  },

  /* Chat */
  chatContainer: {
    flex: 1,
  },
  chatList: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  messageBubble: {
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    marginBottom: 8,
  },
  messageUser: {
    backgroundColor: '#007AFF',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  messageAssistant: {
    backgroundColor: '#F0F0F4',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  messageSystem: {
    backgroundColor: '#FFF9E6',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: '#F0E6C0',
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
    color: '#111',
  },
  messageTextUser: {
    color: '#FFFFFF',
  },
  messageTextSystem: {
    color: '#8A7332',
    fontSize: 13,
  },

  /* Chat input */
  chatInputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F4',
  },
  chatInput: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F4F4F5',
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#111',
  },
  chatSendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  chatSendButtonDisabled: {
    backgroundColor: '#D7D7DC',
  },
  chatSendIcon: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },

  /* Error */
  errorBanner: {
    backgroundColor: '#FFF0F0',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 12,
    borderRadius: 10,
    marginBottom: 8,
  },
  errorText: {
    color: '#CC3333',
    fontSize: 13,
    lineHeight: 18,
  },

  /* Hierarchy info */
  hierarchyInfo: {
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    marginHorizontal: 12,
  },
  hierarchyInfoTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#666',
    marginBottom: 4,
  },
  hierarchyInfoText: {
    fontSize: 11,
    color: '#999',
    marginLeft: 4,
  },

  /* Tab bar */
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F4',
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    marginHorizontal: 4,
    backgroundColor: '#F4F4F5',
  },
  activeTab: {
    backgroundColor: '#007AFF',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  activeTabText: {
    color: '#FFFFFF',
  },

  /* Location list */
  locationsContainer: {
    flex: 1,
  },
  locationsList: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  locationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#F9F9FB',
    borderRadius: 12,
    marginBottom: 8,
  },
  locationItemSelected: {
    borderWidth: 2,
    borderColor: '#007AFF',
    backgroundColor: '#E8F3FF',
  },
  locationInfoTouchable: {
    flex: 1,
    marginRight: 8,
    paddingVertical: 4,
  },
  locationInfo: {
    flex: 1,
    marginRight: 8,
  },
  locationName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
    marginBottom: 2,
  },
  locationAddress: {
    fontSize: 13,
    color: '#666',
    marginBottom: 2,
  },
  locationCoords: {
    fontSize: 11,
    color: '#999',
  },
  locationActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationActionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  locationActionIcon: {
    fontSize: 16,
  },
  categoryGroup: {
    marginBottom: 16,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sentimentBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
  },
  sentimentText: {
    fontSize: 11,
    fontWeight: '600',
  },

});

export default Sidekick;
