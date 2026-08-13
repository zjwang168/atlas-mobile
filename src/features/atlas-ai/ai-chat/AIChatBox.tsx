import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import type { Icon } from 'phosphor-react-native';
import { ArrowUpIcon } from 'phosphor-react-native/src/icons/ArrowUp';
import { ClockIcon } from 'phosphor-react-native/src/icons/Clock';
import { CopyIcon } from 'phosphor-react-native/src/icons/Copy';
import { DotsThreeIcon } from 'phosphor-react-native/src/icons/DotsThree';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { KeyboardIcon } from 'phosphor-react-native/src/icons/Keyboard';
import { ShareIcon } from 'phosphor-react-native/src/icons/Share';
import { ThumbsDownIcon } from 'phosphor-react-native/src/icons/ThumbsDown';
import { ThumbsUpIcon } from 'phosphor-react-native/src/icons/ThumbsUp';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { WaveformIcon } from 'phosphor-react-native/src/icons/Waveform';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
  FadeIn,
  FadeInUp,
  FadeOut,
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
  getPlacePhoto,
  requestAtlasRoute,
  type AtlasChatPresentation,
} from '@/services/api/apiService';
import { addAtlasOwnedPlaces, queueAtlasPlacePhotoBackfill } from '@/services/atlas/atlasPlacesService';
import { encodeAtlasPlaceMetadata } from '@/services/atlas/atlasPlaceMetadata';
import { createAtlas } from '@/services/atlas/atlasService';
import { deletePlace, isSamePlace, queueSavedPlacePhotoBackfill, savePlaces, saveSpecialPlace } from '@/services/place/placeService';
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
const CHAT_PLACE_PHOTO_CACHE = new Map<string, string | null>();
const CHAT_PLACE_PHOTO_REQUESTS = new Map<string, Promise<string | null>>();
const CHAT_PLACE_PHOTO_CONCURRENCY = 2;
let activeChatPlacePhotoRequests = 0;
const queuedChatPlacePhotoRequests: Array<() => void> = [];
const IMAGE_TEXT_REQUEST_RE = /\b(?:read|extract|recognize|recognise|scan|ocr) (?:the )?(?:text|words|writing)|(?:图片|图像|照片).{0,8}(?:文字|读字|识别文字)|(?:识别|读取).{0,8}(?:图片|图像|照片).{0,8}(?:文字|文本)/i;

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  imageUri?: string | null;
  streaming?: boolean;
  thinkingStartedAt?: number;
  thoughtDurationSeconds?: number;
  thoughtText?: string;
  agentStatus?: string;
  presentation?: AtlasChatPresentation | null;
  starterPrompts?: readonly string[];
  pendingAction?: {
    action_id: string;
    kind: 'save_places' | 'create_atlas' | 'save_special_place' | 'delete_special_place';
    title: string;
    places: AtlasChatPresentation['places'];
    planning_note?: string | null;
    special_role?: 'home' | 'office' | 'school' | null;
    operation?: 'create' | 'update' | 'delete' | null;
  } | null;
  completedAction?: {
    kind: 'save_special_place';
    special_role: 'home' | 'office' | 'school';
    placeName: string;
  } | null;
};

type MessageFeedback = 'up' | 'down';

type ChatPresentationPlace = AtlasChatPresentation['places'][number];

function currentLocationCommuteRole(text: string): 'home' | 'office' | 'school' | null {
  const fromCurrent = /\bfrom (?:my place|where i am|my location)\b|从我的地方(?:出发)?|从我这(?:里|儿)?出发|从当前位置出发/i.test(text);
  if (!fromCurrent) return null;
  if (/\b(?:to|toward|going to) (?:my )?(?:office|company|work)\b|(?:去|到)(?:我的)?(?:公司|办公室|单位)/i.test(text)) return 'office';
  if (/\b(?:to|back to|going home) (?:my )?home\b|回(?:我的)?家/i.test(text)) return 'home';
  if (/\b(?:to|toward|going to) (?:my )?(?:school|campus|university)\b|(?:去|到)(?:我的)?(?:学校|校园|大学)/i.test(text)) return 'school';
  return null;
}

function normalizeCommutePresentation(
  presentation: AtlasChatPresentation | null | undefined,
  pendingAction: Message['pendingAction'],
  conversationText: string,
  userLocation: [number, number] | null | undefined,
): AtlasChatPresentation | null | undefined {
  if (!presentation) return presentation;
  const userTurns = conversationText.split('\n').filter(Boolean);
  const currentTurnRole = currentLocationCommuteRole(userTurns.at(-1) ?? '');
  const contextualRole = pendingAction?.kind === 'save_special_place'
    ? currentLocationCommuteRole(userTurns.slice(-3).join('\n'))
    : null;
  const role = currentTurnRole
    ?? (contextualRole === pendingAction?.special_role ? contextualRole : null);
  if (!role) return presentation;
  const actionPlace = pendingAction?.kind === 'save_special_place'
    && pendingAction.special_role === role
    ? pendingAction.places[0]
    : null;
  const existingDestination = presentation.commute_destination
    ?? presentation.special_places?.find((place) => place.role === role);
  const source = actionPlace ?? existingDestination;
  if (!source) return presentation;
  const destination = {
    role,
    name: source.name || role[0].toUpperCase() + role.slice(1),
    latitude: source.latitude,
    longitude: source.longitude,
    full_address: source.full_address,
  };
  return {
    ...presentation,
    user_location: presentation.user_location ?? (userLocation ? {
      longitude: userLocation[0],
      latitude: userLocation[1],
    } : undefined),
    special_places: [
      ...(presentation.special_places ?? []).filter((place) => place.role !== role),
      destination,
    ],
    commute_destination: destination,
  };
}

function limitChatPlacePhotoRequest<T>(work: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeChatPlacePhotoRequests += 1;
      void work()
        .then(resolve, reject)
        .finally(() => {
          activeChatPlacePhotoRequests -= 1;
          queuedChatPlacePhotoRequests.shift()?.();
        });
    };
    if (activeChatPlacePhotoRequests < CHAT_PLACE_PHOTO_CONCURRENCY) run();
    else queuedChatPlacePhotoRequests.push(run);
  });
}

function chatPlacePhotoKey(place: Pick<ChatPresentationPlace, 'name' | 'latitude' | 'longitude'>): string {
  return `${place.name.trim().toLocaleLowerCase()}:${place.latitude.toFixed(4)}:${place.longitude.toFixed(4)}`;
}

async function fetchChatPlacePhoto(place: ChatPresentationPlace): Promise<string | null> {
  const key = chatPlacePhotoKey(place);
  if (CHAT_PLACE_PHOTO_CACHE.has(key)) return CHAT_PLACE_PHOTO_CACHE.get(key) ?? null;
  const existingRequest = CHAT_PLACE_PHOTO_REQUESTS.get(key);
  if (existingRequest) return existingRequest;
  const request = limitChatPlacePhotoRequest(() => getPlacePhoto(place.name))
    .then((response) => response.photo_url || null)
    .catch((error) => {
      console.warn('[AIChatBox] map card photo lookup failed:', error);
      return null;
    })
    .then((photoUrl) => {
      CHAT_PLACE_PHOTO_CACHE.set(key, photoUrl);
      CHAT_PLACE_PHOTO_REQUESTS.delete(key);
      return photoUrl;
    });
  CHAT_PLACE_PHOTO_REQUESTS.set(key, request);
  return request;
}

function applyChatPlacePhoto(
  presentation: AtlasChatPresentation,
  key: string,
  photoUrl: string,
): AtlasChatPresentation {
  let changed = false;
  const places = presentation.places.map((place) => {
    if (place.photo_url || chatPlacePhotoKey(place) !== key) return place;
    changed = true;
    return { ...place, photo_url: photoUrl };
  });
  return changed ? { ...presentation, places } : presentation;
}

function stripActionMarkers(text: string): string {
  return text
    .replace(/\[\[PLACE_ACTION_CARD:[\s\S]*?\]\]/g, '')
    .replace(/\[\[CONFIRM_ADD_PLACES:[\s\S]*?\]\]/g, '')
    .trim();
}

function splitThoughtMarkup(text: string): { response: string; thoughts: string } {
  let response = '';
  let thoughts = '';
  let remaining = text;
  while (remaining) {
    const start = remaining.indexOf('<think>');
    if (start < 0) {
      response += remaining;
      break;
    }
    response += remaining.slice(0, start);
    const afterStart = remaining.slice(start + '<think>'.length);
    const end = afterStart.indexOf('</think>');
    if (end < 0) {
      thoughts += afterStart;
      break;
    }
    thoughts += afterStart.slice(0, end);
    remaining = afterStart.slice(end + '</think>'.length);
  }
  return { response: response.trim(), thoughts: thoughts.trim() };
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

function restorePresentationFromToolResults(
  value: unknown,
  conversationText = '',
  userLocation?: [number, number] | null,
): AtlasChatPresentation | null {
  const toolResults = parseStoredToolResults(value);
  let specialAction: Message['pendingAction'] = null;

  for (const toolResult of toolResults) {
    const result = toolResult.result;
    if (!result || typeof result !== 'object') continue;
    const proposal = (result as Record<string, unknown>).proposal;
    if (!proposal || typeof proposal !== 'object') continue;
    const candidate = proposal as Message['pendingAction'];
    if (candidate?.kind === 'save_special_place' && Array.isArray(candidate.places)) {
      specialAction = candidate;
    }
  }

  // New messages persist this final presentation after every tool has run.
  for (const toolResult of [...toolResults].reverse()) {
    const result = toolResult.result;
    if (!result || typeof result !== 'object') continue;
    const data = result as Record<string, unknown>;
    const presentation = data.presentation;
    if (presentation && typeof presentation === 'object') {
      const candidate = presentation as AtlasChatPresentation;
      if (Array.isArray(candidate.places) && typeof candidate.kind === 'string') return candidate;
    }
  }

  // Older messages only persisted individual tool outputs. Prefer an actual
  // search result over the save proposal, then merge its special destination.
  for (const toolResult of [...toolResults].reverse()) {
    const result = toolResult.result;
    if (!result || typeof result !== 'object') continue;
    const data = result as Record<string, unknown>;
    if (!Array.isArray(data.places)) continue;
    let candidate: AtlasChatPresentation | null = null;
    if (toolResult.name === 'find_verified_places') {
      candidate = {
        kind: 'nearby_map',
        title: 'Live-verified nearby places',
        user_location: userLocation ? { longitude: userLocation[0], latitude: userLocation[1] } : undefined,
        places: data.places as AtlasChatPresentation['places'],
        special_places: (data.special_places as AtlasChatPresentation['special_places']) ?? [],
        route: (data.route as AtlasChatPresentation['route']) ?? null,
        commute_route: (data.commute_route as AtlasChatPresentation['commute_route']) ?? null,
      };
    } else if (toolResult.name === 'find_nearby_places') {
      const query = typeof data.query === 'string' ? data.query : 'places';
      candidate = {
        kind: 'nearby_map',
        title: `Nearby ${query}`,
        user_location: userLocation ? { longitude: userLocation[0], latitude: userLocation[1] } : undefined,
        places: data.places as AtlasChatPresentation['places'],
        route: (data.route as AtlasChatPresentation['route']) ?? null,
      };
    } else if (toolResult.name === 'find_places_between_special_places') {
      candidate = {
        kind: 'places_map',
        title: 'Places along your route',
        user_location: userLocation ? { longitude: userLocation[0], latitude: userLocation[1] } : undefined,
        places: data.places as AtlasChatPresentation['places'],
        special_places: (data.special_places as AtlasChatPresentation['special_places']) ?? [],
        route: (data.route as AtlasChatPresentation['route']) ?? null,
      };
    } else if (toolResult.name === 'extract_pasted_places') {
      candidate = {
        kind: 'places_map',
        title: typeof data.title === 'string' ? data.title : 'Places from your text',
        places: data.places as AtlasChatPresentation['places'],
        route: (data.route as AtlasChatPresentation['route']) ?? null,
      };
    }
    if (candidate) {
      return normalizeCommutePresentation(candidate, specialAction, conversationText, userLocation) ?? null;
    }
  }

  for (const toolResult of [...toolResults].reverse()) {
    const result = toolResult.result;
    if (!result || typeof result !== 'object') continue;
    const data = result as Record<string, unknown>;
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
  }

  return null;
}

function ThinkingIndicator({
  reducedMotion,
  status,
}: {
  reducedMotion: boolean;
  status?: string;
}) {
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
      <Text style={styles.thinkingText}>{status || 'Thinking'} {elapsedSeconds}s</Text>
    </View>
  );
}

function StreamingAssistantText({ text }: { text: string }) {
  // Keep streaming output as one native text node. Rendering one animated
  // component per character makes the view and native animation graph grow
  // on every token, eventually starving the UI thread and crashing on mobile.
  return (
    <Text style={styles.streamingToken}>{text}</Text>
  );
}

function StreamingThoughtText({ text }: { text: string }) {
  return <Text style={styles.streamingThoughtText}>{text}</Text>;
}


type AIChatBoxProps = {
  places: ParsedPlace[];
  onClose: () => void;
  onOpenHistory?: () => void;
  title?: string;
  visible?: boolean;
  conversationId?: string | null;
  importWelcome?: { deselectedPlaces: ParsedPlace[] } | null;
  initialImportWelcome?: AtlasChatPresentation | null;
  initialWelcomeText?: string | null;
  initialSessionId?: string | null;
  sessionInitializing?: boolean;
  atlasWelcome?: { places: AtlasChatPresentation['places'] } | null;
  showLanding?: boolean;
  onPresentationMapOpen?: () => void;
  onPresentationMapReturn?: () => void;
  onPresentationMapClose?: () => void;
  initialPrompt?: string | null;
  autoSendInitialPrompt?: boolean;
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
  title,
  visible = true,
  conversationId = null,
  importWelcome = null,
  initialImportWelcome = null,
  initialWelcomeText = null,
  initialSessionId = null,
  sessionInitializing = false,
  atlasWelcome = null,
  showLanding = false,
  onPresentationMapOpen,
  onPresentationMapReturn,
  onPresentationMapClose,
  initialPrompt = null,
  autoSendInitialPrompt = false,
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
  const [voiceMode, setVoiceMode] = useState(false);
  const [attachedImageUri, setAttachedImageUri] = useState<string | null>(null);
  const [attachedImageBase64, setAttachedImageBase64] = useState<string | null>(null);
  const photoHydrationActiveRef = useRef(true);
  const scheduledChatPhotoKeysRef = useRef(new Set<string>());

  useEffect(() => {
    photoHydrationActiveRef.current = visible;
    if (visible) scheduledChatPhotoKeysRef.current.clear();
  }, [visible]);

  useEffect(() => () => {
    photoHydrationActiveRef.current = false;
  }, []);

  useEffect(() => {
    const targets = messages.flatMap((message) => (
      message.presentation?.places
        .filter((place) => !place.photo_url)
        .map((place) => ({ messageId: message.id, place })) ?? []
    )).filter((target) => {
      const key = `${target.messageId}:${chatPlacePhotoKey(target.place)}`;
      if (scheduledChatPhotoKeysRef.current.has(key)) return false;
      scheduledChatPhotoKeysRef.current.add(key);
      return true;
    });
    if (!targets.length) return;

    const hydrate = async () => {
      let cursor = 0;
      const worker = async () => {
        while (photoHydrationActiveRef.current && cursor < targets.length) {
          const target = targets[cursor++];
          const photoUrl = await fetchChatPlacePhoto(target.place);
          if (!photoUrl || !photoHydrationActiveRef.current) continue;
          const key = chatPlacePhotoKey(target.place);
          setMessages((current) => current.map((message) => (
            message.id === target.messageId && message.presentation
              ? { ...message, presentation: applyChatPlacePhoto(message.presentation, key, photoUrl) }
              : message
          )));
          setChatMapPresentation((current) => (
            current ? applyChatPlacePhoto(current, key, photoUrl) : current
          ));
        }
      };
      await Promise.all(Array.from(
        { length: Math.min(CHAT_PLACE_PHOTO_CONCURRENCY, targets.length) },
        () => worker(),
      ));
    };
    void hydrate();
  }, [messages]);

  const autoSentInitialPromptRef = useRef<string | null>(null);
  useEffect(() => {
    if (initialPrompt && !autoSendInitialPrompt && !inputText && !messages.length) setInputText(initialPrompt);
  }, [autoSendInitialPrompt, initialPrompt, inputText, messages.length]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [messageFeedback, setMessageFeedback] = useState<
    Record<string, MessageFeedback | undefined>
  >({});
  const [expandedThoughtIds, setExpandedThoughtIds] = useState<Record<string, boolean>>({});
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
  const [chatSaveNotice, setChatSaveNotice] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const hydratedConversationIdRef = useRef<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const lastWelcomeKeyRef = useRef<string>('');
  const streamQueueRef = useRef<string[]>([]);
  const streamMarkupBufferRef = useRef('');
  const streamInsideThinkRef = useRef(false);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const streamCompletionRef = useRef<(() => void) | null>(null);
  const streamedTextRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const responseScrollFrameRef = useRef<number | null>(null);
  const streamingResponseLayoutRef = useRef<{ id: string; y: number; height: number } | null>(null);
  const listHeightRef = useRef(0);
  const headerOverlayHeightRef = useRef(0);
  const composerOverlayHeightRef = useRef(0);
  const autoFollowLatestRef = useRef(true);
  const historyItemIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const chatMapRouteRequestRef = useRef(0);
  const chatMapNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatSaveNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestChatMapStateKeyRef = useRef<string | null>(null);
  const resolvingActionIdsRef = useRef(new Set<string>());
  const chatAbortControllerRef = useRef<AbortController | null>(null);
  const streamCancelledRef = useRef(false);

  useEffect(() => {
    if (!initialImportWelcome) return;
    const placeCount = places.length;
    const names = places.slice(0, 3).map((place) => place.name).join(', ');
    setMessages([{
      id: `instant_import_welcome_${Date.now()}`,
      role: 'assistant',
      text: initialWelcomeText || `Hi! Great picks - your ${placeCount} saved place${placeCount === 1 ? ' is' : 's are'} on the map below.\n\nWe can shape a route, group nearby stops, or find a great next place.`,
      presentation: initialImportWelcome,
      starterPrompts: IMPORT_STARTER_PROMPTS,
    }]);
  }, [conversationId, initialImportWelcome, places]);

  useEffect(() => {
    if (!initialSessionId) return;
    setSessionId(initialSessionId);
    conversationIdRef.current = initialSessionId;
    activeConversationIdRef.current = initialSessionId;
  }, [initialSessionId]);

  const scrollToLatest = useCallback(() => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      flatListRef.current?.scrollToEnd({ animated: false });
    });
  }, []);

  const scrollStreamingResponseIntoView = useCallback((animated: boolean) => {
    if (!autoFollowLatestRef.current || responseScrollFrameRef.current !== null) return;
    responseScrollFrameRef.current = requestAnimationFrame(() => {
      responseScrollFrameRef.current = null;
      const responseLayout = streamingResponseLayoutRef.current;
      const viewportHeight = listHeightRef.current;
      if (!responseLayout || !viewportHeight) return;

      const safeTop = headerOverlayHeightRef.current + 12;
      const safeBottom = viewportHeight - composerOverlayHeightRef.current - 16;
      const targetOffset = Math.max(
        0,
        responseLayout.y - safeTop,
        responseLayout.y + responseLayout.height - safeBottom,
      );
      autoFollowLatestRef.current = true;
      flatListRef.current?.scrollToOffset({
        offset: targetOffset,
        animated: animated && !reducedMotion,
      });
    });
  }, [reducedMotion]);

  const finishDisplayedStream = () => {
    const messageId = streamingMessageIdRef.current;
    if (messageId) {
      setMessages((current) => current.map((message) => (
        message.id === messageId
          ? {
              ...message,
              streaming: false,
              agentStatus: undefined,
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

  const appendParsedStreamText = (messageId: string, text: string, isThought: boolean) => {
    if (!text) return;
    setMessages((current) => current.map((message) => (
      message.id === messageId
        ? isThought
          ? { ...message, thoughtText: `${message.thoughtText ?? ''}${text}` }
          : { ...message, text: `${message.text}${text}`, agentStatus: undefined }
        : message
    )));
  };

  const parseStreamMarkup = (messageId: string, value: string, final = false) => {
    let source = `${streamMarkupBufferRef.current}${value}`;
    streamMarkupBufferRef.current = '';
    while (source) {
      const marker = streamInsideThinkRef.current ? '</think>' : '<think>';
      const markerIndex = source.indexOf(marker);
      if (markerIndex >= 0) {
        appendParsedStreamText(messageId, source.slice(0, markerIndex), streamInsideThinkRef.current);
        streamInsideThinkRef.current = !streamInsideThinkRef.current;
        source = source.slice(markerIndex + marker.length);
        continue;
      }
      if (final) {
        appendParsedStreamText(messageId, source, streamInsideThinkRef.current);
        break;
      }
      // Keep a possible partial tag until the next streamed delta arrives.
      const holdLength = marker.length - 1;
      const flushLength = Math.max(0, source.length - holdLength);
      appendParsedStreamText(messageId, source.slice(0, flushLength), streamInsideThinkRef.current);
      streamMarkupBufferRef.current = source.slice(flushLength);
      break;
    }
  };

  const flushStreamQueue = () => {
    const messageId = streamingMessageIdRef.current;
    const nextTokens = streamQueueRef.current.splice(0, reducedMotion ? streamQueueRef.current.length : 8).join('');
    if (messageId && nextTokens) {
      parseStreamMarkup(messageId, nextTokens);
      scrollStreamingResponseIntoView(false);
      return;
    }

    if (streamTimerRef.current) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    if (messageId) parseStreamMarkup(messageId, '', true);
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

  const updateAgentStatus = (messageId: string, label: string) => {
    if (!label) return;
    setMessages((current) => current.map((message) => (
      message.id === messageId && message.streaming
        ? { ...message, agentStatus: label }
        : message
    )));
    scrollStreamingResponseIntoView(false);
  };

  const completeStreamAfterDisplay = () => {
    streamCompletionRef.current = finishDisplayedStream;
    if (!streamTimerRef.current && streamQueueRef.current.length === 0) {
      finishDisplayedStream();
    }
  };

  useEffect(() => () => {
    if (streamTimerRef.current) clearInterval(streamTimerRef.current);
    chatAbortControllerRef.current?.abort();
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    if (responseScrollFrameRef.current !== null) cancelAnimationFrame(responseScrollFrameRef.current);
    if (chatMapNoticeTimerRef.current) clearTimeout(chatMapNoticeTimerRef.current);
    if (chatSaveNoticeTimerRef.current) clearTimeout(chatSaveNoticeTimerRef.current);
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
    if (streamingMessageIdRef.current) return;
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

    if (!conversationId && !initialImportWelcome && lastWelcomeKeyRef.current !== welcomeKey) {
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
              ? restorePresentationFromToolResults(
                message.tool_results,
                (detail.messages || [])
                  .slice(0, index + 1)
                  .filter((item) => item.role === 'user')
                  .map((item) => item.content)
                  .join('\n'),
                userLocation,
              )
              : null;
            const isImportWelcome = Boolean(
              presentation && parseStoredToolResults(message.tool_results)
                .some((result) => result.name === 'import_welcome'),
            );
            const isAtlasWelcome = Boolean(
              presentation && parseStoredToolResults(message.tool_results)
                .some((result) => result.name === 'atlas_welcome'),
            );
            const content = message.role === 'assistant'
              ? splitThoughtMarkup(message.content)
              : { response: message.content, thoughts: '' };
            return {
              id: `${message.role}_${index}_${Date.now()}`,
              role: message.role === 'user' ? 'user' : 'assistant',
              text: content.response,
              thoughtText: content.thoughts || undefined,
              presentation,
              starterPrompts: isImportWelcome ? IMPORT_STARTER_PROMPTS : isAtlasWelcome ? ATLAS_STARTER_PROMPTS : undefined,
            };
          });

        setSessionId(session.session_id);
        activeConversationIdRef.current = detail.session.conversation_id || conversationId;
        if ((importWelcome || atlasWelcome) && restoredMessages.length === 0 && !initialImportWelcome) {
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
                : `Hi! Great picks - your ${places.length} saved ${places.length === 1 ? 'place is' : 'places are'} on the map below. We can shape a route, group nearby stops, or find a great next place.`,
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
        } else if (!initialImportWelcome) {
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
  }, [atlasWelcome, conversationId, importWelcome, initialImportWelcome, places, title]);

  const handleSend = async (submittedText = inputText.trim(), editingId?: string) => {
    const text = submittedText.trim();
    const imageUri = editingId ? null : attachedImageUri;
    const imageBase64 = editingId ? null : attachedImageBase64;
    const imageMode = imageBase64
      ? (IMAGE_TEXT_REQUEST_RE.test(text) ? 'read_text' : 'identify_location')
      : null;
    const message = text || (imageBase64 ? 'Find relevant places based on this image.' : '');
    if (!message || pending || sessionInitializing) return;

    const assistantMessageId = `ai_${Date.now()}`;
    streamQueueRef.current = [];
    streamMarkupBufferRef.current = '';
    streamInsideThinkRef.current = false;
    streamedTextRef.current = false;
    streamCancelledRef.current = false;
    streamingMessageIdRef.current = assistantMessageId;
    streamingResponseLayoutRef.current = null;
    autoFollowLatestRef.current = true;
    const controller = new AbortController();
    chatAbortControllerRef.current = controller;

    setMessages((prev) => {
      const base = editingId
        ? prev.slice(0, prev.findIndex((item) => item.id === editingId) + 1).map((item) => (
            item.id === editingId ? { ...item, text: message } : item
          ))
        : [...prev, { id: `user_${Date.now()}`, role: 'user' as const, text: message, imageUri }];
      return [...base, {
        id: assistantMessageId,
        role: 'assistant',
        text: '',
        streaming: true,
        thinkingStartedAt: Date.now(),
        agentStatus: 'Understanding your request',
      }];
    });
    setInputText('');
    setAttachedImageUri(null);
    setAttachedImageBase64(null);
    setEditingMessageId(null);
    setPending(true);

    try {
      const currentSessionId = await ensureSession();
      const result = await chatWithAtlasStream(
        currentSessionId,
        message,
        {
          onToken: enqueueStreamDelta,
          onStatus: (label) => updateAgentStatus(assistantMessageId, label),
        },
        activeConversationIdRef.current,
        userLocation,
        savedPlaces.flatMap((place) => place.special_role ? [{
          role: place.special_role,
          name: place.name,
          latitude: place.latitude,
          longitude: place.longitude,
          full_address: place.subtitle,
        }] : []),
        imageBase64,
        imageMode,
        controller.signal,
      );
      const normalizedPresentation = normalizeCommutePresentation(
        result.presentation,
        result.pending_action,
        [...messages.filter((item) => item.role === 'user').map((item) => item.text), message].join('\n'),
        userLocation,
      );
      setMessages((current) => current.map((message) => (
        message.id === assistantMessageId
          ? { ...message, presentation: normalizedPresentation, pendingAction: result.pending_action }
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
      if (!streamCancelledRef.current && !streamedTextRef.current) {
        enqueueStreamDelta('I couldn\'t respond just now. Please try sending that again in a moment.');
      }
    } finally {
      if (!streamCancelledRef.current) completeStreamAfterDisplay();
      if (chatAbortControllerRef.current === controller) chatAbortControllerRef.current = null;
    }
  };

  useEffect(() => {
    const prompt = initialPrompt?.trim();
    if (!autoSendInitialPrompt || !prompt || pending || sessionInitializing || messages.length || autoSentInitialPromptRef.current === prompt) return;
    autoSentInitialPromptRef.current = prompt;
    void handleSend(prompt);
  }, [autoSendInitialPrompt, initialPrompt, messages.length, pending, sessionInitializing]);

  const cancelStream = () => {
    if (!pending) return;
    streamCancelledRef.current = true;
    chatAbortControllerRef.current?.abort();
    chatAbortControllerRef.current = null;
    streamQueueRef.current = [];
    if (streamTimerRef.current) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    finishDisplayedStream();
  };

  const beginEditingMessage = (message: Message) => {
    if (pending || message.role !== 'user') return;
    setEditingMessageId(message.id);
    setInputText(message.text);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const pickChatImage = async () => {
    if (pending || sessionInitializing || attachedImageUri) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      selectionLimit: 1,
      quality: 0.65,
      base64: true,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (asset?.uri && asset.base64) {
      setInputContentHeight(21);
      setAttachedImageUri(asset.uri);
      setAttachedImageBase64(asset.base64);
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

  const chatMapCommuteDestination = chatMapPresentation?.commute_destination ?? null;
  const chatMapSpecialPlaces = useMemo(() => [
    ...(chatMapPresentation?.special_places ?? []).filter((place) => place.role !== chatMapCommuteDestination?.role),
    ...(chatMapCommuteDestination ? [chatMapCommuteDestination] : []),
  ], [chatMapCommuteDestination, chatMapPresentation?.special_places]);
  const chatMapIsCommute = Boolean(chatMapCommuteDestination);

  const chatMapMarkers = useMemo<MapMarker[]>(() => [
    ...(chatMapOrigin ? [{
      id: 'chat-user-location',
      latitude: chatMapOrigin[1],
      longitude: chatMapOrigin[0],
      title: 'You',
      tone: 'location' as const,
      pulsing: true,
    }] : []),
    ...chatMapSpecialPlaces.map((place) => ({
      id: `chat-special-${place.role}`,
      latitude: place.latitude,
      longitude: place.longitude,
      title: place.name || place.role[0].toUpperCase() + place.role.slice(1),
      description: place.full_address,
      // The destination of a commute remains visually distinct from the
      // purple recommendation and green origin, including before it is saved.
      tone: chatMapCommuteDestination?.role === place.role ? 'atlas' as const : place.role,
      preserveToneOnSelect: true,
    })),
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
  ], [chatMapCommuteDestination?.role, chatMapOrigin, chatMapPlaces, chatMapPresentation?.kind, chatMapSpecialPlaces]);

  // The map should enter on the AI outcome itself. Device and special-place
  // markers remain visible context, but must not zoom a single recommendation
  // out to an unrelated origin.
  const chatMapOutcomeMarkers = useMemo<MapMarker[]>(() => chatMapPlaces.map((place, index) => ({
    id: place.markerId,
    latitude: place.latitude,
    longitude: place.longitude,
    tone: chatMapPresentation?.kind === 'atlas_draft' ? 'atlas' as const : 'recommended' as const,
    order: chatMapPresentation?.kind === 'atlas_draft' ? index + 1 : undefined,
  })), [chatMapPlaces, chatMapPresentation?.kind]);

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

  const showChatSaveNotice = useCallback((notice: string) => {
    setChatSaveNotice(notice);
    if (chatSaveNoticeTimerRef.current) clearTimeout(chatSaveNoticeTimerRef.current);
    chatSaveNoticeTimerRef.current = setTimeout(() => {
      chatSaveNoticeTimerRef.current = null;
      setChatSaveNotice(null);
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
    setChatMapOverviewRouteVisible(false);
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
      clearChatMapSelection();
      setChatMapOverviewRouteVisible(true);
      return;
    }
    const coordinates = chatMapCommuteDestination && chatMapOrigin
      ? [chatMapOrigin, [chatMapCommuteDestination.longitude, chatMapCommuteDestination.latitude] as [number, number]]
      : [
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
  }, [chatMapCommuteDestination, chatMapOrigin, chatMapOverviewRoute, chatMapOverviewRouteVisible, chatMapPlaces, clearChatMapSelection, showDialog]);

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
  const chatMapRouteVariant = chatMapSelectedRoute ? undefined : chatMapIsCommute && chatMapOverviewRouteVisible ? 'commute' as const : undefined;
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
    routeToggle={chatMapIsCommute ? { visible: chatMapOverviewRouteVisible, loading: chatMapRouteLoading, onPress: () => { void toggleChatMapOverviewRoute(); } } : null}
  />, [chatMapIsCommute, chatMapNotice, chatMapOverviewRouteVisible, chatMapPopup, chatMapPresentation, chatMapRouteLoading, closePresentationMap, insets.top, returnFromPresentationMap, toggleChatMapOverviewRoute]);
  const chatMapStateKey = [
    chatMapCameraKey,
    chatMapPresentation?.kind ?? 'none',
    chatMapMarkers.map((marker) => `${marker.id}:${marker.longitude.toFixed(6)}:${marker.latitude.toFixed(6)}:${marker.tone ?? 'saved'}`).join('|'),
    chatMapSelectedId ?? 'none',
    chatMapRouteKey,
    chatMapRouteVariant ?? 'standard',
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
      centerCoordinate: chatMapOutcomeMarkers[0]
        ? [chatMapOutcomeMarkers[0].longitude, chatMapOutcomeMarkers[0].latitude]
        : (chatMapOrigin ?? (chatMapMarkers[0] ? [chatMapMarkers[0].longitude, chatMapMarkers[0].latitude] : undefined)),
      bounds: boundsForChatMarkers(chatMapOutcomeMarkers),
      zoomLevel: chatMapOutcomeMarkers.length > 1 ? 13 : 15,
      cameraKey: `chat-map-${chatMapCameraKey}`,
      cameraAnimationDurationMs: 420,
      disableRecommendedClustering: true,
      routeGeoJSON: chatMapRoute ?? undefined,
      routeVariant: chatMapRouteVariant,
      selectedMarkerId: chatMapSelectedId,
      onMarkerPress: (marker) => { void selectChatMapPlace(marker); },
      onMapPress: clearChatMapSelection,
      markerPopup: null,
      overlay: chatMapOverlay,
      hideChrome: true,
    });
  }, [chatMapCameraKey, chatMapMarkers, chatMapOrigin, chatMapOutcomeMarkers, chatMapOverlay, chatMapPresentation, chatMapRoute, chatMapRouteVariant, chatMapSelectedId, chatMapStateKey, clearChatMapSelection, selectChatMapPlace, setAtlasMapState]);

  const openPresentationMap = useCallback((presentation: AtlasChatPresentation) => {
    const requestId = chatMapRouteRequestRef.current + 1;
    chatMapRouteRequestRef.current = requestId;
    const destination = presentation.commute_destination;
    const origin = presentation.user_location
      ? [presentation.user_location.longitude, presentation.user_location.latitude] as [number, number]
      : userLocation;
    setChatMapPresentation(presentation);
    setChatMapSelectedId(null);
    setChatMapSelectedRoute(null);
    // A normal route points to the recommended venue. It must never stand in
    // for the direct commute route while that route is still being fetched.
    setChatMapOverviewRoute(destination
      ? (presentation.commute_route?.route ?? null)
      : (presentation.route?.route ?? null));
    // A commute map opens on the direct origin-to-destination route. Selecting
    // a recommendation temporarily retains the established orange route.
    setChatMapOverviewRouteVisible(Boolean(destination || presentation.commute_route?.route));
    setChatMapRouteLoading(Boolean(destination && !presentation.commute_route?.route && origin));
    setChatMapCameraKey(Date.now());
    onPresentationMapOpen?.();
    if (destination && origin && !presentation.commute_route?.route) {
      void requestAtlasRoute([origin, [destination.longitude, destination.latitude]])
        .then((result) => {
          if (chatMapRouteRequestRef.current === requestId) setChatMapOverviewRoute(result.route);
        })
        .catch((error) => {
          console.warn('[AIChatBox] could not load direct commute route:', error);
          if (chatMapRouteRequestRef.current === requestId) setChatMapOverviewRouteVisible(false);
        })
        .finally(() => {
          if (chatMapRouteRequestRef.current === requestId) setChatMapRouteLoading(false);
        });
    }
  }, [onPresentationMapOpen, userLocation]);

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
      if (accepted && action.kind === 'save_special_place') {
        const place = action.places[0];
        if (!place || !action.special_role) throw new Error('Special-place proposal is incomplete');
        await saveSpecialPlace(action.special_role, {
          name: place.name,
          subtitle: place.full_address || place.description || '',
          category: place.category || null,
          latitude: place.latitude,
          longitude: place.longitude,
          region: place.region || null,
          city: place.city || null,
          country: place.country || null,
          photo_url: place.photo_url || null,
        });
        // Chat action confirmation is audit bookkeeping only. The local place
        // cache has already been updated, so an unavailable audit endpoint
        // must not turn a saved Office/Home/School into a visible failure.
        void confirmAtlasChatAction(sessionId, action.action_id, true, {
          saved_place_count: 1,
        }).catch((error) => console.warn('[AIChatBox] special-place action audit failed:', error));
        setMessages((current) => current.map((item) => (
          item.id === messageId ? {
            ...item,
            pendingAction: null,
            completedAction: {
              kind: 'save_special_place',
              special_role: action.special_role!,
              placeName: place.name,
            },
          } : item
        )));
        showChatSaveNotice(`Saved "${place.name}" as ${action.special_role[0].toUpperCase()}${action.special_role.slice(1)} in My Places`);
        return;
      }
      if (accepted && action.kind === 'delete_special_place') {
        const target = savedPlaces.find((place) => place.special_role === action.special_role);
        if (!target) throw new Error('This special place is no longer saved');
        await deletePlace(target.id);
      }
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
    const thoughtText = item.thoughtText?.trim() ?? '';
    const isThoughtExpanded = Boolean(expandedThoughtIds[item.id]);
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit message"
            disabled={pending}
            onLongPress={() => beginEditingMessage(item)}
            delayLongPress={350}
            style={({ pressed }) => [styles.userBubble, pressed && !pending && styles.userBubblePressed]}
          >
            <Text style={[styles.messageText, styles.userText]}>
              {item.text}
            </Text>
            {item.imageUri ? <Image source={{ uri: item.imageUri }} style={styles.messageAttachmentImage} /> : null}
          </Pressable>
        ) : (
          <Animated.View
            entering={item.streaming && !reducedMotion ? FadeInUp.duration(180) : undefined}
            style={styles.assistantContent}
            onLayout={({ nativeEvent }) => {
              if (!item.streaming) return;
              streamingResponseLayoutRef.current = {
                id: item.id,
                y: nativeEvent.layout.y,
                height: nativeEvent.layout.height,
              };
              scrollStreamingResponseIntoView(true);
            }}
          >
            <View style={styles.assistantMessageText}>
              {item.streaming && !displayText && !thoughtText ? (
                <ThinkingIndicator reducedMotion={reducedMotion} status={item.agentStatus} />
              ) : null}
              {item.streaming && thoughtText && !displayText ? (
                <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={styles.streamingThoughtWrap}>
                  <StreamingThoughtText text={thoughtText} />
                </Animated.View>
              ) : null}
              {!item.streaming || displayText ? (
                <View style={styles.thinkingRow}>
                  <Text style={styles.assistantLabel}>Atlas AI</Text>
                  {item.thoughtDurationSeconds ? (
                    <Text style={styles.thinkingText}>thought {item.thoughtDurationSeconds}s</Text>
                  ) : null}
                  {thoughtText ? (
                    <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={isThoughtExpanded ? 'Hide thoughts' : 'Show thoughts'}
                        onPress={() => setExpandedThoughtIds((current) => ({
                          ...current,
                          [item.id]: !current[item.id],
                        }))}
                        style={({ pressed }) => [styles.thoughtToggle, pressed && styles.thoughtTogglePressed]}
                      >
                        <Animated.View
                          key={isThoughtExpanded ? 'hide' : 'show'}
                          entering={FadeIn.duration(120)}
                          exiting={FadeOut.duration(100)}
                        >
                          <Text style={styles.thinkingText}>{isThoughtExpanded ? 'hide thoughts' : 'thoughts'}</Text>
                        </Animated.View>
                      </Pressable>
                    </Animated.View>
                  ) : null}
                </View>
              ) : null}
              {thoughtText && isThoughtExpanded ? (
                <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={styles.expandedThoughtWrap}>
                  <Text style={styles.expandedThoughtText}>{thoughtText}</Text>
                </Animated.View>
              ) : null}
              {item.streaming && displayText ? (
                <StreamingAssistantText text={displayText} />
              ) : displayText ? (
                <Markdown style={markdownStyles}>{displayText}</Markdown>
              ) : null}
              {item.presentation ? (
                <AtlasChatResultCard
                  presentation={item.presentation}
                  pendingAction={item.pendingAction}
                  completedAction={item.completedAction}
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
          </Animated.View>
        )}
      </View>
    );
  };

  if (!visible) return null;

  const hasComposerText = inputText.length > 0;
  const canSendMessage = Boolean(inputText.trim() || attachedImageBase64);
  const imageAttachmentDisabled = pending || sessionInitializing || Boolean(attachedImageUri);
  const landingVisible =
    showLanding && !messages.some((message) => message.role === 'user');
  const headerTop = Math.max(insets.top, 56);
  const headerOverlayHeight = headerTop + 68;
  const composerHeight = attachedImageUri
    ? Math.min(244, Math.max(180, inputContentHeight + 148))
    : hasComposerText
    ? Math.min(196, Math.max(120, inputContentHeight + 72))
    : 56;
  const composerEdgeGap = keyboardVisible ? 12 : 28;
  const composerBottom = keyboardHeight + composerEdgeGap;
  const composerOverlayHeight = composerHeight + composerBottom + 96;
  const headerMaterialHeight = headerOverlayHeight - 32;
  const composerMaterialHeight = composerHeight + composerEdgeGap + 6;
  const bottomMaterialOffset =
    landingVisible && keyboardVisible ? 0 : keyboardHeight;
  headerOverlayHeightRef.current = headerOverlayHeight;
  composerOverlayHeightRef.current = composerOverlayHeight;

  const sendButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pending ? 'Stop generating' : editingMessageId ? 'Confirm edit' : 'Send message'}
      onPress={pending ? cancelStream : () => { void handleSend(inputText, editingMessageId ?? undefined); }}
      disabled={sessionInitializing || (!pending && !canSendMessage)}
      style={({ pressed }) => [
        styles.sendButton,
        pressed && (canSendMessage || pending) && styles.sendButtonPressed,
      ]}
    >
      <Animated.View key={pending ? 'stop' : 'send'} entering={FadeIn.duration(140)} exiting={FadeOut.duration(100)}>
        {pending ? (
          <View style={styles.stopIcon} />
        ) : editingMessageId ? (
          <ArrowUpIcon size={20} weight="bold" color="#FFFFFF" />
        ) : (
          <ArrowUpIcon size={20} weight="regular" color="#FFFFFF" />
        )}
      </Animated.View>
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
            onLayout={({ nativeEvent }) => {
              listHeightRef.current = nativeEvent.layout.height;
            }}
            onContentSizeChange={() => {
              if (streamingMessageIdRef.current) {
                scrollStreamingResponseIntoView(false);
              } else {
                scrollToLatest();
              }
            }}
            onScrollEndDrag={({ nativeEvent }) => {
              const distanceFromBottom = nativeEvent.contentSize.height
                - nativeEvent.layoutMeasurement.height
                - nativeEvent.contentOffset.y;
              autoFollowLatestRef.current = distanceFromBottom < 72;
            }}
            scrollEventThrottle={16}
            scrollIndicatorInsets={{
              top: headerOverlayHeight,
              bottom: composerHeight + composerBottom + 64,
            }}
            showsVerticalScrollIndicator={false}
          />
        ) : null}

        {chatSaveNotice ? <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(220)} pointerEvents="none" style={[styles.chatSaveNotice, { bottom: composerHeight + composerBottom + 20 }]}>
          <Text style={styles.chatSaveNoticeText}>{chatSaveNotice}</Text>
        </Animated.View> : null}

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
            <GlassIconButton icon={ClockIcon} label="Open chat history" onPress={onOpenHistory} />
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
                borderRadius: hasComposerText || attachedImageUri ? 24 : 32,
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

            {!voiceMode ? (
              <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={StyleSheet.absoluteFill}>
                <TextInput
                  ref={inputRef}
                  value={inputText}
                  onChangeText={setInputText}
                  onContentSizeChange={({ nativeEvent }) => {
                    const nextHeight = Math.max(21, Math.ceil(nativeEvent.contentSize.height));
                    setInputContentHeight((currentHeight) => (
                      currentHeight === nextHeight ? currentHeight : nextHeight
                    ));
                  }}
                  placeholder={editingMessageId ? 'Edit your message' : 'Ask AtlasAI'}
                  placeholderTextColor="#B0B0B0"
                  style={[
                    styles.composerInput,
                    (hasComposerText || attachedImageUri) ? styles.composerInputExpanded : styles.composerInputCompact,
                    attachedImageUri && styles.composerInputWithAttachment,
                  ]}
                  multiline
                  textAlignVertical="top"
                  scrollEnabled={composerHeight >= 196}
                  editable={!pending && !sessionInitializing}
                />
                {attachedImageUri ? (
                  <View style={styles.composerAttachment}>
                    <Image source={{ uri: attachedImageUri }} style={styles.composerAttachmentImage} />
                    <Pressable accessibilityRole="button" accessibilityLabel="Remove attached image" onPress={() => {
                      if (!inputText) setInputContentHeight(21);
                      setAttachedImageUri(null);
                      setAttachedImageBase64(null);
                    }} style={styles.composerAttachmentRemove}>
                      <XIcon size={12} weight="bold" color="#FFFFFF" />
                    </Pressable>
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add image"
                  disabled={imageAttachmentDisabled}
                  onPress={() => { void pickChatImage(); }}
                  style={({ pressed }) => [
                    styles.composerLeadingAction,
                    imageAttachmentDisabled && styles.composerLeadingActionDisabled,
                    pressed && !imageAttachmentDisabled && styles.utilityButtonPressed,
                  ]}
                >
                  <PlusIcon
                    size={22}
                    weight="regular"
                    color={imageAttachmentDisabled ? '#B4B4B4' : COLOR.primary}
                  />
                </Pressable>
              </Animated.View>
            ) : (
              <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.voiceModeWrap}>
                <Pressable accessibilityRole="button" accessibilityLabel="Return to keyboard input" onPress={() => setVoiceMode(false)} style={styles.voiceModeKeyboard}>
                  <KeyboardIcon size={20} weight="regular" color="#202024" />
                </Pressable>
                <VoiceInputButton
                  label="Hold to speak"
                  disabled={pending || sessionInitializing}
                  onRecordingChange={setVoiceRecording}
                  onError={(message) => showDialog({ title: 'Voice input unavailable', message, tone: 'warning' })}
                  onTranscript={(text) => {
                    setVoiceMode(false);
                    void handleSend(text);
                  }}
                  style={styles.voiceModeButton}
                />
              </Animated.View>
            )}

            <View style={styles.composerTrailingActions}>
              {!voiceMode ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Start voice input"
                  disabled={pending || sessionInitializing}
                  onPress={() => setVoiceMode(true)}
                  style={({ pressed }) => [styles.utilityButton, pressed && styles.utilityButtonPressed]}
                >
                  <WaveformIcon size={21} weight="bold" color={COLOR.foreground} />
                </Pressable>
              ) : null}
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
  userBubblePressed: {
    opacity: 0.72,
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
  streamingThoughtWrap: {
    opacity: 0.76,
  },
  streamingThoughtText: {
    color: '#8E8E93',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: 0,
  },
  thoughtToggle: {
    paddingVertical: 2,
  },
  thoughtTogglePressed: {
    opacity: 0.48,
  },
  expandedThoughtWrap: {
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: '#E4E4E7',
  },
  expandedThoughtText: {
    color: '#71717A',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    letterSpacing: 0,
  },
  streamingToken: {
    color: '#000000',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    letterSpacing: -0.16,
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
  messageAttachmentImage: {
    width: 220,
    height: 160,
    maxWidth: '100%',
    marginTop: 8,
    borderRadius: 8,
  },
  composerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 3,
  },
  chatSaveNotice: { position: 'absolute', left: 24, right: 24, zIndex: 5, alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, backgroundColor: 'rgba(39,39,42,0.94)', shadowColor: '#18181B', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 6 },
  chatSaveNoticeText: { color: '#FFFFFF', fontSize: 13, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
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
  composerInputWithAttachment: {
    // The preview occupies its own row, leaving the input full-width so its
    // placeholder never competes with the thumbnail.
    top: 96,
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
  composerLeadingActionDisabled: {
    opacity: 0.72,
    backgroundColor: 'rgba(180,180,180,0.22)',
  },
  utilityButtonPressed: {
    opacity: 0.5,
    transform: [{ scale: 0.94 }],
  },
  voiceModeWrap: {
    position: 'absolute',
    top: 0,
    bottom: 6,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  voiceModeButton: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#E9FBF1',
    borderWidth: 1,
    borderColor: '#C5EDD8',
  },
  voiceModeKeyboard: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E4E4E7',
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
  stopIcon: {
    width: 12,
    height: 12,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  composerAttachment: {
    position: 'absolute',
    top: 12,
    left: 16,
    width: 68,
    height: 68,
    borderRadius: 8,
    overflow: 'visible',
  },
  composerAttachmentImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  composerAttachmentRemove: {
    position: 'absolute',
    top: -7,
    right: -7,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#343434',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
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
