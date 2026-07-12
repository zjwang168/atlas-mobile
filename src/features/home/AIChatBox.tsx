import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Text } from '@/components/ui/text';
import ContentPanel from '../../components/content-panel/ContentPanel';
import { chatWithAtlas, createChatSession } from '../../services/api/apiService';
import type { ParsedPlace } from '../../services/import/importService';
import { typography } from '../../theme/typography';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

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
          text: response.response || 'No response returned.',
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
});
