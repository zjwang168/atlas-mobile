// src/features/home/Sidekick.tsx
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { ChatMessage, ParseResult } from '../../types/route';

// ---- Types ----

interface SidekickProps {
  parseResult: ParseResult | null;
  isLoading: boolean;
  loadingMessage?: string;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  error: string | null;
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
  error,
}) => {
  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['40%', '100%'], []);
  const [chatInput, setChatInput] = React.useState('');

  const canSendChat = chatInput.trim().length > 0;

  // Auto-expand the bottom sheet when data arrives
  const hasContent = parseResult !== null || isLoading || messages.length > 0 || error !== null;
  useEffect(() => {
    if (hasContent && sheetRef.current) {
      sheetRef.current.snapToIndex(0);
    }
  }, [hasContent]);

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

  /** Send a chat message */
  const handleSendChat = useCallback(() => {
    if (!canSendChat) return;
    onSendMessage(chatInput.trim());
    setChatInput('');
  }, [canSendChat, chatInput, onSendMessage]);

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

  return (
    <BottomSheet
      ref={sheetRef}
      snapPoints={snapPoints}
      index={-1} // Start hidden; will be changed to 0 when data comes
      enablePanDownToClose={false}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handle}
    >
      {/* Show the sheet when we have a result, are loading, or have messages */}
      {(parseResult || isLoading || messages.length > 0) ? (
        <>
          {/* Drag handle */}
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          {/* Error banner */}
          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>⚠️ {error}</Text>
            </View>
          )}

          {/* Content */}
          {isLoading && !parseResult
            ? renderLoading()
            : renderChat()
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
});

export default Sidekick;
