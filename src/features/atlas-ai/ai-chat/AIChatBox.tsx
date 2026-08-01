import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import type { Icon } from 'phosphor-react-native';
import { ArrowUpIcon } from 'phosphor-react-native/src/icons/ArrowUp';
import { ArrowRightIcon } from 'phosphor-react-native/src/icons/ArrowRight';
import { ClockIcon } from 'phosphor-react-native/src/icons/Clock';
import { CopyIcon } from 'phosphor-react-native/src/icons/Copy';
import { DotsThreeIcon } from 'phosphor-react-native/src/icons/DotsThree';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { MicrophoneIcon } from 'phosphor-react-native/src/icons/Microphone';
import { PencilSimpleLineIcon } from 'phosphor-react-native/src/icons/PencilSimpleLine';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { ShareIcon } from 'phosphor-react-native/src/icons/Share';
import { ThumbsDownIcon } from 'phosphor-react-native/src/icons/ThumbsDown';
import { ThumbsUpIcon } from 'phosphor-react-native/src/icons/ThumbsUp';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import Animated, {
  LinearTransition,
  SlideInDown,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import TopBlurFade from '@/components/ui/top-blur-fade';
import { chatWithAtlas, createChatSession, fetchConversation } from '@/services/api/apiService';
import type { ParsedPlace } from '@/services/import/importService';
import { typography } from '@/theme/typography';

const COLOR = {
  primary: '#12C170',
  background: '#FFFFFF',
  foreground: '#09090B',
  textTertiary: '#8E8E93',
  border: '#E4E4E7',
} as const;

const LIQUID_GLASS_AVAILABLE =
  isGlassEffectAPIAvailable() && isLiquidGlassAvailable();

const COMPOSER_LAYOUT_TRANSITION = LinearTransition.duration(180);
const CHAT_ENTER_TRANSITION = SlideInDown
  .springify()
  .damping(22)
  .stiffness(190)
  .mass(0.86);
const ATLAS_AI_MARK = require('../../../../assets/atlas-ai-mark.png');
const STARTER_PROMPTS = [
  'Cozy cafes to work from near me',
  'Best date-night viewpoints',
  'A hidden gem tourists don’t know',
] as const;

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type MessageFeedback = 'up' | 'down';

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

/** Longest plausible real-world place label; past this it reads as prose. */
const PLACE_NAME_MAX_LENGTH = 80;
/** Word count past which a "name" is a sentence, not a label. */
const PLACE_NAME_MAX_WORDS = 12;
/** A lat/lng pair that leaked in from an unparsed line of the reply. */
const EMBEDDED_COORDINATES_RE = /-?\d{1,3}\.\d+\s*[,，]\s*-?\d{1,3}\.\d+/;
/** Trailing connector punctuation — a clause cut out of a longer sentence. */
const SENTENCE_FRAGMENT_TAIL_RE = /[,;:，；：]$/;
/** Terminal punctuation with text after it — the value spans two sentences. */
const MULTI_SENTENCE_RE = /[.!?。！？]\s+\S/;
/** Abbreviations that legitimately carry a period inside a name ("Powell St. Station"). */
const NAME_ABBREVIATION_RE = /\b(?:st|ave|rd|blvd|dr|mt|ft|pt|sq|jr|sr|no|dept|univ|co|inc|ltd)\.\s/gi;
/** Pronouns that, followed by a copula, open a description rather than a name. */
const PROSE_PRONOUNS = new Set([
  'it', 'this', 'that', 'there', 'they', 'these', 'those', 'here', 'you', 'we',
]);
const PROSE_COPULAS = new Set([
  'is', 'are', 'was', 'were', 'has', 'have', 'had',
  'can', 'could', 'will', 'would', 'also',
  'offer', 'offers', 'sit', 'sits', 'lie', 'lies',
]);

/** True when the value contains a real sentence boundary, ignoring name abbreviations. */
function hasSentenceBreak(value: string): boolean {
  return MULTI_SENTENCE_RE.test(value.replace(NAME_ABBREVIATION_RE, 'X '));
}

/**
 * True when the value opens like a description ("It's located on …") rather
 * than a name. A capitalised word after the contraction keeps real names such
 * as "Here's Looking at You"; the trade-off is that a lowercase-continuing
 * name like "It's a Grind Coffee House" is rejected.
 */
function hasProseOpener(value: string): boolean {
  const [first = '', second = ''] = value.split(/\s+/);
  const contraction = /^([A-Za-z]+)['’]s$/.exec(first);
  if (contraction && PROSE_PRONOUNS.has(contraction[1].toLowerCase())) {
    return second !== '' && second[0] === second[0].toLowerCase();
  }
  return PROSE_PRONOUNS.has(first.toLowerCase()) && PROSE_COPULAS.has(second.toLowerCase());
}

/**
 * True when `name` reads like a place label rather than a fragment of the
 * assistant's prose.
 *
 * The backend card extractor can put a whole line of the reply into `name`:
 * its regex path falls back to the block's first non-empty line, and its LLM
 * path only rejects empty strings. Either way the mobile client is the last
 * stop before the value is persisted as a place, so it is checked here.
 *
 * Deliberately conservative — it rejects only shapes a real place name does
 * not have, and lets anything ambiguous through.
 */
export function looksLikePlaceName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (trimmed.length > PLACE_NAME_MAX_LENGTH) return false;
  if (trimmed.split(/\s+/).length > PLACE_NAME_MAX_WORDS) return false;
  if (EMBEDDED_COORDINATES_RE.test(trimmed)) return false;
  if (SENTENCE_FRAGMENT_TAIL_RE.test(trimmed)) return false;
  if (hasSentenceBreak(trimmed)) return false;
  if (hasProseOpener(trimmed)) return false;
  return true;
}

function normalizeBackendPlaceCards(cards: NonNullable<import('@/services/api/apiService').AtlasChatResponse['place_cards']>): PlaceActionCard[] {
  return cards
    .map((card) => ({
      status: card.status,
      places: (card.places || [])
        .filter((place) => {
          if (looksLikePlaceName(place.name || '')) return true;
          // Loud on purpose: this silently wrote prose into the places table.
          console.warn('[AIChatBox] dropped place card with non-name:', place.name);
          return false;
        })
        .map((place) => ({
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
  onOpenHistory?: () => void;
  onNewChat?: () => void;
  title?: string;
  visible?: boolean;
  conversationId?: string | null;
  showLanding?: boolean;
  onPlacesCommitted?: (places: ParsedPlace[], action: PendingMode) => void;
};

type GlassIconButtonProps = {
  icon: Icon;
  label: string;
  onPress?: () => void;
};

function GlassIconButton({ icon: IconComponent, label, onPress }: GlassIconButtonProps) {
  return (
    <View style={styles.glassButtonShadow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={!onPress}
        onPress={onPress}
        style={({ pressed }) => [
          styles.glassButton,
          pressed && styles.glassButtonPressed,
          !onPress && styles.glassButtonDisabled,
        ]}
      >
        {LIQUID_GLASS_AVAILABLE ? (
          <GlassView
            style={StyleSheet.absoluteFill}
            glassEffectStyle="regular"
            tintColor="rgba(255,255,255,0.35)"
            isInteractive
          />
        ) : (
          <View pointerEvents="none" style={styles.glassButtonFallback} />
        )}
        <IconComponent
          size={24}
          weight="regular"
          color={COLOR.foreground}
        />
      </Pressable>
    </View>
  );
}

export default function AIChatBox({
  places,
  onClose,
  onOpenHistory,
  onNewChat,
  title,
  visible = true,
  conversationId = null,
  showLanding = false,
  onPlacesCommitted,
}: AIChatBoxProps) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
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
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [inputContentHeight, setInputContentHeight] = useState(21);
  const [messageFeedback, setMessageFeedback] = useState<
    Record<string, MessageFeedback | undefined>
  >({});
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const hydratedConversationIdRef = useRef<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const lastWelcomeKeyRef = useRef<string>('');

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      if (Platform.OS === 'ios') Keyboard.scheduleLayoutAnimation(event);
      setKeyboardVisible(true);
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, (event) => {
      if (Platform.OS === 'ios') Keyboard.scheduleLayoutAnimation(event);
      setKeyboardVisible(false);
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!visible) return;

    const focusTimer = setTimeout(() => {
      inputRef.current?.focus();
    }, reducedMotion ? 0 : 320);

    return () => clearTimeout(focusTimer);
  }, [reducedMotion, visible]);

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
        const restoredMessages: Message[] = (detail.messages || [])
          .filter(
            (message) =>
              !(
                message.role === 'user' &&
                message.content.trim().startsWith('CONFIRM_ADD_PLACES ')
              ),
          )
          .map((message, index) => ({
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
    const feedbackText = displayText.trim() || item.text.trim();
    const selectedFeedback = messageFeedback[item.id];
    const toggleFeedback = (feedback: MessageFeedback) => {
      setMessageFeedback((current) => ({
        ...current,
        [item.id]: current[item.id] === feedback ? undefined : feedback,
      }));
    };
    const copyResponse = () => {
      void Clipboard.setStringAsync(feedbackText);
    };
    const shareResponse = () => {
      void Share.share({ message: feedbackText }).catch((error) => {
        console.warn('[AIChatBox] share response failed:', error);
      });
    };
    const showMoreActions = () => {
      Alert.alert('Response actions', undefined, [
        { text: 'Copy', onPress: copyResponse },
        { text: 'Share', onPress: shareResponse },
        { text: 'Cancel', style: 'cancel' },
      ]);
    };
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
                  disabledPin && styles.actionCardButtonDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.actionCardButtonText,
                    disabledPin && styles.actionCardButtonTextDisabled,
                  ]}
                >
                  Add to this map
                </Text>
                <ArrowRightIcon
                  size={16}
                  weight="bold"
                  color={disabledPin ? '#9CA3AF' : COLOR.foreground}
                />
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
                <ArrowRightIcon
                  size={16}
                  weight="bold"
                  color={disabledSave ? '#9CA3AF' : COLOR.foreground}
                />
              </TouchableOpacity>
            </View>
          </View>
        );
      });
    return (
      <View style={[styles.messageRow, isUser ? styles.messageRowUser : styles.messageRowAssistant]}>
        {isUser ? (
          <View style={styles.userBubble}>
            <Text style={[styles.messageText, styles.userText]}>
              {item.text}
            </Text>
          </View>
        ) : (
          <View style={styles.assistantContent}>
            <View style={styles.assistantMessageText}>
              <Text style={styles.assistantLabel}>Atlas AI</Text>
              {displayText ? <Markdown style={markdownStyles}>{displayText}</Markdown> : null}
            </View>
            {cardParsed.cards.length > 0
              ? cardParsed.cards.map((card) => renderCards(card))
              : null}
            <View style={styles.feedbackBar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Helpful response"
                accessibilityState={{ selected: selectedFeedback === 'up' }}
                onPress={() => toggleFeedback('up')}
                style={({ pressed }) => [
                  styles.feedbackButton,
                  pressed && styles.feedbackButtonPressed,
                ]}
              >
                <ThumbsUpIcon
                  size={16}
                  weight={selectedFeedback === 'up' ? 'fill' : 'bold'}
                  color={selectedFeedback === 'up' ? COLOR.foreground : '#717171'}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Not helpful response"
                accessibilityState={{ selected: selectedFeedback === 'down' }}
                onPress={() => toggleFeedback('down')}
                style={({ pressed }) => [
                  styles.feedbackButton,
                  pressed && styles.feedbackButtonPressed,
                ]}
              >
                <ThumbsDownIcon
                  size={16}
                  weight={selectedFeedback === 'down' ? 'fill' : 'bold'}
                  color={selectedFeedback === 'down' ? COLOR.foreground : '#717171'}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copy response"
                onPress={copyResponse}
                style={({ pressed }) => [
                  styles.feedbackButton,
                  pressed && styles.feedbackButtonPressed,
                ]}
              >
                <CopyIcon size={16} weight="bold" color="#717171" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share response"
                onPress={shareResponse}
                style={({ pressed }) => [
                  styles.feedbackButton,
                  pressed && styles.feedbackButtonPressed,
                ]}
              >
                <ShareIcon size={16} weight="bold" color="#717171" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="More response actions"
                onPress={showMoreActions}
                style={({ pressed }) => [
                  styles.feedbackButton,
                  pressed && styles.feedbackButtonPressed,
                ]}
              >
                <DotsThreeIcon size={16} weight="bold" color="#717171" />
              </Pressable>
            </View>
          </View>
        )}
      </View>
    );
  };

  if (!visible) return null;

  const hasComposerText = inputText.length > 0;
  const landingVisible =
    showLanding && !messages.some((message) => message.role === 'user');
  const hasStartedChat = messages.some((message) => message.role === 'user');
  const headerTop = Math.max(insets.top, 56);
  const headerOverlayHeight = headerTop + 68;
  const composerHeight = hasComposerText
    ? Math.min(196, Math.max(120, inputContentHeight + 72))
    : 56;
  const composerEdgeGap = keyboardVisible ? 12 : 28;
  const composerBottom = keyboardHeight + composerEdgeGap;
  const composerOverlayHeight = composerHeight + composerBottom + 56;
  const headerMaterialHeight = headerOverlayHeight - 32;
  const composerMaterialHeight = composerHeight + composerEdgeGap + 6;
  const bottomMaterialOffset =
    landingVisible && keyboardVisible ? 0 : keyboardHeight;

  const sendButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Send message"
      onPress={handleSend}
      disabled={!inputText.trim() || pending}
      style={({ pressed }) => [
        styles.sendButton,
        pressed && inputText.trim() && !pending && styles.sendButtonPressed,
      ]}
    >
      {pending ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <ArrowUpIcon size={20} weight="regular" color="#FFFFFF" />
      )}
    </Pressable>
  );

  return (
    <Animated.View
      entering={reducedMotion ? undefined : CHAT_ENTER_TRANSITION}
      style={styles.screen}
    >
      <View style={styles.container}>
        {landingVisible ? (
          <>
            <LinearGradient
              pointerEvents="none"
              colors={['#F4F4F5', '#F4F4F5', '#DDF5E9', '#BDEDDC']}
              locations={[0, 0.34, 0.68, 1]}
              style={StyleSheet.absoluteFill}
            />
            <View pointerEvents="none" style={styles.landingBackground}>
              <View style={styles.landingHero}>
                <Image
                  source={ATLAS_AI_MARK}
                  resizeMode="contain"
                  style={styles.landingMark}
                />
                <Text style={styles.landingTitle}>
                  Hey Jay! Start explore{'\n'}with Atlas AI
                </Text>
              </View>
            </View>
            <View style={styles.starterPrompts}>
              {STARTER_PROMPTS.map((prompt) => (
                <Pressable
                  key={prompt}
                  accessibilityRole="button"
                  accessibilityLabel={prompt}
                  onPress={() => setInputText(prompt)}
                  style={({ pressed }) => [
                    styles.starterPrompt,
                    pressed && styles.starterPromptPressed,
                  ]}
                >
                  <MagnifyingGlassIcon
                    size={20}
                    weight="regular"
                    color="#717171"
                  />
                  <Text numberOfLines={1} style={styles.starterPromptText}>
                    {prompt}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {!landingVisible ? (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            style={styles.list}
            contentContainerStyle={[
              styles.listContent,
              {
                paddingTop: headerOverlayHeight - 1,
                paddingBottom: composerOverlayHeight,
              },
            ]}
            contentInsetAdjustmentBehavior="never"
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            scrollIndicatorInsets={{
              top: headerOverlayHeight,
              bottom: composerHeight + composerBottom,
            }}
            showsVerticalScrollIndicator={false}
          />
        ) : null}

        <TopBlurFade
          height={headerMaterialHeight}
          intensity={5}
          tint="systemThinMaterialLight"
          scrim={1}
        />

        <View
          pointerEvents="none"
          style={[
            styles.bottomMaterial,
            {
              bottom: bottomMaterialOffset,
              height: composerMaterialHeight,
            },
          ]}
        >
          <TopBlurFade
            edge="bottom"
            height={composerMaterialHeight}
            intensity={5}
            tint="systemUltraThinMaterialLight"
            scrim={1}
          />
        </View>

        <View style={[styles.header, { paddingTop: headerTop }]}>
          <View style={styles.headerControls}>
            <GlassIconButton icon={XIcon} label="Close chat" onPress={onClose} />
            <View
              style={[
                styles.headerActionGroupShadow,
                !hasStartedChat && styles.headerActionGroupShadowSingle,
              ]}
            >
              <View
                style={[
                  styles.headerActionGroup,
                  !hasStartedChat && styles.headerActionGroupSingle,
                ]}
              >
                {LIQUID_GLASS_AVAILABLE ? (
                  <GlassView
                    pointerEvents="none"
                    style={StyleSheet.absoluteFill}
                    glassEffectStyle="regular"
                    tintColor="rgba(255,255,255,0.35)"
                  />
                ) : (
                  <View pointerEvents="none" style={styles.glassButtonFallback} />
                )}
                {hasStartedChat ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Start a new chat"
                    onPress={onNewChat}
                    disabled={!onNewChat}
                    style={({ pressed }) => [
                      styles.headerActionButton,
                      pressed && styles.glassButtonPressed,
                      !onNewChat && styles.glassButtonDisabled,
                    ]}
                  >
                    <PencilSimpleLineIcon
                      size={24}
                      weight="regular"
                      color={COLOR.foreground}
                    />
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open chat history"
                  onPress={onOpenHistory}
                  disabled={!onOpenHistory}
                  style={({ pressed }) => [
                    styles.headerActionButton,
                    pressed && styles.glassButtonPressed,
                    !onOpenHistory && styles.glassButtonDisabled,
                  ]}
                >
                  <ClockIcon size={24} weight="regular" color={COLOR.foreground} />
                </Pressable>
              </View>
            </View>
          </View>
        </View>

        <View
          style={[
            styles.composerWrap,
            { bottom: composerBottom },
          ]}
        >
          <Animated.View
            layout={COMPOSER_LAYOUT_TRANSITION}
            style={[
              styles.composer,
              {
                height: composerHeight,
                marginHorizontal: 12,
                borderRadius: hasComposerText ? 24 : 32,
              },
            ]}
          >
            {LIQUID_GLASS_AVAILABLE ? (
              <GlassView
                pointerEvents="none"
                style={StyleSheet.absoluteFill}
                glassEffectStyle="regular"
                tintColor="rgba(255,255,255,0.45)"
              />
            ) : (
              <BlurView
                pointerEvents="none"
                style={StyleSheet.absoluteFill}
                tint="systemMaterialLight"
                intensity={100}
              />
            )}
            <View pointerEvents="none" style={styles.composerFrost} />

            <TextInput
              ref={inputRef}
              value={inputText}
              onChangeText={setInputText}
              onContentSizeChange={({ nativeEvent }) => {
                setInputContentHeight(Math.max(21, Math.ceil(nativeEvent.contentSize.height)));
              }}
              placeholder="Ask AtlasAI"
              placeholderTextColor="#B0B0B0"
              style={[
                styles.composerInput,
                hasComposerText ? styles.composerInputExpanded : styles.composerInputCompact,
              ]}
              multiline
              textAlignVertical="top"
              scrollEnabled={composerHeight >= 196}
              editable={!pending}
            />

            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.composerLeadingAction}
            >
              <PlusIcon size={24} weight="regular" color={COLOR.foreground} />
            </View>

            <View style={styles.composerTrailingActions}>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.utilityButton}
              >
                <MicrophoneIcon size={24} weight="regular" color={COLOR.foreground} />
              </View>

              {sendButton}
            </View>
          </Animated.View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 46,
    backgroundColor: COLOR.background,
  },
  container: {
    flex: 1,
    backgroundColor: COLOR.background,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    paddingHorizontal: 16,
    backgroundColor: 'transparent',
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 44,
    position: 'relative',
  },
  headerActionGroupShadow: {
    width: 96,
    height: 44,
    borderRadius: 22,
    boxShadow: '0 10px 26px rgba(0,0,0,0.16)',
  },
  headerActionGroupShadowSingle: {
    width: 48,
  },
  headerActionGroup: {
    width: 96,
    height: 44,
    borderRadius: 22,
    borderCurve: 'continuous',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingHorizontal: 12,
  },
  headerActionGroupSingle: {
    width: 48,
  },
  headerActionButton: {
    width: 24,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassButtonShadow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    boxShadow: '0 10px 26px rgba(0,0,0,0.16)',
  },
  glassButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassButtonFallback: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(255,255,255,0.48)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.82)',
  },
  glassButtonPressed: {
    transform: [{ scale: 0.96 }],
  },
  glassButtonDisabled: {
    opacity: 0.45,
  },
  list: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  landingBackground: {
    position: 'absolute',
    top: 118,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  landingHero: {
    alignItems: 'center',
    gap: 16,
  },
  landingMark: {
    width: 72,
    height: 72,
  },
  landingTitle: {
    color: '#1A1A1A',
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '400',
    letterSpacing: -0.32,
    textAlign: 'center',
  },
  starterPrompts: {
    position: 'absolute',
    top: 316,
    left: 12,
    right: 12,
    zIndex: 1,
    alignItems: 'flex-start',
    gap: 8,
  },
  starterPrompt: {
    maxWidth: '100%',
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 32,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F7F7F7',
    borderWidth: 0.5,
    borderColor: '#E0E0E0',
  },
  starterPromptPressed: {
    opacity: 0.65,
    transform: [{ scale: 0.98 }],
  },
  starterPromptText: {
    flexShrink: 1,
    color: '#717171',
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: -0.16,
  },
  messageRow: {
    width: '100%',
    marginBottom: 24,
    flexDirection: 'row',
  },
  messageRowUser: {
    justifyContent: 'flex-end',
    paddingLeft: 80,
  },
  messageRowAssistant: {
    justifyContent: 'flex-start',
  },
  userBubble: {
    maxWidth: '100%',
    borderRadius: 18,
    borderCurve: 'continuous',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#E9FBF1',
  },
  assistantContent: {
    flex: 1,
    gap: 12,
  },
  assistantMessageText: {
    gap: 8,
  },
  assistantLabel: {
    color: '#717171',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    letterSpacing: -0.16,
  },
  actionCard: {
    gap: 12,
  },
  actionCardTitle: {
    ...typography.body,
    color: '#111827',
    fontWeight: '600',
    letterSpacing: -0.16,
  },
  actionCardBody: {
    ...typography.bodySmall,
    color: '#4B5563',
    lineHeight: 19,
  },
  actionCardButtons: {
    alignItems: 'flex-start',
    gap: 12,
  },
  actionCardButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  actionCardButtonText: {
    color: COLOR.foreground,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    letterSpacing: -0.16,
  },
  actionCardButtonDisabled: {
    opacity: 0.4,
  },
  actionCardButtonTextDisabled: {
    color: '#9CA3AF',
  },
  feedbackBar: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
  },
  feedbackButton: {
    width: 24,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackButtonPressed: {
    opacity: 0.45,
    transform: [{ scale: 0.94 }],
  },
  messageText: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    letterSpacing: -0.16,
  },
  userText: {
    color: '#000000',
  },
  composerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 3,
  },
  bottomMaterial: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 2,
  },
  composer: {
    position: 'relative',
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.88)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.09)',
  },
  composerFrost: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  composerInput: {
    position: 'absolute',
    padding: 0,
    color: COLOR.foreground,
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.31,
  },
  composerInputCompact: {
    top: 16,
    right: 100,
    left: 52,
    height: 24,
  },
  composerInputExpanded: {
    top: 16,
    right: 16,
    bottom: 56,
    left: 16,
  },
  composerLeadingAction: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerTrailingActions: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  utilityButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLOR.primary,
  },
  sendButtonPressed: {
    transform: [{ scale: 0.94 }],
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
    color: '#000000',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    letterSpacing: -0.16,
  },
  heading3: {
    color: '#000000',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    marginBottom: 6,
    marginTop: 0,
  },
  strong: {
    fontWeight: '600',
    color: '#111827',
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 0,
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
