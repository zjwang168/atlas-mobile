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
import { ClockIcon } from 'phosphor-react-native/src/icons/Clock';
import { CopyIcon } from 'phosphor-react-native/src/icons/Copy';
import { DotsThreeIcon } from 'phosphor-react-native/src/icons/DotsThree';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { PencilSimpleLineIcon } from 'phosphor-react-native/src/icons/PencilSimpleLine';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { ShareIcon } from 'phosphor-react-native/src/icons/Share';
import { ThumbsDownIcon } from 'phosphor-react-native/src/icons/ThumbsDown';
import { ThumbsUpIcon } from 'phosphor-react-native/src/icons/ThumbsUp';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated as NativeAnimated,
  FlatList,
  Image,
  Keyboard,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  TextInput,
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
import VoiceInputButton from '@/components/voice-input/VoiceInputButton';
import { useAppDialog } from '@/components/feedback/AppDialog';
import { useHome } from '@/features/home/HomeContext';
import type { MapMarker } from '@/features/map/MapboxMap';
import TopBlurFade from '@/components/ui/top-blur-fade';
import AtlasChatResultCard from './AtlasChatResultCard';
import { AtlasChatMapControls, AtlasChatMapItinerary, AtlasChatMapPlacePopup } from './AtlasChatMapOverlay';
import {
  chatWithAtlasStream,
  confirmAtlasChatAction,
  createChatSession,
  createImportChatWelcome,
  createAtlasChatWelcome,
  fetchConversation,
  requestAtlasRoute,
  type AtlasChatPresentation,
} from '@/services/api/apiService';
import { addAtlasOwnedPlaces, queueAtlasPlacePhotoBackfill } from '@/services/atlas/atlasPlacesService';
import { encodeAtlasPlaceMetadata } from '@/services/atlas/atlasPlaceMetadata';
import { createAtlas } from '@/services/atlas/atlasService';
import { isSamePlace, queueSavedPlacePhotoBackfill, savePlaces } from '@/services/place/placeService';
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
const IMPORT_STARTER_PROMPTS = [
  'Build a day plan around these saved places',
  'Group these places by neighborhood',
  'What should I add nearby?',
] as const;
const ATLAS_STARTER_PROMPTS = [
  'Tighten this route and travel times',
  'Build a day-by-day schedule for this Atlas',
  'What should I add near one of these stops?',
] as const;

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  thinkingStartedAt?: number;
  thoughtDurationSeconds?: number;
  presentation?: AtlasChatPresentation | null;
  starterPrompts?: readonly string[];
  pendingAction?: {
    action_id: string;
    kind: 'save_places' | 'create_atlas';
    title: string;
    places: AtlasChatPresentation['places'];
    planning_note?: string | null;
  } | null;
};

type MessageFeedback = 'up' | 'down';

function stripActionMarkers(text: string): string {
  return text
    .replace(/\[\[PLACE_ACTION_CARD:[\s\S]*?\]\]/g, '')
    .replace(/\[\[CONFIRM_ADD_PLACES:[\s\S]*?\]\]/g, '')
    .trim();
}

function normalizeAssistantText(text: string): string {
  const latexSymbol: Record<string, string> = {
    alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', theta: 'theta',
    pi: 'pi', sigma: 'sigma', omega: 'omega', times: 'x', cdot: 'x',
    leq: '<=', geq: '>=', neq: '!=', approx: '~', pm: '+/-', degree: 'deg',
  };
  return text
    // Some model responses put a space before the closing bold marker, which
    // CommonMark correctly treats as literal source instead of bold text.
    .replace(/\*\*([^*\n]+?):\s*\*\*/g, '**$1:** ')
    .replace(/\\\[([\s\S]*?)\\\]/g, '$1')
    .replace(/\\\(([\s\S]*?)\\\)/g, '$1')
    .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '$1/$2')
    .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]+)\}/g, '$1')
    .replace(/\\([a-zA-Z]+)/g, (_match, command: string) => latexSymbol[command] ?? command)
    .replace(/\{\s*([^{}]+)\s*\}/g, '$1')
    // Do not pass emphasis markers through the mobile Markdown implementation:
    // some valid Chinese-label variants still render the source asterisks.
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1');
}

function parseStoredToolResults(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
  );
  if (typeof value !== 'string') return [];
  try {
    return parseStoredToolResults(JSON.parse(value));
  } catch {
    return [];
  }
}

function restorePresentationFromToolResults(value: unknown): AtlasChatPresentation | null {
  const toolResults = parseStoredToolResults(value);

  for (const toolResult of [...toolResults].reverse()) {
    const result = toolResult.result;
    if (!result || typeof result !== 'object') continue;
    const data = result as Record<string, unknown>;
    const presentation = data.presentation;
    if (presentation && typeof presentation === 'object') {
      const candidate = presentation as AtlasChatPresentation;
      if (Array.isArray(candidate.places) && typeof candidate.kind === 'string') return candidate;
    }
    const proposal = data.proposal;
    if (proposal && typeof proposal === 'object') {
      const action = proposal as Record<string, unknown>;
      if (Array.isArray(action.places)) {
        return {
          kind: action.kind === 'create_atlas' ? 'atlas_draft' : 'places_map',
          title: typeof action.title === 'string' ? action.title : 'Map result',
          places: action.places as AtlasChatPresentation['places'],
          planning_note: typeof action.planning_note === 'string' ? action.planning_note : null,
          route: null,
        };
      }
    }

    if (!Array.isArray(data.places)) continue;
    if (toolResult.name === 'find_nearby_places') {
      const query = typeof data.query === 'string' ? data.query : 'places';
      return {
        kind: 'nearby_map',
        title: `Nearby ${query}`,
        places: data.places as AtlasChatPresentation['places'],
        route: (data.route as AtlasChatPresentation['route']) ?? null,
      };
    }
    if (toolResult.name === 'extract_pasted_places') {
      return {
        kind: 'places_map',
        title: typeof data.title === 'string' ? data.title : 'Places from your text',
        places: data.places as AtlasChatPresentation['places'],
        route: (data.route as AtlasChatPresentation['route']) ?? null,
      };
    }
  }

  return null;
}

function FadingStreamToken({ token, reducedMotion }: { token: string; reducedMotion: boolean }) {
  const progress = useRef(new NativeAnimated.Value(reducedMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reducedMotion) return;
    progress.setValue(0);
    const animation = NativeAnimated.timing(progress, {
      toValue: 1,
      duration: 360,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion]);

  return (
    <NativeAnimated.Text style={[styles.streamingToken, { opacity: progress }]}>
      {token}
    </NativeAnimated.Text>
  );
}

function ThinkingIndicator({ reducedMotion }: { reducedMotion: boolean }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const breathingOpacity = useRef(new NativeAnimated.Value(1)).current;

  useEffect(() => {
    const timer = setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const breathing = NativeAnimated.loop(
      NativeAnimated.sequence([
        NativeAnimated.timing(breathingOpacity, { toValue: 0.45, duration: 760, useNativeDriver: true }),
        NativeAnimated.timing(breathingOpacity, { toValue: 1, duration: 760, useNativeDriver: true }),
      ]),
    );
    breathing.start();
    return () => breathing.stop();
  }, [breathingOpacity, reducedMotion]);

  return (
    <View style={styles.thinkingRow}>
      <NativeAnimated.Text style={[styles.assistantLabel, { opacity: breathingOpacity }]}>Atlas AI</NativeAnimated.Text>
      <Text style={styles.thinkingText}>thinking {elapsedSeconds}s</Text>
    </View>
  );
}

function StreamingAssistantText({ text, reducedMotion }: { text: string; reducedMotion: boolean }) {
  const displayTokens = Array.from(text);

  return (
    <View style={styles.streamingResponseText}>
      {displayTokens.map((token, index) => (
        token === '\n' ? (
          <View key={`${index}:line-break`} style={styles.streamingLineBreak} />
        ) : (
          <FadingStreamToken
            key={`${index}:${token}`}
            token={token}
            reducedMotion={reducedMotion}
          />
        )
      ))}
    </View>
  );
}


type AIChatBoxProps = {
  places: ParsedPlace[];
  onClose: () => void;
  onOpenHistory?: () => void;
  onNewChat?: () => void;
  title?: string;
  visible?: boolean;
  conversationId?: string | null;
  importWelcome?: { deselectedPlaces: ParsedPlace[] } | null;
  atlasWelcome?: { places: AtlasChatPresentation['places'] } | null;
  showLanding?: boolean;
  onPresentationMapOpen?: () => void;
  onPresentationMapReturn?: () => void;
  onPresentationMapClose?: () => void;
};

type ChatMapPlace = AtlasChatPresentation['places'][number] & { markerId: string };
type RouteFeature = GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>;

function chatMapPlaceId(place: AtlasChatPresentation['places'][number], index: number): string {
  return `chat-map-place-${place.external_id || index}`;
}

function boundsForChatMarkers(markers: MapMarker[]) {
  if (markers.length < 2) return undefined;
  const longitudes = markers.map((marker) => marker.longitude);
  const latitudes = markers.map((marker) => marker.latitude);
  const longitudePadding = Math.max(0.003, (Math.max(...longitudes) - Math.min(...longitudes)) * 0.18);
  const latitudePadding = Math.max(0.003, (Math.max(...latitudes) - Math.min(...latitudes)) * 0.18);
  return {
    ne: [Math.max(...longitudes) + longitudePadding, Math.max(...latitudes) + latitudePadding] as [number, number],
    sw: [Math.min(...longitudes) - longitudePadding, Math.min(...latitudes) - latitudePadding] as [number, number],
  };
}

function distanceLabel(origin: [number, number], destination: [number, number]): string {
  const toRadians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = toRadians(destination[1] - origin[1]);
  const longitudeDelta = toRadians(destination[0] - origin[0]);
  const latitudeFactor = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(origin[1])) * Math.cos(toRadians(destination[1])) * Math.sin(longitudeDelta / 2) ** 2;
  const kilometers = 6371 * 2 * Math.atan2(Math.sqrt(latitudeFactor), Math.sqrt(1 - latitudeFactor));
  return kilometers < 1 ? `${Math.max(10, Math.round(kilometers * 1000 / 10) * 10)} m` : `${kilometers.toFixed(kilometers < 10 ? 1 : 0)} km`;
}

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
  importWelcome = null,
  atlasWelcome = null,
  showLanding = false,
  onPresentationMapOpen,
  onPresentationMapReturn,
  onPresentationMapClose,
}: AIChatBoxProps) {
  const { show: showDialog } = useAppDialog();
  const {
    addChatHistoryItem,
    replaceChatHistoryItem,
    savedPlaces,
    deleteSavedPlace,
    setAtlasMapState,
    setOverlay,
    userLocation,
  } = useHome();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [inputContentHeight, setInputContentHeight] = useState(21);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [messageFeedback, setMessageFeedback] = useState<
    Record<string, MessageFeedback | undefined>
  >({});
  const [chatMapPresentation, setChatMapPresentation] = useState<AtlasChatPresentation | null>(null);
  const [chatMapSelectedId, setChatMapSelectedId] = useState<string | null>(null);
  const [chatMapSelectedRoute, setChatMapSelectedRoute] = useState<RouteFeature | null>(null);
  const [chatMapOverviewRoute, setChatMapOverviewRoute] = useState<RouteFeature | null>(null);
  const [chatMapOverviewRouteVisible, setChatMapOverviewRouteVisible] = useState(false);
  const [chatMapRouteLoading, setChatMapRouteLoading] = useState(false);
  const [chatMapCameraKey, setChatMapCameraKey] = useState(0);
  const [chatMapSaveBusy, setChatMapSaveBusy] = useState(false);
  const [chatMapSavedMarkerId, setChatMapSavedMarkerId] = useState<string | null>(null);
  const [chatMapNotice, setChatMapNotice] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const hydratedConversationIdRef = useRef<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const lastWelcomeKeyRef = useRef<string>('');
  const streamQueueRef = useRef<string[]>([]);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const streamCompletionRef = useRef<(() => void) | null>(null);
  const streamedTextRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const historyItemIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const chatMapRouteRequestRef = useRef(0);
  const chatMapNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestChatMapStateKeyRef = useRef<string | null>(null);
  const resolvingActionIdsRef = useRef(new Set<string>());

  const scrollToLatest = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      flatListRef.current?.scrollToEnd({ animated: false });
    });
  }, []);

  const finishDisplayedStream = () => {
    const messageId = streamingMessageIdRef.current;
    if (messageId) {
      setMessages((current) => current.map((message) => (
        message.id === messageId
          ? {
              ...message,
              streaming: false,
              thoughtDurationSeconds: Math.max(
                1,
                Math.round((Date.now() - (message.thinkingStartedAt ?? Date.now())) / 1000),
              ),
            }
          : message
      )));
    }
    streamCompletionRef.current = null;
    streamingMessageIdRef.current = null;
    setPending(false);
  };

  const flushStreamQueue = () => {
    const messageId = streamingMessageIdRef.current;
    const nextTokens = streamQueueRef.current.splice(0, reducedMotion ? streamQueueRef.current.length : 8).join('');
    if (messageId && nextTokens) {
      setMessages((current) => current.map((message) => (
        message.id === messageId ? { ...message, text: `${message.text}${nextTokens}` } : message
      )));
      scrollToLatest();
      return;
    }

    if (streamTimerRef.current) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    const complete = streamCompletionRef.current;
    if (complete) complete();
  };

  const startStreamQueue = () => {
    if (!streamTimerRef.current) {
      streamTimerRef.current = setInterval(flushStreamQueue, reducedMotion ? 0 : 16);
    }
  };

  const enqueueStreamDelta = (delta: string) => {
    streamQueueRef.current.push(...Array.from(delta));
    streamedTextRef.current = true;
    startStreamQueue();
  };

  const completeStreamAfterDisplay = () => {
    streamCompletionRef.current = finishDisplayedStream;
    if (!streamTimerRef.current && streamQueueRef.current.length === 0) {
      finishDisplayedStream();
    }
  };

  useEffect(() => () => {
    if (streamTimerRef.current) clearInterval(streamTimerRef.current);
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    if (chatMapNoticeTimerRef.current) clearTimeout(chatMapNoticeTimerRef.current);
  }, []);

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

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(scrollToLatest);
    return () => cancelAnimationFrame(frame);
  }, [inputContentHeight, keyboardHeight, messages.length, scrollToLatest, visible]);

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
      user_location: userLocation,
    });
    setSessionId(created.session_id);
    conversationIdRef.current = created.conversation_id ?? null;
    return created.session_id;
  };

  useEffect(() => {
    const welcomeKey = `${conversationId ?? 'new'}|${title ?? ''}|${places
      .map((place) => `${place.id}:${place.name}:${place.latitude.toFixed(5)}:${place.longitude.toFixed(5)}`)
      .join('|')}`;

    if (!conversationId && lastWelcomeKeyRef.current !== welcomeKey) {
      lastWelcomeKeyRef.current = welcomeKey;
      setSessionId(null);
      conversationIdRef.current = null;
      historyItemIdRef.current = null;
      setPending(false);
      setInputText('');
      setMessages([]);
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
          .map((message, index) => {
            const presentation = message.role === 'assistant'
              ? restorePresentationFromToolResults(message.tool_results)
              : null;
            const isImportWelcome = Boolean(
              presentation && parseStoredToolResults(message.tool_results)
                .some((result) => result.name === 'import_welcome'),
            );
            const isAtlasWelcome = Boolean(
              presentation && parseStoredToolResults(message.tool_results)
                .some((result) => result.name === 'atlas_welcome'),
            );
            return {
              id: `${message.role}_${index}_${Date.now()}`,
              role: message.role === 'user' ? 'user' : 'assistant',
              text: message.content,
              presentation,
              starterPrompts: isImportWelcome ? IMPORT_STARTER_PROMPTS : isAtlasWelcome ? ATLAS_STARTER_PROMPTS : undefined,
            };
          });

        setSessionId(session.session_id);
        activeConversationIdRef.current = detail.session.conversation_id || conversationId;
        if ((importWelcome || atlasWelcome) && restoredMessages.length === 0) {
          setPending(true);
          setMessages([{
            id: `import_welcome_${Date.now()}`,
            role: 'assistant',
            text: '',
            streaming: true,
            thinkingStartedAt: Date.now(),
          }]);
          try {
            const welcome = importWelcome
              ? await createImportChatWelcome(
                session.session_id,
                importWelcome.deselectedPlaces.map((place) => ({
                  name: place.name,
                  latitude: place.latitude,
                  longitude: place.longitude,
                  full_address: place.subtitle,
                  category: place.type || 'Place',
                })),
              )
              : await createAtlasChatWelcome(session.session_id, atlasWelcome?.places ?? []);
            if (cancelled) return;
            setMessages([{
              id: `assistant_import_welcome_${Date.now()}`,
              role: 'assistant',
              text: welcome.response,
              presentation: welcome.presentation,
              starterPrompts: importWelcome ? IMPORT_STARTER_PROMPTS : ATLAS_STARTER_PROMPTS,
            }]);
          } catch (error) {
            if (cancelled) return;
            console.warn('[AIChatBox] import welcome failed:', error);
            setMessages([{
              id: `assistant_import_welcome_error_${Date.now()}`,
              role: 'assistant',
              text: atlasWelcome
                ? 'Hi, your saved Atlas is ready to explore. I can help you tighten the route, plan the schedule, or find another useful stop.'
                : 'Hi, your saved places are ready to explore. I can help you build a route, group nearby stops, or find something to add next.',
              presentation: {
                kind: atlasWelcome ? 'atlas_draft' : 'places_map',
                title: atlasWelcome ? (title || 'Saved Atlas') : `${places.length} saved ${places.length === 1 ? 'place' : 'places'}`,
                places: places.map((place) => ({
                  name: place.name,
                  latitude: place.latitude,
                  longitude: place.longitude,
                  full_address: place.subtitle,
                  description: place.subtitle,
                  category: place.type || 'Place',
                })),
                route: null,
              },
              starterPrompts: atlasWelcome ? ATLAS_STARTER_PROMPTS : IMPORT_STARTER_PROMPTS,
            }]);
          } finally {
            if (!cancelled) setPending(false);
          }
        } else {
          setMessages(restoredMessages);
        }
        hydratedConversationIdRef.current = conversationId;
      } catch (error) {
        console.warn('[AIChatBox] hydrateFromConversation failed:', error);
      }
    };

    hydrateFromConversation();

    return () => {
      cancelled = true;
    };
  }, [atlasWelcome, conversationId, importWelcome, places, title]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || pending) return;

    const assistantMessageId = `ai_${Date.now()}`;
    streamQueueRef.current = [];
    streamedTextRef.current = false;
    streamingMessageIdRef.current = assistantMessageId;

    setMessages((prev) => [
      ...prev,
      { id: `user_${Date.now()}`, role: 'user', text },
      {
        id: assistantMessageId,
        role: 'assistant',
        text: '',
        streaming: true,
        thinkingStartedAt: Date.now(),
      },
    ]);
    scrollToLatest();
    setInputText('');
    setPending(true);

    try {
      const currentSessionId = await ensureSession();
      const result = await chatWithAtlasStream(
        currentSessionId,
        text,
        { onToken: enqueueStreamDelta },
        activeConversationIdRef.current,
        userLocation,
      );
      setMessages((current) => current.map((message) => (
        message.id === assistantMessageId
          ? { ...message, presentation: result.presentation, pendingAction: result.pending_action }
          // The backend has one pending confirmation per chat. A revised Atlas
          // draft replaces the older proposal, so its old card must not remain
          // actionable and accidentally create the stale itinerary.
          : result.pending_action && message.pendingAction
            ? { ...message, pendingAction: null }
            : message
      )));
      const persistedConversationId = result.conversation_id ?? conversationIdRef.current;
      if (persistedConversationId && !historyItemIdRef.current) {
        const createdAt = new Date().toISOString();
        const historyItem = {
          id: persistedConversationId,
          title: text.slice(0, 100),
          sourceUrl: '',
          sourceType: 'atlas_ai',
          locationCount: places.length,
          messageCount: 2,
          places,
          createdAt,
          updatedAt: createdAt,
        };
        historyItemIdRef.current = addChatHistoryItem({
          title: historyItem.title,
          sourceUrl: historyItem.sourceUrl,
          sourceType: historyItem.sourceType,
          locationCount: historyItem.locationCount,
          messageCount: historyItem.messageCount,
          places: historyItem.places,
          updatedAt: historyItem.updatedAt,
        });
        replaceChatHistoryItem(historyItemIdRef.current, historyItem);
      }
    } catch (error) {
      if (!streamedTextRef.current) {
        enqueueStreamDelta('I couldn\'t respond just now. Please try sending that again in a moment.');
      }
    } finally {
      completeStreamAfterDisplay();
    }
  };

  const chatMapOrigin = useMemo<[number, number] | null>(() => {
    if (chatMapPresentation?.user_location) {
      return [chatMapPresentation.user_location.longitude, chatMapPresentation.user_location.latitude];
    }
    return userLocation ?? null;
  }, [chatMapPresentation?.user_location, userLocation]);

  const chatMapPlaces = useMemo<ChatMapPlace[]>(() => (chatMapPresentation?.places ?? []).map((place, index) => ({
    ...place,
    markerId: chatMapPlaceId(place, index),
  })), [chatMapPresentation?.places]);

  const chatMapMarkers = useMemo<MapMarker[]>(() => [
    ...(chatMapOrigin ? [{
      id: 'chat-user-location',
      latitude: chatMapOrigin[1],
      longitude: chatMapOrigin[0],
      title: 'You',
      tone: 'focused' as const,
    }] : []),
    ...chatMapPlaces.map((place, index) => ({
      id: place.markerId,
      latitude: place.latitude,
      longitude: place.longitude,
      title: place.name,
      description: place.full_address || place.description || undefined,
      tone: chatMapPresentation?.kind === 'atlas_draft' ? 'atlas' as const : 'recommended' as const,
      preserveToneOnSelect: chatMapPresentation?.kind !== 'atlas_draft',
      order: chatMapPresentation?.kind === 'atlas_draft' ? index + 1 : undefined,
    })),
  ], [chatMapOrigin, chatMapPlaces, chatMapPresentation?.kind]);

  const selectedChatMapPlace = useMemo(
    () => chatMapPlaces.find((place) => place.markerId === chatMapSelectedId) ?? null,
    [chatMapPlaces, chatMapSelectedId],
  );

  const savedChatMapPlace = useMemo(() => selectedChatMapPlace
    ? savedPlaces.find((place) => isSamePlace(place, selectedChatMapPlace)) ?? null
    : null, [savedPlaces, selectedChatMapPlace]);
  const chatMapPlaceSaved = Boolean(savedChatMapPlace)
    || chatMapSavedMarkerId === selectedChatMapPlace?.markerId;

  const showChatMapNotice = useCallback((notice: string) => {
    setChatMapNotice(notice);
    if (chatMapNoticeTimerRef.current) clearTimeout(chatMapNoticeTimerRef.current);
    chatMapNoticeTimerRef.current = setTimeout(() => {
      chatMapNoticeTimerRef.current = null;
      setChatMapNotice(null);
    }, 4000);
  }, []);

  const clearChatMapSelection = useCallback(() => {
    chatMapRouteRequestRef.current += 1;
    setChatMapSelectedId(null);
    setChatMapSelectedRoute(null);
  }, []);

  const toggleChatMapSavedPlace = useCallback(async () => {
    if (!selectedChatMapPlace || chatMapSaveBusy) return;
    setChatMapSaveBusy(true);
    try {
      if (chatMapPlaceSaved) {
        if (!savedChatMapPlace) return;
        await deleteSavedPlace(savedChatMapPlace.id);
        setChatMapSavedMarkerId(null);
        showChatMapNotice('Removed from My Places');
        return;
      }
      // Saving performs queue reconciliation and a server-side dedupe check.
      // Reflect the user's choice before those network round trips complete.
      setChatMapSavedMarkerId(selectedChatMapPlace.markerId);
      showChatMapNotice('Saved to My Places');
      const savedRows = await savePlaces([{
        id: selectedChatMapPlace.external_id || selectedChatMapPlace.markerId,
        name: selectedChatMapPlace.name,
        subtitle: selectedChatMapPlace.full_address || selectedChatMapPlace.description || '',
        type: selectedChatMapPlace.category || 'Place',
        latitude: selectedChatMapPlace.latitude,
        longitude: selectedChatMapPlace.longitude,
        imageUri: selectedChatMapPlace.photo_url || undefined,
        externalId: selectedChatMapPlace.external_id || undefined,
        externalSource: 'atlas_ai',
        city: selectedChatMapPlace.city || undefined,
        country: selectedChatMapPlace.country || undefined,
      }]);
      // savePlaces() now reports inserted and duplicate rows separately; this
      // wants both, which is what its old flat return gave.
      [...savedRows.inserted, ...savedRows.duplicates].forEach(queueSavedPlacePhotoBackfill);
    } catch (error) {
      if (!chatMapPlaceSaved) setChatMapSavedMarkerId(null);
      console.warn('[AIChatBox] could not update My Places:', error);
      showDialog({
        title: 'We could not update My Places',
        message: 'Please try again in a moment.',
        tone: 'warning',
      });
    } finally {
      setChatMapSaveBusy(false);
    }
  }, [chatMapPlaceSaved, chatMapSaveBusy, deleteSavedPlace, savedChatMapPlace, selectedChatMapPlace, showChatMapNotice, showDialog]);

  const selectChatMapPlace = useCallback(async (marker: MapMarker) => {
    const place = chatMapPlaces.find((item) => item.markerId === marker.id);
    if (!place) return;
    const requestId = chatMapRouteRequestRef.current + 1;
    chatMapRouteRequestRef.current = requestId;
    setChatMapSelectedId(place.markerId);
    setChatMapSelectedRoute(null);
    if (!chatMapOrigin) return;
    try {
      const result = await requestAtlasRoute([
        chatMapOrigin,
        [place.longitude, place.latitude],
      ]);
      if (chatMapRouteRequestRef.current === requestId) setChatMapSelectedRoute(result.route);
    } catch (error) {
      console.warn('[AIChatBox] could not load selected-place route:', error);
    }
  }, [chatMapOrigin, chatMapPlaces]);

  const toggleChatMapOverviewRoute = useCallback(async () => {
    if (chatMapOverviewRouteVisible) {
      setChatMapOverviewRouteVisible(false);
      return;
    }
    if (chatMapOverviewRoute) {
      setChatMapOverviewRouteVisible(true);
      return;
    }
    const coordinates = [
      ...(chatMapOrigin ? [chatMapOrigin] : []),
      ...chatMapPlaces.map((place) => [place.longitude, place.latitude] as [number, number]),
    ];
    if (coordinates.length < 2) return;
    setChatMapRouteLoading(true);
    try {
      const result = await requestAtlasRoute(coordinates);
      setChatMapOverviewRoute(result.route);
      setChatMapOverviewRouteVisible(true);
    } catch (error) {
      console.warn('[AIChatBox] could not load overview route:', error);
      showDialog({
        title: 'Route unavailable',
        message: 'We could not load a route for these places. Please try again.',
        tone: 'warning',
      });
    } finally {
      setChatMapRouteLoading(false);
    }
  }, [chatMapOrigin, chatMapOverviewRoute, chatMapOverviewRouteVisible, chatMapPlaces, showDialog]);

  const returnFromPresentationMap = useCallback(() => {
    clearChatMapSelection();
    setChatMapPresentation(null);
    setAtlasMapState(null);
    onPresentationMapReturn?.();
  }, [clearChatMapSelection, onPresentationMapReturn, setAtlasMapState]);

  const closePresentationMap = useCallback(() => {
    clearChatMapSelection();
    setChatMapPresentation(null);
    setAtlasMapState(null);
    if (onPresentationMapClose) onPresentationMapClose();
    else onClose();
  }, [clearChatMapSelection, onClose, onPresentationMapClose, setAtlasMapState]);

  const chatMapRoute = chatMapSelectedRoute
    ?? (chatMapOverviewRouteVisible ? chatMapOverviewRoute : null);
  const chatMapRouteKey = useMemo(
    () => chatMapRoute ? JSON.stringify(chatMapRoute.geometry.coordinates) : 'none',
    [chatMapRoute],
  );
  const chatMapPopup = useMemo(() => selectedChatMapPlace && chatMapOrigin ? (
    <AtlasChatMapPlacePopup
      name={selectedChatMapPlace.name}
      address={selectedChatMapPlace.full_address || selectedChatMapPlace.description}
      distanceLabel={distanceLabel(chatMapOrigin, [selectedChatMapPlace.longitude, selectedChatMapPlace.latitude])}
      origin={chatMapOrigin}
      destination={[selectedChatMapPlace.longitude, selectedChatMapPlace.latitude]}
      saved={chatMapPlaceSaved}
      saving={chatMapSaveBusy}
      onToggleSaved={() => { void toggleChatMapSavedPlace(); }}
    />
  ) : null, [chatMapOrigin, chatMapPlaceSaved, chatMapSaveBusy, selectedChatMapPlace, toggleChatMapSavedPlace]);
  const chatMapOverlay = useMemo(() => <AtlasChatMapControls
    topInset={insets.top}
    onReturn={returnFromPresentationMap}
    onClose={closePresentationMap}
    placePopup={chatMapPopup}
    atlasItinerary={chatMapPresentation?.kind === 'atlas_draft' ? <AtlasChatMapItinerary presentation={chatMapPresentation} /> : null}
    notice={chatMapNotice}
  />, [chatMapNotice, chatMapPopup, chatMapPresentation, closePresentationMap, insets.top, returnFromPresentationMap]);
  const chatMapStateKey = [
    chatMapCameraKey,
    chatMapPresentation?.kind ?? 'none',
    chatMapMarkers.map((marker) => `${marker.id}:${marker.longitude.toFixed(6)}:${marker.latitude.toFixed(6)}:${marker.tone ?? 'saved'}`).join('|'),
    chatMapSelectedId ?? 'none',
    chatMapRouteKey,
    chatMapOverviewRouteVisible ? 'overview' : 'route-hidden',
    chatMapRouteLoading ? 'route-loading' : 'route-idle',
    chatMapSaveBusy ? 'save-loading' : 'save-idle',
    chatMapPlaceSaved ? 'saved' : 'unsaved',
    chatMapNotice ?? 'no-notice',
  ].join('::');

  useEffect(() => {
    if (!chatMapPresentation) {
      latestChatMapStateKeyRef.current = null;
      return;
    }
    if (latestChatMapStateKeyRef.current === chatMapStateKey) return;
    latestChatMapStateKeyRef.current = chatMapStateKey;
    setAtlasMapState({
      markers: chatMapMarkers,
      centerCoordinate: chatMapOrigin ?? (chatMapMarkers[0] ? [chatMapMarkers[0].longitude, chatMapMarkers[0].latitude] : undefined),
      bounds: boundsForChatMarkers(chatMapMarkers),
      zoomLevel: chatMapMarkers.length > 1 ? 13 : 15,
      cameraKey: `chat-map-${chatMapCameraKey}`,
      cameraAnimationDurationMs: 420,
      routeGeoJSON: chatMapRoute ?? undefined,
      selectedMarkerId: chatMapSelectedId,
      onMarkerPress: (marker) => { void selectChatMapPlace(marker); },
      onMapPress: clearChatMapSelection,
      markerPopup: null,
      overlay: chatMapOverlay,
      hideChrome: true,
    });
  }, [chatMapCameraKey, chatMapMarkers, chatMapOrigin, chatMapOverlay, chatMapPresentation, chatMapRoute, chatMapSelectedId, chatMapStateKey, clearChatMapSelection, selectChatMapPlace, setAtlasMapState]);

  const openPresentationMap = useCallback((presentation: AtlasChatPresentation) => {
    chatMapRouteRequestRef.current += 1;
    setChatMapPresentation(presentation);
    setChatMapSelectedId(null);
    setChatMapSelectedRoute(null);
    setChatMapOverviewRoute(presentation.route?.route ?? null);
    setChatMapOverviewRouteVisible(false);
    setChatMapRouteLoading(false);
    setChatMapCameraKey(Date.now());
    onPresentationMapOpen?.();
  }, [onPresentationMapOpen]);

  const resolveAction = async (messageId: string, accepted: boolean) => {
    const message = messages.find((item) => item.id === messageId);
    const action = message?.pendingAction;
    if (!action || !sessionId || resolvingActionIdsRef.current.has(action.action_id)) return;
    resolvingActionIdsRef.current.add(action.action_id);

    // A confirmed place save has an optimistic local row. Do not hold the chat
    // open for Supabase, background photo enrichment, or action bookkeeping.
    if (accepted && action.kind === 'save_places') {
      setMessages((current) => current.map((item) => (
        item.id === messageId ? { ...item, pendingAction: null } : item
      )));
      const placesToSave = action.places.map((place, index) => ({
        id: place.external_id || 'chat-place-' + index,
        name: place.name,
        subtitle: place.full_address || place.description || '',
        type: place.category || 'Place',
        latitude: place.latitude,
        longitude: place.longitude,
        imageUri: place.photo_url || undefined,
        externalId: place.external_id || undefined,
        externalSource: 'atlas_ai',
        city: place.city || undefined,
        region: place.region || undefined,
        country: place.country || undefined,
      }));
      void savePlaces(placesToSave)
        .then((savedRows) => {
          [...savedRows.inserted, ...savedRows.duplicates].forEach(queueSavedPlacePhotoBackfill);
          return confirmAtlasChatAction(sessionId, action.action_id, true, {
            saved_place_count: action.places.length,
          });
        })
        .catch((error) => {
          console.warn('[AIChatBox] could not save proposed places:', error);
          showDialog({
            title: 'We could not save these places',
            message: 'Please try again in a moment.',
            tone: 'warning',
          });
        })
        .finally(() => resolvingActionIdsRef.current.delete(action.action_id));
      onClose();
      return;
    }
    try {
      let createdAtlasId: string | null = null;
      if (accepted && action.kind === 'create_atlas') {
        const atlas = await createAtlas(action.title);
        const atlasRows = await addAtlasOwnedPlaces(atlas.id, action.places.map((place, index) => ({
          id: place.external_id || 'chat-atlas-place-' + index,
          external_place_id: place.external_id || 'chat-atlas-place-' + index,
          name: place.name,
          subtitle: place.full_address || place.description || '',
          latitude: place.latitude,
          longitude: place.longitude,
          photo_url: place.photo_url || null,
          note: encodeAtlasPlaceMetadata(null, place.transport || null),
          city: place.city || null,
          region: place.region || null,
          country: place.country || null,
          timeline_day: place.timeline_day ?? null,
          timeline_time: place.timeline_time ?? null,
        })));
        atlasRows.forEach(queueAtlasPlacePhotoBackfill);
        createdAtlasId = atlas.id;
      }
      await confirmAtlasChatAction(sessionId, action.action_id, accepted, {
        created_atlas_id: createdAtlasId,
        saved_place_count: accepted ? action.places.length : 0,
      });
      setMessages((current) => current.map((item) => (
        item.id === messageId ? { ...item, pendingAction: null } : item
      )));
      if (createdAtlasId) {
        setOverlay({ kind: 'atlasDetail', atlasId: createdAtlasId });
        onClose();
      }
    } catch (error) {
      showDialog({
        title: accepted ? 'We could not apply this change' : 'We could not cancel this proposal',
        message: 'Nothing has been confirmed in this chat. Please try again.',
        tone: 'warning',
      });
    } finally {
      resolvingActionIdsRef.current.delete(action.action_id);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    const displayText = normalizeAssistantText(stripActionMarkers(item.text));
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
      showDialog({
        title: 'Response actions',
        message: 'Choose what you would like to do with this response.',
        actions: [
          { label: 'Cancel' },
          { label: 'Copy', onPress: copyResponse },
          { label: 'Share', variant: 'primary', onPress: shareResponse },
        ],
      });
    };
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
              {item.streaming && !displayText ? <ThinkingIndicator reducedMotion={reducedMotion} /> : null}
              {!item.streaming || displayText ? (
                <View style={styles.thinkingRow}>
                  <Text style={styles.assistantLabel}>Atlas AI</Text>
                  {item.thoughtDurationSeconds ? (
                    <Text style={styles.thinkingText}>thought {item.thoughtDurationSeconds}s</Text>
                  ) : null}
                </View>
              ) : null}
              {item.streaming && displayText ? (
                <StreamingAssistantText text={displayText} reducedMotion={reducedMotion} />
              ) : displayText ? (
                <Markdown style={markdownStyles}>{displayText}</Markdown>
              ) : null}
              {item.presentation ? (
                <AtlasChatResultCard
                  presentation={item.presentation}
                  pendingAction={item.pendingAction}
                  onOpenMap={() => openPresentationMap(item.presentation!)}
                  onConfirm={() => { void resolveAction(item.id, true); }}
                  onCancel={() => { void resolveAction(item.id, false); }}
                />
              ) : null}
              {item.starterPrompts?.length ? (
                <View style={styles.importStarterPrompts}>
                  {item.starterPrompts.map((prompt) => (
                    <Pressable
                      key={prompt}
                      accessibilityRole="button"
                      accessibilityLabel={prompt}
                      onPress={() => {
                        setInputText(prompt);
                        inputRef.current?.focus();
                      }}
                      style={({ pressed }) => [styles.importStarterPrompt, pressed && styles.importStarterPromptPressed]}
                    >
                      <Text style={styles.importStarterPromptText}>{prompt}</Text>
                      <ArrowUpIcon size={14} weight="bold" color="#0C8149" />
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
            {!item.streaming ? <View style={styles.feedbackBar}>
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
            </View> : null}
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
  const composerOverlayHeight = composerHeight + composerBottom + 96;
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
                // Keep the final assistant line above the floating composer.
                // The extra breathing room also covers the composer shadow and
                // the keyboard transition on smaller screens.
                paddingBottom: composerOverlayHeight + 64,
              },
            ]}
            contentInsetAdjustmentBehavior="never"
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={scrollToLatest}
            scrollIndicatorInsets={{
              top: headerOverlayHeight,
              bottom: composerHeight + composerBottom + 64,
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
              placeholder={voiceRecording ? 'Hold to speak' : 'Ask AtlasAI'}
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
              <VoiceInputButton
                disabled={pending}
                onRecordingChange={setVoiceRecording}
                onTranscript={(text) => setInputText((current) => current ? `${current} ${text}` : text)}
                style={styles.utilityButton}
              />

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
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  thinkingText: {
    color: '#A1A1AA',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: 0,
  },
  streamingResponseText: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
  },
  streamingToken: {
    color: '#000000',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    letterSpacing: -0.16,
  },
  streamingLineBreak: {
    width: '100%',
    height: 0,
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
  importStarterPrompts: { marginTop: 12, gap: 8 },
  importStarterPrompt: { minHeight: 38, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#CDE9D9', backgroundColor: '#F4FCF7', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  importStarterPromptPressed: { backgroundColor: '#E6F8EC' },
  importStarterPromptText: { flex: 1, color: '#12613B', fontSize: 13, lineHeight: 18, fontWeight: '700' },
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
