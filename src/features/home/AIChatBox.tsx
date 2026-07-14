import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Text } from '@/components/ui/text';
import ContentPanel from '../../components/content-panel/ContentPanel';
import {
  chatWithAtlas,
  createChatSession,
  fetchConversation,
  fetchConversations,
} from '../../services/api/apiService';
import type { ParsedPlace } from '../../services/import/importService';
import { typography } from '../../theme/typography';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type ConversationSummary = {
  id: string;
  title: string;
  source_url?: string | null;
  location_count?: number;
  message_count?: number;
  created_at?: string;
  updated_at?: string;
};

function normalizeAssistantText(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return 'No response returned.';

  // Guard against accidental tool-call JSON being rendered in the chat bubble.
  if ((cleaned.startsWith('{') || cleaned.startsWith('```')) && cleaned.includes('"tool"')) {
    return 'Working on that...';
  }

  return cleaned;
}

type AIChatBoxProps = {
  places: ParsedPlace[];
  onClose: () => void;
  title?: string;
  visible?: boolean;
  onHeightChange?: (height: number) => void;
};

export default function AIChatBox({
  places,
  onClose,
  title,
  visible = true,
  onHeightChange,
}: AIChatBoxProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: places.length > 0
        ? `I found ${places.length} place${places.length > 1 ? 's' : ''}. Ask me to compare, group, or turn them into a plan.`
        : 'Ask me to help plan, compare neighborhoods, or reason through places on the map.',
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [conversationList, setConversationList] = useState<ConversationSummary[]>([]);
  const flatListRef = useRef<FlatList>(null);

  const subtitle = useMemo(
    () => title || (places.length > 0 ? `${places.length} places on map` : 'Travel planning assistant'),
    [places.length, title],
  );

  const ensureSession = async (): Promise<string> => {
    if (sessionId) return sessionId;
    const created = await createChatSession({
      title: title || 'Atlas AI chat',
      source_type: places.length > 0 ? 'map_state' : 'atlas_ai',
      locations: places.map((place) => ({
        name: place.name,
        latitude: place.latitude,
        longitude: place.longitude,
        full_address: place.subtitle,
        sentiment: place.sentiment ?? null,
        description: place.subtitle,
        category: place.type || 'Place',
      })),
    });
    setSessionId(created.session_id);
    return created.session_id;
  };

  const loadConversationHistory = async () => {
    setHistoryVisible(true);
    setLoadingHistory(true);
    try {
      const items = await fetchConversations();
      setConversationList(items);
    } catch (error) {
      console.warn('[AIChatBox] fetchConversations failed:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const restoreConversation = async (conversationId: string) => {
    setPending(true);
    try {
      const detail = await fetchConversation(conversationId);
      const session = detail.session;
      const restoredMessages: Message[] = (detail.messages || []).map((message, index) => ({
        id: `${message.role}_${index}_${Date.now()}`,
        role: message.role === 'user' ? 'user' : 'assistant',
        text: message.content,
      }));

      setSessionId(session.session_id);
      setMessages(
        restoredMessages.length > 0
          ? restoredMessages
          : [{ id: `restored_${Date.now()}`, role: 'assistant', text: 'Conversation restored.' }],
      );
      setHistoryVisible(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to restore conversation.';
      setMessages((prev) => [...prev, { id: `ai_${Date.now()}`, role: 'assistant', text: message }]);
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    if (!visible) setHistoryVisible(false);
  }, [visible]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || pending) return;

    setMessages((prev) => [...prev, { id: `user_${Date.now()}`, role: 'user', text }]);
    setInputText('');
    setPending(true);

    try {
      const currentSessionId = await ensureSession();
      const response = await chatWithAtlas(currentSessionId, text);

      setMessages((prev) => [
        ...prev,
        {
          id: `ai_${Date.now()}`,
          role: 'assistant',
          text: normalizeAssistantText(response.response || ''),
        },
      ]);

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong.';
      setMessages((prev) => [
        ...prev,
        { id: `ai_${Date.now()}`, role: 'assistant', text: message },
      ]);
    } finally {
      setPending(false);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowAssistant]}>
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
          <Text style={[styles.messageText, isUser ? styles.userText : styles.assistantText]}>
            {item.text}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <ContentPanel
      initialSnap="default"
      visible={visible}
      onHeightChange={onHeightChange}
      zIndex={46}
    >
      {({ reportScrollY, bottomInset }) => (
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={styles.icon}>
              <Ionicons name="sparkles" size={18} color="#2563EB" />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Atlas AI</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
            <TouchableOpacity onPress={loadConversationHistory} style={styles.historyButton} activeOpacity={0.75}>
              <Ionicons name="time-outline" size={18} color="#1A1A1A" />
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.75}>
              <Ionicons name="close" size={20} color="#1A1A1A" />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView
            style={styles.body}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              style={styles.list}
              contentContainerStyle={{ paddingBottom: 16 }}
              onScroll={(event) => reportScrollY(event.nativeEvent.contentOffset.y)}
              scrollEventThrottle={16}
              onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
              showsVerticalScrollIndicator={false}
            />

            <View style={[styles.inputRow, { paddingBottom: Math.max(bottomInset, 10) }]}>
              <TextInput
                value={inputText}
                onChangeText={setInputText}
                placeholder="Ask Atlas AI..."
                placeholderTextColor="#8E8E93"
                style={styles.input}
                onSubmitEditing={handleSend}
                returnKeyType="send"
                editable={!pending}
              />
              <TouchableOpacity
                onPress={handleSend}
                disabled={!inputText.trim() || pending}
                style={[styles.sendButton, (!inputText.trim() || pending) && styles.sendButtonDisabled]}
              >
                {pending ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="send" size={16} color="#FFFFFF" />}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>

          <Modal
            visible={historyVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setHistoryVisible(false)}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.modalCard}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Conversation History</Text>
                  <TouchableOpacity onPress={() => setHistoryVisible(false)} style={styles.modalClose}>
                    <Ionicons name="close" size={18} color="#1A1A1A" />
                  </TouchableOpacity>
                </View>

                {loadingHistory ? (
                  <View style={styles.modalLoading}>
                    <ActivityIndicator size="large" color="#2563EB" />
                  </View>
                ) : conversationList.length === 0 ? (
                  <View style={styles.modalEmpty}>
                    <Text style={styles.modalEmptyText}>No saved conversations yet.</Text>
                  </View>
                ) : (
                  <FlatList
                    data={conversationList}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={styles.convItem}
                        activeOpacity={0.8}
                        onPress={() => restoreConversation(item.id)}
                        disabled={pending}
                      >
                        <View style={styles.convItemTop}>
                          <Text style={styles.convTitle} numberOfLines={1}>
                            {item.title || 'Untitled conversation'}
                          </Text>
                          <Text style={styles.convMeta}>
                            {item.location_count ?? 0} places
                          </Text>
                        </View>
                        <Text style={styles.convSub} numberOfLines={1}>
                          {item.source_url || item.id}
                        </Text>
                      </TouchableOpacity>
                    )}
                  />
                )}
              </View>
            </View>
          </Modal>
        </View>
      )}
    </ContentPanel>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...typography.display,
    color: '#09090B',
  },
  subtitle: {
    marginTop: 2,
    ...typography.bodySmall,
    color: '#717171',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  list: {
    flex: 1,
    paddingHorizontal: 16,
  },
  messageRow: {
    marginBottom: 12,
    flexDirection: 'row',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
  },
  messageRowAssistant: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  userBubble: {
    borderTopRightRadius: 6,
    backgroundColor: '#2563EB',
  },
  assistantBubble: {
    borderTopLeftRadius: 6,
    backgroundColor: '#F2F2F7',
  },
  messageText: {
    ...typography.bodySmall,
    lineHeight: 20,
  },
  userText: {
    color: '#FFFFFF',
  },
  assistantText: {
    color: '#1A1A1A',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(60,60,67,0.12)',
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: '#F2F2F7',
    paddingHorizontal: 16,
    color: '#1A1A1A',
    fontSize: 15,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB',
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    maxHeight: '70%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: {
    ...typography.display,
    color: '#111827',
  },
  modalClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalLoading: {
    paddingVertical: 40,
  },
  modalEmpty: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  modalEmptyText: {
    ...typography.bodySmall,
    color: '#6B7280',
  },
  convItem: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  convItemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  convTitle: {
    flex: 1,
    ...typography.body,
    color: '#111827',
    fontWeight: '700',
  },
  convMeta: {
    ...typography.bodySmall,
    color: '#2563EB',
  },
  convSub: {
    marginTop: 4,
    ...typography.bodySmall,
    color: '#6B7280',
  },
});
