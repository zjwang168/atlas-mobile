import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import Markdown from 'react-native-markdown-display';

import { Text } from '@/components/ui/text';
import ContentPanel from '../../components/content-panel/ContentPanel';
import { chatWithAtlas, createChatSession, fetchConversation } from '../../services/api/apiService';
import type { ParsedPlace } from '../../services/import/importService';
import { typography } from '../../theme/typography';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type PlaceActionCard = {
  places: PendingAction['places'];
  status: 'pending' | 'pin_done' | 'save_done' | 'done';
};

type PendingAction = {
  action: PendingMode;
  places: Array<{
    name: string;
    latitude: number;
    longitude: number;
    subtitle?: string;
    category?: string;
    description?: string;
    confidence?: number;
  }>;
};

type PendingMode = 'pin_in_chat' | 'save_to_my_places' | 'both';

function extractPendingAction(text: string): { text: string; pendingAction: PendingAction | null; hasConfirmMarker: boolean } {
  const match = text.match(/\[\[CONFIRM_ADD_PLACES:(.*?)\]\]/s);
  if (!match) return { text, pendingAction: null, hasConfirmMarker: false };
  try {
    const pendingAction = JSON.parse(match[1]) as PendingAction;
    const cleaned = text.replace(match[0], '').trim();
    return { text: cleaned, pendingAction, hasConfirmMarker: true };
  } catch {
    return { text, pendingAction: null, hasConfirmMarker: true };
  }
}

function looksLikeSaveCurrentChatRequest(text: string): boolean {
  const normalized = text.replace(/\s+/g, '').toLowerCase();
  return (
    normalized.includes('保存在当前chat的地图上') ||
    normalized.includes('保存在当前chat地图上') ||
    normalized.includes('saveinthecurrentchatmap') ||
    normalized.includes('addtothischat') ||
    normalized.includes('savetothischat')
  );
}

function buildDefaultPendingAction(action: PendingMode, places: ParsedPlace[]): PendingAction {
  return {
    action,
    places: places.map((place) => ({
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      subtitle: place.subtitle,
      category: place.type,
      description: place.subtitle,
    })),
  };
}

function looksLikeManualAddFallback(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes('manually add') ||
    normalized.includes('manual add') ||
    normalized.includes('could not automatically add') ||
    normalized.includes('system encountered a minor issue') ||
    normalized.includes('you can manually add') ||
    normalized.includes('here is the complete information') ||
    normalized.includes('below is the complete information') ||
    normalized.includes('系统暂时无法自动添加') ||
    normalized.includes('你可以手动添加') ||
    normalized.includes('完整信息')
  );
}

function looksLikeAddToMapQuestion(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes('要不要我把') ||
    normalized.includes('添加到地图上') ||
    normalized.includes('加入到地图上') ||
    normalized.includes('want me to add') ||
    normalized.includes('would you like me to add') ||
    normalized.includes('do you want me to add') ||
    normalized.includes('should i add') ||
    normalized.includes('add it to the map') ||
    normalized.includes('save it to my places') ||
    normalized.includes('want to add it to the map')
  );
}

function looksLikeAffirmativeReply(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    normalized === '好' ||
    normalized === '好的' ||
    normalized === '行' ||
    normalized === '可以' ||
    normalized === 'yes' ||
    normalized === 'y' ||
    normalized === 'ok' ||
    normalized === 'okay' ||
    normalized === 'sure' ||
    normalized === 'go ahead' ||
    normalized === 'please do it'
  );
}

function normalizeAssistantText(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return 'No response returned.';

  // Guard against accidental tool-call JSON being rendered in the chat bubble.
  if ((cleaned.startsWith('{') || cleaned.startsWith('```')) && cleaned.includes('"tool"')) {
    return 'Working on that...';
  }

  return cleaned;
}

function stripActionMarkers(text: string): string {
  return text
    .replace(/\[\[PLACE_ACTION_CARD:[\s\S]*?\]\]/g, '')
    .replace(/\[\[CONFIRM_ADD_PLACES:[\s\S]*?\]\]/g, '')
    .trim();
}

function parseCardJson(raw: string): PlaceActionCard | null {
  try {
    return JSON.parse(raw) as PlaceActionCard;
  } catch {
    return null;
  }
}

function buildPlaceActionCardFromPlaces(places: ParsedPlace[], status: PlaceActionCard['status'] = 'pending'): PlaceActionCard {
  return {
    places: places.map((place) => ({
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      subtitle: place.subtitle,
      category: place.type,
      description: place.subtitle,
    })),
    status,
  };
}

function buildSinglePlaceCard(
  place: PlaceActionCard['places'][number],
  status: PlaceActionCard['status'] = 'pending',
): PlaceActionCard {
  return {
    places: [place],
    status,
  };
}

function extractRecommendedPlaceCardsFromText(text: string): PlaceActionCard[] {
  const cards: PlaceActionCard[] = [];
  const normalized = text
    .replace(/\*\*/g, '')
    .replace(/\uFEFF/g, '');
  const blockRegex = /(?:^|\n)\s*(?:#{1,6}\s*)?[^\n]*?(?:推荐|Recommendation|Recommend)\s*\d+\s*[:：][\s\S]*?(?=(?:\n\s*(?:#{1,6}\s*)?[^\n]*?(?:推荐|Recommendation|Recommend)\s*\d+\s*[:：])|$)/gi;
  const blocks = normalized.match(blockRegex) || [];

  for (const block of blocks) {
    const nameMatch =
      block.match(/(?:推荐|Recommendation|Recommend)\s*\d+\s*[:：]\s*([^\n]+)/i) ||
      block.match(/(?:推荐|Recommendation|Recommend)\s*\d+\s+([^\n]+)/i);
    const coordMatch = block.match(/(?:坐标|coordinates?)\s*[:：]\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)/i);
    if (!nameMatch || !coordMatch) continue;

    const rawName = nameMatch[1].trim();
    const name = rawName.replace(/[。.!！?？]+$/, '').trim();
    const latitude = Number(coordMatch[1]);
    const longitude = Number(coordMatch[2]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    const subtitleMatch = block.match(/地址\s*[:：]\s*([^\n]+)/i);
    const descriptionMatch = block.match(/简介\s*[:：]\s*([\s\S]*?)(?:\n\s*[-*]|$)/i);
    const subtitle = subtitleMatch?.[1]?.trim() || '';
    const description = descriptionMatch?.[1]?.trim() || subtitle;

    cards.push({
      status: 'pending',
      places: [
        {
          name,
          latitude,
          longitude,
          subtitle,
          category: 'Place',
          description,
        },
      ],
    });
    if (cards.length >= 3) break;
  }

  return cards;
}

function getSinglePlaceSummary(place: PlaceActionCard['places'][number]): string {
  return `Choose what to do next with:\n${place.name}: ${place.subtitle || place.description || 'New place'}`;
}

function cardMarkerFromCard(card: PlaceActionCard): string {
  return `[[PLACE_ACTION_CARD:${JSON.stringify(card)}]]`;
}

function parseAllPlaceActionCards(text: string): PlaceActionCard[] {
  const cards: PlaceActionCard[] = [];
  const markerRegex = /\[\[(PLACE_ACTION_CARD|CONFIRM_ADD_PLACES):([\s\S]*?)\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = markerRegex.exec(text)) !== null) {
    const parsed = parseCardJson(match[2]);
    if (parsed?.places?.length) {
      cards.push(parsed);
    }
  }

  return cards;
}

function renderCardStatusText(status: PlaceActionCard['status']): string {
  if (status === 'pin_done') return 'Pinned in chat';
  if (status === 'save_done') return 'Saved to My Places';
  if (status === 'done') return 'Done';
  return 'Choose what to do next';
}

function updateCardStatus(text: string, status: PlaceActionCard['status']): string {
  const markerRegex = /\[\[(PLACE_ACTION_CARD|CONFIRM_ADD_PLACES):([\s\S]*?)\]\]/g;
  let replaced = false;
  const nextText = text.replace(markerRegex, (full, _kind, rawJson) => {
    if (replaced) return full;
    const parsed = parseCardJson(rawJson);
    if (!parsed?.places?.length) return full;
    const updated = { ...parsed, status };
    replaced = true;
    return cardMarkerFromCard(updated);
  });
  return nextText;
}

function extractPlaceActionCards(text: string): { text: string; cards: PlaceActionCard[] } {
  const cleaned = stripActionMarkers(text);
  const markerCards = parseAllPlaceActionCards(text);
  if (markerCards.length > 0) {
    return { text: cleaned, cards: markerCards.slice(0, 3) };
  }

  const inferredFromText = extractRecommendedPlaceCardsFromText(cleaned);
  return {
    text: cleaned,
    cards: inferredFromText.slice(0, 3),
  };
}

function normalizeBackendPlaceCards(cards: NonNullable<import('../../services/api/apiService').AtlasChatResponse['place_cards']>): PlaceActionCard[] {
  return cards
    .map((card) => ({
      status: card.status,
      places: (card.places || []).map((place) => ({
        name: place.name,
        latitude: place.latitude,
        longitude: place.longitude,
        subtitle: place.subtitle || '',
        category: place.category || '',
        description: place.description || place.subtitle || '',
      })),
    }))
    .filter((card) => card.places.length > 0)
    .slice(0, 3);
}

function buildWelcomeMessage(places: ParsedPlace[], title?: string): string {
  if (places.length === 0) {
    return [
      '### Atlas AI',
      '',
      'I am ready to help you compare neighborhoods, reason through places, or turn a rough idea into a plan.',
      '',
      '### Next step',
      '',
      'Ask me what you want to compare, where the strongest options are, or what is missing.',
    ].join('\n');
  }

  const highlightNames = places.slice(0, 3).map((place) => `**${place.name}**`).join(', ');
  const moreCount = places.length > 3 ? ` and ${places.length - 3} more` : '';
  const sourceLabel = title ? `from **${title}**` : 'from this saved set';
  const regionLine = places[0]?.subtitle ? `The first place I see is **${places[0].subtitle}**.` : '';

  return [
    '### What I found',
    '',
    `I pulled together **${places.length} place${places.length > 1 ? 's' : ''}** ${sourceLabel}.`,
    highlightNames ? `A few anchors are ${highlightNames}${moreCount}.` : '',
    regionLine,
    '',
    '### Next step',
    '',
    'Ask me to compare them, group them by area, or help turn them into a plan.',
  ]
    .filter(Boolean)
    .join('\n');
}

type AIChatBoxProps = {
  places: ParsedPlace[];
  onClose: () => void;
  title?: string;
  visible?: boolean;
  conversationId?: string | null;
  onHeightChange?: (height: number) => void;
  onPlacesCommitted?: (places: ParsedPlace[], action: PendingMode) => void;
};

export default function AIChatBox({
  places,
  onClose,
  title,
  visible = true,
  conversationId = null,
  onHeightChange,
  onPlacesCommitted,
}: AIChatBoxProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: buildWelcomeMessage(places, title),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const hydratedConversationIdRef = useRef<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const lastWelcomeKeyRef = useRef<string>('');
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

  useEffect(() => {
    const welcomeKey = `${conversationId ?? 'new'}|${title ?? ''}|${places
      .map((place) => `${place.id}:${place.name}:${place.latitude.toFixed(5)}:${place.longitude.toFixed(5)}`)
      .join('|')}`;

    if (!conversationId && lastWelcomeKeyRef.current !== welcomeKey) {
      lastWelcomeKeyRef.current = welcomeKey;
      setSessionId(null);
      setPending(false);
      setPendingAction(null);
      setInputText('');
      setMessages([
        {
          id: `welcome_${welcomeKey}`,
          role: 'assistant',
          text: buildWelcomeMessage(places, title),
        },
      ]);
    }

    let cancelled = false;

    const hydrateFromConversation = async () => {
      if (!conversationId) return;
      if (hydratedConversationIdRef.current === conversationId) return;
      try {
        const detail = await fetchConversation(conversationId);
        if (cancelled) return;

        const session = detail.session;
        const restoredMessages: Message[] = (detail.messages || []).map((message, index) => ({
          id: `${message.role}_${index}_${Date.now()}`,
          role: message.role === 'user' ? 'user' : 'assistant',
          text: message.content,
        }));

        const sessionPlaces = detail.session.locations ?? [];
        const hasOpeningAssistant = restoredMessages[0]?.role === 'assistant';
        const openingMessage =
          hasOpeningAssistant
            ? null
            : {
                id: `opening_${conversationId}`,
                role: 'assistant' as const,
                text: buildWelcomeMessage(
                  sessionPlaces.map((place) => ({
                    id: `${place.name}_${place.latitude}_${place.longitude}`,
                    name: place.name,
                    subtitle: place.full_address || place.description || '',
                    type: place.category || 'Place',
                    latitude: place.latitude,
                    longitude: place.longitude,
                  })),
                  detail.session.title || title,
                ),
              };

        setSessionId(session.session_id);
        activeConversationIdRef.current = detail.session.conversation_id || conversationId;
        setMessages(openingMessage ? [openingMessage, ...restoredMessages] : restoredMessages);
        setPendingAction(null);
        hydratedConversationIdRef.current = conversationId;
      } catch (error) {
        console.warn('[AIChatBox] hydrateFromConversation failed:', error);
      }
    };

    hydrateFromConversation();

    return () => {
      cancelled = true;
    };
  }, [conversationId, places, title]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || pending) return;

    setMessages((prev) => [...prev, { id: `user_${Date.now()}`, role: 'user', text }]);
    setInputText('');
    setPending(true);

    try {
      const currentSessionId = await ensureSession();
      const response = await chatWithAtlas(currentSessionId, text, activeConversationIdRef.current);
      const parsed = extractPendingAction(response.response || '');
      const cardsParsed = extractPlaceActionCards(response.response || '');
      const backendCards = response.place_cards?.length ? normalizeBackendPlaceCards(response.place_cards) : [];

      const responsePendingAction = response.pending_action ?? null;
      let nextPendingAction = parsed.pendingAction || responsePendingAction;

      if (!nextPendingAction && places.length > 0) {
        if (looksLikeSaveCurrentChatRequest(text)) {
          nextPendingAction = buildDefaultPendingAction('save_to_my_places', places);
        } else if (parsed.hasConfirmMarker || looksLikeManualAddFallback(response.response || '')) {
          nextPendingAction = buildDefaultPendingAction('both', places);
        } else if (/(?=.*\bpin\b)(?=.*\bchat\b)/i.test(text)) {
          nextPendingAction = buildDefaultPendingAction('pin_in_chat', places);
        }
      }

      const nextCards = backendCards.length > 0 ? backendCards : cardsParsed.cards;
      const assistantText = nextCards.length > 0
        ? `${normalizeAssistantText(cardsParsed.text || parsed.text)}\n${nextCards
            .map((card) => cardMarkerFromCard({ ...card, status: card.status || 'pending' }))
            .join('\n')}`
        : normalizeAssistantText(cardsParsed.text || parsed.text);

      setMessages((prev) => [
        ...prev,
        {
          id: `ai_${Date.now()}`,
          role: 'assistant',
          text: assistantText,
        },
      ]);
      setPendingAction(nextPendingAction);

      if (response.pending_action?.places?.length) {
        const committedPlaces = response.pending_action.places.map((place) => ({
          id: `${place.name}_${place.latitude}_${place.longitude}`,
          name: place.name,
          subtitle: place.subtitle || place.description || '',
          type: place.category || 'Place',
          latitude: place.latitude,
          longitude: place.longitude,
        }));
        onPlacesCommitted?.(committedPlaces, response.pending_action.action as PendingMode);
      }

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

  const handleCardAction = async (card: PlaceActionCard, action: PendingMode) => {
    if (pending) return;
    const currentSessionId = await ensureSession();
    const confirmMessage = `CONFIRM_ADD_PLACES ${JSON.stringify({ ...card, action })}`;
    setPending(true);
    try {
      const response = await chatWithAtlas(currentSessionId, confirmMessage, activeConversationIdRef.current);
      const nextStatus: PlaceActionCard['status'] =
        action === 'pin_in_chat'
          ? 'pin_done'
          : action === 'save_to_my_places'
            ? 'save_done'
            : 'done';
      setMessages((prev) =>
        prev.map((message) => {
          const cards = parseAllPlaceActionCards(message.text);
          if (cards.length === 0) return message;
          const shouldUpdate = cards.some((messageCard) =>
            messageCard.places.some((place) =>
              card.places.some(
                (target) =>
                  target.name === place.name &&
                  Math.abs(target.latitude - place.latitude) < 0.0002 &&
                  Math.abs(target.longitude - place.longitude) < 0.0002,
              ),
            ),
          );
          if (!shouldUpdate) return message;
          return { ...message, text: updateCardStatus(message.text, nextStatus) };
        }),
      );
      setMessages((prev) => [
        ...prev,
        {
          id: `ai_${Date.now()}`,
          role: 'assistant',
          text: normalizeAssistantText(response.response || ''),
        },
      ]);
      if (response.locations?.length) {
        const committedPlaces = response.locations.map((place) => ({
          id: `${place.name}_${place.latitude}_${place.longitude}`,
          name: place.name,
          subtitle: place.full_address || place.description || '',
          type: place.category || 'Place',
          latitude: place.latitude,
          longitude: place.longitude,
        }));
        onPlacesCommitted?.(committedPlaces, action);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong.';
      setMessages((prev) => [...prev, { id: `ai_${Date.now()}`, role: 'assistant', text: message }]);
    } finally {
      setPending(false);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    const cardParsed = extractPlaceActionCards(item.text);
    const displayText = cardParsed.text || item.text;
    const renderCards = (card: PlaceActionCard) =>
      card.places.slice(0, 3).map((place) => {
        const singleCard = buildSinglePlaceCard(place, card.status);
        const disabledPin = pending || singleCard.status === 'pin_done' || singleCard.status === 'done';
        const disabledSave = pending || singleCard.status === 'save_done' || singleCard.status === 'done';
        return (
          <View key={`${place.name}_${place.latitude}_${place.longitude}`} style={styles.actionCard}>
            <Text style={styles.actionCardTitle}>{getSinglePlaceSummary(place)}</Text>
            <View style={styles.actionCardButtons}>
              <TouchableOpacity
                onPress={() => handleCardAction(singleCard, 'pin_in_chat')}
                disabled={disabledPin}
                style={[
                  styles.actionCardButton,
                  styles.actionCardButtonSecondary,
                  disabledPin && styles.actionCardButtonDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.actionCardButtonSecondaryText,
                    disabledPin && styles.actionCardButtonTextDisabled,
                  ]}
                >
                  Pin in Chat
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleCardAction(singleCard, 'save_to_my_places')}
                disabled={disabledSave}
                style={[
                  styles.actionCardButton,
                  disabledSave && styles.actionCardButtonDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.actionCardButtonText,
                    disabledSave && styles.actionCardButtonTextDisabled,
                  ]}
                >
                  Save to My Places
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      });
    return (
      <View style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowAssistant]}>
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
          {isUser ? (
            <Text style={[styles.messageText, styles.userText]}>
              {item.text}
            </Text>
          ) : (
            <Markdown style={markdownStyles}>{displayText}</Markdown>
          )}
          {cardParsed.cards.length > 0 ? cardParsed.cards.map((card) => renderCards(card)) : null}
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
    backgroundColor: '#FFFFFF',
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
  actionCard: {
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  actionCardTitle: {
    ...typography.body,
    color: '#111827',
    fontWeight: '700',
  },
  actionCardBody: {
    ...typography.bodySmall,
    color: '#4B5563',
    lineHeight: 19,
  },
  actionCardButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionCardButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: '#12C170',
  },
  actionCardButtonSecondary: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#12C170',
  },
  actionCardButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  actionCardButtonSecondaryText: {
    color: '#12C170',
    fontWeight: '700',
  },
  actionCardButtonDisabled: {
    opacity: 0.4,
  },
  actionCardButtonTextDisabled: {
    color: '#9CA3AF',
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
  confirmBar: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    borderRadius: 18,
    backgroundColor: '#EEFDF4',
    borderWidth: 1,
    borderColor: '#CDEFD9',
  },
  confirmText: {
    ...typography.bodySmall,
    color: '#14532D',
    marginBottom: 10,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  confirmButton: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#12C170',
  },
  confirmButtonSecondary: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#12C170',
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  confirmButtonTextSecondary: {
    color: '#12C170',
    fontWeight: '700',
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

const markdownStyles = StyleSheet.create({
  body: {
    color: '#1A1A1A',
    ...typography.bodySmall,
    lineHeight: 20,
  },
  heading3: {
    color: '#111827',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
    marginBottom: 6,
    marginTop: 0,
  },
  strong: {
    fontWeight: '700',
    color: '#111827',
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
  },
  bullet_list: {
    marginTop: 0,
    marginBottom: 8,
  },
  ordered_list: {
    marginTop: 0,
    marginBottom: 8,
  },
  list_item: {
    marginBottom: 4,
  },
});
