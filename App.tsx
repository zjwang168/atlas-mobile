import { PortalHost } from '@rn-primitives/portal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, LogBox, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import './global.css';

import { isSamePlace, savePlaces } from '@/services/place/placeService';
import { HomeProvider, useHome } from './src/features/home/HomeContext';
import type { ChatHistoryItem } from './src/features/home/HomeContext';
import { AppDialogProvider, useAppDialog } from './src/components/feedback/AppDialog';
import { signInAnonymously, supabase } from './src/services/supabase/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import HomeScreen from './src/features/home/HomeScreen';
import AtlasAIHome from './src/features/atlas-ai/chat-history/AtlasAIHome';
import AnalyzingScreen from './src/features/import-places/analyzing-screen/AnalyzingScreen';
import ImportScreen from './src/features/import-places/import-screen/ImportScreen';
import SaveScreen from './src/features/import-places/save-screen/SaveScreen';
import { cancelParseRequest, createChatSession, createImportChatWelcome, type ParseProgressEvent } from './src/services/api/apiService';
import {
  discoverFromAtlasQuery,
  formatParsedPlaceSubtitle,
  findImagePlace,
  parseInput,
  parseText,
  parseTikTokLink,
  parseInstagramReelLink,
  parseFacebookReelLink,
  parseYoutubeLink,
  scanImagesForTextPlaces,
  scanAnyLink,
  type ParseProgressHandler,
  type ParseRequestHandler,
  type ParseResult,
} from './src/services/import/importService';

LogBox.ignoreLogs([
  'RCTScrollViewComponentView implements focusItemsInRect',
  '[CoreHaptics] CHHapticPattern',
]);

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

type Overlay = 'none' | 'import' | 'analyzing' | 'save';
type ImportMeta = {
  mode?: 'parse' | 'smart_text' | 'atlas_discover' | 'image_scan' | 'web_scrape' | 'youtube_links' | 'tiktok_links' | 'instagram_reels' | 'facebook_reels' | 'find_image_places';
  rawInput: string;
  title?: string;
  sourceUrl?: string;
  webSearch?: boolean;
  imageDataList?: string[];
  imageUris?: string[];
};

type CompletedImport = {
  result: ParseResult;
  importMeta: ImportMeta | null;
  importText: string;
};

type BackgroundImport = {
  title: string;
};

const COMPLETED_IMPORT_STORAGE_KEY = 'atlas.completed-import';
const ANALYSIS_HERO_HOLD_MS = 1000;
const ANALYSIS_HERO_FALLBACK_MS = 4500;

function chatSourceTypeForImport(meta: ImportMeta | null, input: string): string {
  if (meta?.mode === 'smart_text' || meta?.mode === 'atlas_discover') return 'smart_text';
  if (meta?.mode === 'youtube_links') return 'youtube_links';
  if (meta?.mode === 'tiktok_links') return 'tiktok_links';
  if (meta?.mode === 'instagram_reels') return 'instagram_reels';
  if (meta?.mode === 'facebook_reels') return 'facebook_reels';
  if (meta?.mode === 'web_scrape') return 'any_links';
  if (meta?.mode === 'image_scan' || meta?.mode === 'find_image_places') return meta.mode;
  if (/^(https?:\/\/|www\.)\S+$/i.test(input.trim())) {
    return input.includes('reddit.com') ? 'reddit_links' : 'link';
  }
  return 'text';
}

function importTheme(
  meta: ImportMeta | null,
  input: string,
  events: ParseProgressEvent[] = [],
  resultRegion?: string,
): string {
  let region = resultRegion?.split(',')[0].trim() || null;
  if (!region) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const value = events[index].data?.region ?? events[index].data?.inferred_region;
      if (typeof value === 'string' && value.trim()) {
        region = value.split(',')[0].trim();
        break;
      }
    }
  }
  const source = /(?:reddit\.com|redd\.it)/i.test(input)
    ? 'Reddit'
    : meta?.mode === 'youtube_links'
      ? 'YouTube'
      : meta?.mode === 'tiktok_links'
        ? 'TikTok'
      : meta?.mode === 'instagram_reels'
        ? 'Instagram'
      : meta?.mode === 'facebook_reels'
        ? 'Facebook'
      : meta?.mode === 'image_scan'
        ? 'image text'
        : meta?.mode === 'find_image_places'
          ? 'a photo'
          : meta?.mode === 'smart_text'
            ? 'your notes'
            : meta?.mode === 'web_scrape'
              ? 'a webpage'
              : 'this link';
  return region
    ? `Extracting places from ${source} in ${region}`
    : `Extracting places from ${source}`;
}

function importSuccessTitle(meta: ImportMeta | null, input: string, events: ParseProgressEvent[] = []): string {
  const theme = importTheme(meta, input, events);
  return theme.replace(/^Extracting /, '').replace(/^places/, 'Places');
}

async function requestImportNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('imports-ready', {
      name: 'Imports ready',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

async function notifyImportReady(title: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Your places are ready',
      body: title,
      data: { type: 'import-ready' },
      ...(Platform.OS === 'android' ? { channelId: 'imports-ready' } : {}),
    },
    trigger: null,
  });
}

function ImportActivityIsland({ title, onOpen }: { title: string; onOpen: () => void }) {
  const insets = useSafeAreaInsets();
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 850, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.35, duration: 850, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <TouchableOpacity
      accessibilityLabel="Open import progress"
      style={[importIslandStyles.activity, { top: insets.top + 7 }]}
      onPress={onOpen}
      activeOpacity={0.88}
    >
      <Animated.View style={[importIslandStyles.pulse, { opacity: pulse }]} />
      <View style={importIslandStyles.activityCopy}>
        <Text style={importIslandStyles.activityLabel}>ATLAS IS WORKING</Text>
        <Text style={importIslandStyles.activityTitle} numberOfLines={1}>{title}</Text>
      </View>
    </TouchableOpacity>
  );
}

function ImportSuccessIsland({ title }: { title: string }) {
  const insets = useSafeAreaInsets();
  const reveal = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(reveal, { toValue: 1, friction: 8, tension: 95, useNativeDriver: true }).start();
  }, [reveal]);

  return (
    <Animated.View style={[importIslandStyles.success, { top: insets.top + 7, opacity: reveal, transform: [{ scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}>
      <View style={importIslandStyles.successIcon}><Text style={importIslandStyles.successCheck}>✓</Text></View>
      <View style={importIslandStyles.activityCopy}>
        <Text style={importIslandStyles.activityLabel}>IMPORT COMPLETE</Text>
        <Text style={importIslandStyles.activityTitle} numberOfLines={1}>{title}</Text>
      </View>
    </Animated.View>
  );
}

const importIslandStyles = StyleSheet.create({
  activity: { position: 'absolute', zIndex: 220, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', width: 294, maxWidth: '76%', minHeight: 54, paddingHorizontal: 14, borderRadius: 27, backgroundColor: '#171A18', shadowColor: '#000', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 8 },
  pulse: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#2CD889', marginRight: 10 },
  activityCopy: { flex: 1, minWidth: 0 },
  activityLabel: { color: 'rgba(255,255,255,0.62)', fontSize: 9, lineHeight: 12, fontWeight: '700', letterSpacing: 0 },
  activityTitle: { marginTop: 1, color: '#FFFFFF', fontSize: 12, lineHeight: 17, fontWeight: '600' },
  success: { position: 'absolute', zIndex: 220, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', width: 254, maxWidth: '72%', minHeight: 54, paddingHorizontal: 14, borderRadius: 27, backgroundColor: '#173D2A', shadowColor: '#000', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 8 },
  successIcon: { width: 24, height: 24, marginRight: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2CD889' },
  successCheck: { color: '#10301F', fontSize: 15, lineHeight: 18, fontWeight: '800' },
});

type BackendLocation = {
  name: string;
  latitude: number;
  longitude: number;
  full_address?: string;
  description?: string | null;
  category?: string | null;
  sentiment?: 'positive' | 'neutral' | 'negative' | null;
  confidence?: number | null;
};

function createParsedPlaceId(prefix: string, index: number): string {
  return `${prefix}_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`;
}

function mapBackendLocationsToParsedPlaces(
  locations: BackendLocation[],
  prefix: string,
): ParseResult['places'] {
  return (locations || []).map((loc, index) => ({
    id: createParsedPlaceId(prefix, index),
    name: loc.name,
    subtitle: formatParsedPlaceSubtitle(loc),
    latitude: loc.latitude,
    longitude: loc.longitude,
    sentiment: loc.sentiment || null,
    confidence: loc.confidence ?? null,
    type: loc.category || 'Place',
  }));
}

function buildParseResult(
  result: { title?: string; locations?: BackendLocation[]; inferred_region?: string | null },
  prefix: string,
  fallbackTitle: string,
): ParseResult {
  const places = mapBackendLocationsToParsedPlaces(result.locations || [], prefix);
  const centerCoordinate: [number, number] =
    places.length > 0
      ? [
          places.reduce((sum, p) => sum + p.longitude, 0) / places.length,
          places.reduce((sum, p) => sum + p.latitude, 0) / places.length,
        ]
      : [0, 0];

  return {
    sourceTitle: result.title || fallbackTitle,
    centerCoordinate,
    region: result.inferred_region || undefined,
    places,
  };
}

/**
 * Error boundary to prevent rendering crashes from Mapbox or other native modules.
 */
class MapErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state: { hasError: boolean; error: Error | null } = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={errorBoundaryStyles.container}>
          <Text style={errorBoundaryStyles.title}>Something went wrong</Text>
          <Text style={errorBoundaryStyles.message}>
            We hit an unexpected snag while opening this view. Please return to My Places and try again.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const errorBoundaryStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginHorizontal: 40,
  },
});

// ---- Inner component that consumes HomeContext ----

function AppContent() {
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [importText, setImportText] = useState('');
  const [importMeta, setImportMeta] = useState<ImportMeta | null>(null);
  const [parseProgressEvents, setParseProgressEvents] = useState<ParseProgressEvent[]>([]);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [chatHistoryReturnItem, setChatHistoryReturnItem] = useState<ChatHistoryItem | null>(null);
  const [chatHistoryExitRequest, setChatHistoryExitRequest] = useState(0);
  const [completedImport, setCompletedImport] = useState<CompletedImport | null>(null);
  const [backgroundImport, setBackgroundImport] = useState<BackgroundImport | null>(null);
  const [completionCelebration, setCompletionCelebration] = useState<string | null>(null);
  const parseResultRef = useRef<ParseResult | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const completedImportRef = useRef<CompletedImport | null>(null);
  const dismissActiveImportRef = useRef<(() => void) | null>(null);
  const cancelActiveImportRef = useRef<(() => void) | null>(null);
  const resumeActiveImportRef = useRef<(() => void) | null>(null);
  const openCompletedImportRef = useRef<(() => void) | null>(null);
  const openWhenImportReadyRef = useRef(false);
  const resumingBackgroundImportRef = useRef(false);
  const analysisHeroReadyRef = useRef(false);
  const advanceAfterHeroRef = useRef<(() => void) | null>(null);
  const { show: showDialog } = useAppDialog();
  const {
    setParsedPlaces,
    setOverlay: setHomeOverlay,
    addChatHistoryItem,
    replaceChatHistoryItem,
    setActiveHistoryItem,
    activeHistoryItem,
    setSelectedPlaceCoordinate,
    setSelectedPlaceId,
    setActiveSidekick,
    savedPlaces,
  } = useHome();

  const openCompletedImport = () => {
    const completed = completedImportRef.current;
    if (!completed) return;
    parseResultRef.current = completed.result;
    setParsedPlaces(completed.result.places);
    setImportMeta(completed.importMeta);
    setImportText(completed.importText);
    completedImportRef.current = null;
    setCompletedImport(null);
    void AsyncStorage.removeItem(COMPLETED_IMPORT_STORAGE_KEY);
    setOverlay('save');
  };
  openCompletedImportRef.current = openCompletedImport;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!completionCelebration) return;
    const timeoutId = setTimeout(() => {
      setCompletionCelebration(null);
      showDialog({
        title: 'Ready in Chat History',
        message: `${completionCelebration} is ready whenever you want to revisit it.`,
        actions: [
          { label: 'Later' },
          { label: 'Open Chat History', variant: 'primary', onPress: () => setShowChatHistory(true) },
        ],
      });
    }, 10_000);
    return () => clearTimeout(timeoutId);
  }, [completionCelebration]);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(COMPLETED_IMPORT_STORAGE_KEY)
      .then((value) => {
        if (!mounted || !value) return;
        const parsed = JSON.parse(value) as CompletedImport;
        completedImportRef.current = parsed;
        setCompletedImport(parsed);
        if (openWhenImportReadyRef.current) {
          openWhenImportReadyRef.current = false;
          openCompletedImportRef.current?.();
        }
      })
      .catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const openFromNotification = () => {
      if (completedImportRef.current) {
        openCompletedImportRef.current?.();
      } else {
        openWhenImportReadyRef.current = true;
      }
    };
    if (Notifications.getLastNotificationResponse()?.notification.request.content.data?.type === 'import-ready') {
      openFromNotification();
    }
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (response.notification.request.content.data?.type === 'import-ready') {
        openFromNotification();
      }
    });
    return () => subscription.remove();
  }, []);

  // Run the parse while the Analyzing screen is showing; advance to the Save
  // screen when it resolves (unless the user cancelled out of analyzing).
  useEffect(() => {
    if (overlay !== 'analyzing') return;
    if (resumingBackgroundImportRef.current) {
      resumingBackgroundImportRef.current = false;
      return;
    }
    let cancelled = false;
    let dismissed = false;
    let requestId: string | null = null;
    analysisHeroReadyRef.current = false;
    advanceAfterHeroRef.current = null;
    setParseProgressEvents([]);
    const handleProgress: ParseProgressHandler = (progress) => {
      if (cancelled) return;
      setParseProgressEvents(progress.events);
      if (dismissed) {
        setBackgroundImport({ title: importTheme(importMeta, importText, progress.events) });
      }
    };
    const handleRequestId: ParseRequestHandler = (id) => {
      requestId = id;
      if (cancelled) void cancelParseRequest(id);
    };
    const completeImport = (result: ParseResult | null | undefined) => {
      if (cancelled) return;
      if (!result || result.places.length === 0) {
        showDialog({
          title: 'We couldn\'t find any places',
          message: importMeta?.mode === 'web_scrape'
            ? 'This page did not share enough public information to identify places. Try another public link or paste the relevant text instead.'
            : 'Try adding a little more context, choosing a public link, or using a different source.',
          tone: 'warning',
        });
        setOverlay('import');
        return;
      }
      if (dismissed || appStateRef.current !== 'active') {
        const completed: CompletedImport = { result, importMeta, importText };
        setBackgroundImport(null);
        if (dismissed && appStateRef.current === 'active') {
          setCompletionCelebration(importSuccessTitle(importMeta, importText, parseProgressEvents));
          return;
        }
        completedImportRef.current = completed;
        setCompletedImport(completed);
        void AsyncStorage.setItem(COMPLETED_IMPORT_STORAGE_KEY, JSON.stringify(completed));
        if (appStateRef.current !== 'active') {
          void notifyImportReady(result.sourceTitle);
        }
        return;
      }
      parseResultRef.current = result;
      setParsedPlaces(result.places);
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let advanced = false;
      const advanceToSave = () => {
        if (advanced) return;
        advanced = true;
        if (timeoutId) clearTimeout(timeoutId);
        advanceAfterHeroRef.current = null;
        if (!cancelled && !dismissed) setOverlay('save');
      };
      const advanceAfterHeroHold = () => {
        if (advanced) return;
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(advanceToSave, ANALYSIS_HERO_HOLD_MS);
      };
      advanceAfterHeroRef.current = advanceAfterHeroHold;
      timeoutId = setTimeout(advanceToSave, ANALYSIS_HERO_FALLBACK_MS);
      if (analysisHeroReadyRef.current) {
        advanceAfterHeroHold();
      }
    };
    const dismiss = () => {
      dismissed = true;
      advanceAfterHeroRef.current = null;
      void requestImportNotificationPermission();
      setBackgroundImport({ title: importTheme(importMeta, importText, parseProgressEvents) });
      if (parseResultRef.current) {
        setBackgroundImport(null);
        setCompletionCelebration(importSuccessTitle(importMeta, importText, parseProgressEvents));
      }
      setOverlay('none');
    };
    const cancel = () => {
      cancelled = true;
      advanceAfterHeroRef.current = null;
      parseResultRef.current = null;
      setBackgroundImport(null);
      if (requestId) void cancelParseRequest(requestId);
      setOverlay('none');
    };
    const resume = () => {
      dismissed = false;
      setBackgroundImport(null);
    };
    dismissActiveImportRef.current = dismiss;
    cancelActiveImportRef.current = cancel;
    resumeActiveImportRef.current = resume;

    // Any Links mode: Universal Web Agent reads HTTP content, then renders
    // JavaScript pages with Playwright when the server response is an app shell.
    if (importMeta?.mode === 'web_scrape') {
      const sourceUrl = importMeta?.rawInput || importText;
      scanAnyLink(sourceUrl, handleProgress, handleRequestId)
        .then((result) => {
          if (cancelled) return;
          if (!result) {
            completeImport(result);
            return;
          }
          const effectiveTitle = importMeta?.title || result.sourceTitle || sourceUrl;
          const adaptedResult: ParseResult = {
            ...result,
            sourceTitle: effectiveTitle,
          };
          completeImport(adaptedResult);
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('Any Links scan failed:', err);
            showDialog({
              title: 'We couldn\'t open this page',
              message: 'It may require sign-in, be unavailable in your region, or block automated access. Try another public link or paste the relevant text instead.',
              tone: 'warning',
            });
            setOverlay('import');
          }
        });
      return;
      }

    if (importMeta?.mode === 'youtube_links') {
      const sourceUrl = importMeta?.rawInput || importText;
      parseYoutubeLink(sourceUrl, handleProgress, handleRequestId)
        .then((result) => {
          if (cancelled) return;
          if (!result) {
            completeImport(result);
            return;
          }
          const effectiveTitle = importMeta?.title || result.sourceTitle || sourceUrl;
          const adaptedResult: ParseResult = {
            ...result,
            sourceTitle: effectiveTitle,
          };
          completeImport(adaptedResult);
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('YouTube parse failed:', err);
            showDialog({
              title: 'We couldn\'t read this YouTube video',
              message: 'The video may be private, unavailable in your region, or missing a readable transcript. Please try a public video or another link.',
              tone: 'warning',
            });
            setOverlay('import');
          }
        });
      return;
    }

    if (importMeta?.mode === 'tiktok_links') {
      const sourceUrl = importMeta?.rawInput || importText;
      parseTikTokLink(sourceUrl, handleProgress, handleRequestId)
        .then((result) => {
          if (cancelled) return;
          if (!result) {
            completeImport(result);
            return;
          }
          const effectiveTitle = importMeta?.title || result.sourceTitle || sourceUrl;
          const adaptedResult: ParseResult = { ...result, sourceTitle: effectiveTitle };
          completeImport(adaptedResult);
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('TikTok parse failed:', err);
            showDialog({
              title: 'We couldn\'t read this TikTok video',
              message: 'The post may be private, unavailable in your region, or not offer enough public information to identify places. Try another public video.',
              tone: 'warning',
            });
            setOverlay('import');
          }
        });
      return;
    }

    if (importMeta?.mode === 'instagram_reels') {
      const sourceUrl = importMeta?.rawInput || importText;
      parseInstagramReelLink(sourceUrl, handleProgress, handleRequestId)
        .then((result) => {
          if (cancelled) return;
          if (!result) {
            completeImport(result);
            return;
          }
          const effectiveTitle = importMeta?.title || result.sourceTitle || sourceUrl;
          const adaptedResult: ParseResult = { ...result, sourceTitle: effectiveTitle };
          completeImport(adaptedResult);
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('Instagram Reel parse failed:', err);
            showDialog({
              title: 'We couldn\'t read this Instagram Reel',
              message: 'The Reel may be private, unavailable in your region, or restricted by Instagram. Please try another public Reel.',
              tone: 'warning',
            });
            setOverlay('import');
          }
        });
      return;
    }

    if (importMeta?.mode === 'facebook_reels') {
      const sourceUrl = importMeta?.rawInput || importText;
      parseFacebookReelLink(sourceUrl, handleProgress, handleRequestId)
        .then((result) => {
          if (cancelled) return;
          if (!result) {
            completeImport(result);
            return;
          }
          const effectiveTitle = result.sourceTitle || importMeta?.title || sourceUrl;
          const adaptedResult: ParseResult = { ...result, sourceTitle: effectiveTitle };
          completeImport(adaptedResult);
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('Facebook Reel parse failed:', err);
            showDialog({
              title: 'We couldn\'t read this Facebook Reel',
              message: 'The video may be private, unavailable in your region, or restricted by Facebook. Please try another public video.',
              tone: 'warning',
            });
            setOverlay('import');
          }
        });
      return;
    }

    // Image text recognition: OCR and downstream location analysis stream
    // through the same progress channel as link imports.
    if (importMeta?.mode === 'image_scan') {
      const imageDataList = importMeta?.imageDataList || JSON.parse(importText);
      scanImagesForTextPlaces(imageDataList, handleProgress, handleRequestId, importMeta?.imageUris)
        .then((result) => {
          if (cancelled) return;
          if (!result) {
            completeImport(result);
            return;
          }
          completeImport(result);
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('Image scan failed:', err);
            showDialog({
              title: 'We couldn\'t read those images',
              message: 'Try a clearer image with visible place names, signs, or addresses, then give it another go.',
              tone: 'warning',
            });
            setOverlay('import');
          }
        });
      return;
    }

    // Landmark recognition uses the shared parse client so its real vision
    // stages appear on the analyzing screen as they happen.
    if (importMeta?.mode === 'find_image_places') {
      const imageData = importMeta?.imageDataList?.[0];
      if (!imageData) {
        showDialog({
          title: 'That image is no longer available',
          message: 'Choose the image again and we\'ll take another look.',
          tone: 'warning',
        });
        setOverlay('import');
        return;
      }
      findImagePlace(imageData, handleProgress, handleRequestId)
        .then((result) => {
          if (cancelled) return;
          if (!result) {
            completeImport(result);
            return;
          }
          const firstPlace = result.places[0];
          const isUnknown = !firstPlace?.latitude && !firstPlace?.longitude;
          if (isUnknown) {
            showDialog({
              title: 'We couldn\'t identify that place',
              message: 'Try a different photo with a clearer landmark, sign, or storefront.',
              tone: 'warning',
            });
            setOverlay('import');
            return;
          }
          completeImport(result);
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('Find image place failed:', err);
            showDialog({
              title: 'We couldn\'t identify that place',
              message: 'Try a different photo with a clearer landmark, sign, or storefront.',
              tone: 'warning',
            });
            setOverlay('import');
          }
        });
      return;
    }

    const runner: (text: string, onProgress?: ParseProgressHandler, onRequestId?: ParseRequestHandler) => Promise<ParseResult> =
      importMeta?.mode === 'smart_text'
        ? (text, onProgress, onRequestId) =>
            parseText(text, { webSearch: importMeta?.webSearch }, onProgress, onRequestId)
        : importMeta?.mode === 'atlas_discover'
        ? discoverFromAtlasQuery
        : parseInput;
    runner(importText, handleProgress, handleRequestId)
      .then((result) => {
        if (!cancelled) {
          const effectiveTitle = importMeta?.title || result.sourceTitle || importText;
          const adaptedResult: ParseResult = {
            ...result,
            sourceTitle: effectiveTitle,
          };
          completeImport(adaptedResult);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('Parse failed:', err);
          showDialog({
            title: 'We couldn\'t find places in that',
            message: 'Try adding a little more context, choosing a public link, or using a different source.',
            tone: 'warning',
          });
          if (importMeta?.mode === 'atlas_discover') {
            setImportMeta(null);
            setOverlay('none');
            setActiveSidekick('aiChat');
          } else {
            setOverlay('import');
          }
        }
      });
    return () => {
      if (!cancelled) dismissed = true;
      if (!dismissed) {
        dismissActiveImportRef.current = null;
        cancelActiveImportRef.current = null;
        resumeActiveImportRef.current = null;
      }
    };
  }, [overlay, importText, importMeta, setParsedPlaces, setActiveSidekick]);

  const parseResult = parseResultRef.current;

  return (
    <>
      <MapErrorBoundary>
        <HomeScreen
          onOpenImport={() => setOverlay('import')}
          onOpenChatHistory={() => {
            setChatHistoryReturnItem(activeHistoryItem);
            setShowChatHistory(true);
          }}
          externalOverlayVisible={overlay !== 'none' || showChatHistory}
          chatHistoryExitRequest={chatHistoryExitRequest}
        />
      </MapErrorBoundary>

      {overlay === 'save' && parseResult ? (
        <SaveScreen
          result={parseResult}
          sessionTheme={importTheme(importMeta, importText, parseProgressEvents, parseResult.region)}
          onClose={() => {
            setActiveHistoryItem(null);
            setParsedPlaces([]);
            setSelectedPlaceCoordinate(null);
            setSelectedPlaceId(null);
            setImportMeta(null);
            setOverlay('none');
          }}

          onSave={async (ids) => {
            try {
              const selected = parseResult.places.filter((p) => ids.includes(p.id));
              const { inserted, duplicates } = await savePlaces(selected, {
                region: parseResult.region,
                url: importMeta?.sourceUrl || importText,
              });
              setParsedPlaces([]);
              if (__DEV__) {
                console.log(
                  `Saved ${inserted.length} places to Supabase (${duplicates.length} already existed)`,
                );
              }
            } catch (e) {
              console.error('Save failed:', e);
            }
            setActiveHistoryItem(null);
            setActiveSidekick('none');
            setSelectedPlaceCoordinate(null);
            setSelectedPlaceId(null);
            setImportMeta(null);
            parseResultRef.current = null;
            setOverlay('none');
          }}

          onSaveAndAskAI={async (ids) => {
            const selected = parseResult.places.filter((p) => ids.includes(p.id));
            const deselected = parseResult.places.filter((p) => !ids.includes(p.id));
            const sourceUrl = importMeta?.sourceUrl || importText;
            const effectiveTitle = parseResult.sourceTitle || importMeta?.title || sourceUrl;
            const sourceType = chatSourceTypeForImport(importMeta, importText);
            const previouslySaved = selected.filter((place) => savedPlaces.some((saved) => isSamePlace(place, saved)));
            const newlyAdded = selected.filter((place) => !savedPlaces.some((saved) => isSamePlace(place, saved)));
            const formatNames = (items: typeof selected) => items.map((place) => place.name).join(' and ');
            const welcomeText = importMeta?.mode === 'find_image_places'
              ? `Hey there! I spotted ${selected[0]?.name || 'a place'} in your image.\n\nThat’s ${selected.length} saved ${selected.length === 1 ? 'place' : 'places'} ready to go. Here’s what I can do with it:`
              : `Done! I found ${parseResult.places.length} potential ${parseResult.places.length === 1 ? 'place' : 'places'} in what you shared and checked them against the map.\n\n${newlyAdded.length ? `You chose to save ${formatNames(newlyAdded)}${previouslySaved.length ? ' as new additions' : ''}.` : ''}${previouslySaved.length ? ` ${formatNames(previouslySaved)} ${previouslySaved.length === 1 ? 'was' : 'were'} already saved, so I folded ${previouslySaved.length === 1 ? 'it' : 'them'} in without duplicates.` : ''}${deselected.length ? ` ${formatNames(deselected)} ${deselected.length === 1 ? 'was' : 'were'} left out as you requested.` : ''}\n\nYou now have ${selected.length} ${selected.length === 1 ? 'place' : 'places'} ready. Here’s what I can do with them:`;

            // The cache is updated optimistically by savePlaces. Let its remote
            // write continue while the chat session is created so this action
            // does not hold the results screen open on a slow connection.
            const savePromise = savePlaces(selected, {
              region: parseResult.region,
              url: sourceUrl,
            });
            void savePromise.catch((error) => {
              console.error('Background place save failed:', error);
              showDialog({
                title: 'Chat started, but places were not saved',
                message: 'Please retry saving these places from the chat map or My Places.',
                tone: 'warning',
              });
            });
            const createdAt = new Date().toISOString();
            const initialImportWelcome = {
              kind: 'places_map' as const,
              title: `${selected.length} saved place${selected.length === 1 ? '' : 's'}`,
              places: selected.map((place) => ({
                name: place.name,
                latitude: place.latitude,
                longitude: place.longitude,
                full_address: place.subtitle,
                description: place.subtitle,
                category: place.type || 'Place',
              })),
              route: null,
            };
            const temporaryId = addChatHistoryItem({
              title: effectiveTitle,
              sourceUrl,
              sourceType,
              locationCount: selected.length,
              messageCount: 0,
              places: selected,
              updatedAt: createdAt,
            });
            setParsedPlaces(selected);
            setActiveHistoryItem({
              id: temporaryId,
              title: effectiveTitle,
              sourceUrl,
              sourceType,
              locationCount: selected.length,
              messageCount: 0,
              places: selected,
              createdAt,
              updatedAt: createdAt,
              initialImportWelcome,
              initialWelcomeText: welcomeText,
              sessionInitializing: true,
            });
            setSelectedPlaceId(null);
            setSelectedPlaceCoordinate(null);
            setImportMeta(null);
            parseResultRef.current = null;
            setOverlay('none');
            setActiveSidekick('aiChat');

            void (async () => {
              try {
                const created = await createChatSession({
                title: effectiveTitle,
                source_url: sourceUrl,
                source_type: sourceType,
                locations: selected.map((place) => ({
                  name: place.name,
                  latitude: place.latitude,
                  longitude: place.longitude,
                  full_address: place.subtitle,
                  sentiment: place.sentiment ?? null,
                  description: place.subtitle,
                  category: place.type || 'Place',
                })),
              });
              const conversationId = created.conversation_id || created.session_id;
              replaceChatHistoryItem(temporaryId, {
                id: conversationId,
                title: effectiveTitle,
                sourceUrl,
                sourceType,
                locationCount: selected.length,
                messageCount: 0,
                places: selected,
                createdAt,
                updatedAt: createdAt,
                importWelcome: { deselectedPlaces: deselected },
                initialImportWelcome,
                initialWelcomeText: welcomeText,
                initialSessionId: created.session_id,
                sessionInitializing: false,
              });
              setParsedPlaces(selected);
              setActiveHistoryItem({
                id: conversationId,
                title: effectiveTitle,
                sourceUrl,
                sourceType,
                locationCount: selected.length,
                messageCount: 0,
                places: selected,
                createdAt,
                updatedAt: createdAt,
                importWelcome: { deselectedPlaces: deselected },
                initialImportWelcome,
                initialWelcomeText: welcomeText,
                initialSessionId: created.session_id,
                sessionInitializing: false,
              });
              // The visible chat already has deterministic welcome copy. Keep
              // its equivalent backend message for history without delaying
              // the transition out of the save screen.
              void createImportChatWelcome(
                created.session_id,
                deselected.map((place) => ({
                  name: place.name,
                  latitude: place.latitude,
                  longitude: place.longitude,
                  full_address: place.subtitle,
                  category: place.type || 'Place',
                })),
                welcomeText,
              ).catch((error) => console.warn('Background import welcome save failed:', error));
              } catch (e) {
                console.error('Save before AI chat failed:', e);
              showDialog({
                title: 'We couldn\'t start this chat',
                message: 'Your places were not changed. Please try Save and Ask AI again.',
                tone: 'warning',
              });
              }
            })();
          }}
        />
      ) : null}

          {/* "Add places" sheet — pulls up over the home. */}
          {overlay === 'import' && (
            <ImportScreen
              onClose={() => setOverlay('none')}
              onSearchLocationManually={() => {
                setOverlay('none');
                setHomeOverlay({ kind: 'search' });
              }}
              onOpenChatHistory={() => setShowChatHistory(true)}
              onSubmit={(text, mode, webSearch) => {
                parseResultRef.current = null;
                setActiveHistoryItem(null);
                const pipelineMode: 'parse' | 'smart_text' | 'atlas_discover' | 'image_scan' | 'web_scrape' | 'youtube_links' | 'tiktok_links' | 'instagram_reels' | 'facebook_reels' | 'find_image_places' =
                  mode === 'smartText' ? 'smart_text' :
                  mode === 'findTextPlaces' ? 'image_scan' :
                  mode === 'findImagePlaces' ? 'find_image_places' :
                  mode === 'youtubeLinks' ? 'youtube_links' :
                  mode === 'tiktokLinks' ? 'tiktok_links' :
                  mode === 'instagramReels' ? 'instagram_reels' :
                  mode === 'facebookReels' ? 'facebook_reels' :
                  mode === 'anyLinks' ? 'web_scrape' :
                  'parse';
                setImportMeta({ mode: pipelineMode, rawInput: text, title: text, webSearch });
                setImportText(text);
                setOverlay('analyzing');
              }}
              onSubmitImageScan={(imagesBase64, submitMode, imageUris) => {
                parseResultRef.current = null;
                setActiveHistoryItem(null);
                const isFindImagePlaces = submitMode === 'findImagePlaces';
                setImportMeta({
                  mode: isFindImagePlaces ? 'find_image_places' : 'image_scan',
                  rawInput: isFindImagePlaces ? 'find_image_places' : 'image_scan',
                  title: isFindImagePlaces ? 'Find Image Place' : 'Scanned places from image',
                  imageDataList: imagesBase64,
                  imageUris,
                });
                setImportText(isFindImagePlaces ? 'find_image_places' : 'image_scan');
                setOverlay('analyzing');
              }}
              onScanResult={(result) => {
                // Legacy hook: keep image scan on the same analyze -> save flow.
                parseResultRef.current = null;
                setActiveHistoryItem(null);
                setImportMeta({
                  mode: 'image_scan',
                  rawInput: JSON.stringify(result),
                  title: 'Scanned places from image',
                });
                setOverlay('analyzing');
              }}
            />
          )}

          {/* Processing state while the link is parsed. */}
          {overlay === 'analyzing' && (
            <AnalyzingScreen
              url={importText}
              mode={importMeta?.mode}
              sourceImageUri={importMeta?.imageUris?.[0]}
              progressEvents={parseProgressEvents}
              onDismiss={() => dismissActiveImportRef.current?.()}
              onCancel={() => cancelActiveImportRef.current?.()}
              onHeroReady={() => {
                analysisHeroReadyRef.current = true;
                advanceAfterHeroRef.current?.();
              }}
            />
          )}

          {backgroundImport && overlay !== 'analyzing' && (
            <ImportActivityIsland
              title={backgroundImport.title}
              onOpen={() => {
                resumingBackgroundImportRef.current = true;
                resumeActiveImportRef.current?.();
                setOverlay('analyzing');
              }}
            />
          )}

          {completionCelebration && (
            <ImportSuccessIsland title={completionCelebration} />
          )}

          {/* Chat history list — opened from ImportScreen's header button, rendered
              above it (mounted after in the tree). */}
          {showChatHistory && (
            <AtlasAIHome
              visible={showChatHistory}
              onBackToChat={() => {
                setActiveHistoryItem(chatHistoryReturnItem);
                setActiveSidekick('aiChat');
                setShowChatHistory(false);
              }}
              onClose={() => {
                setActiveHistoryItem(null);
                setActiveSidekick('none');
                setShowChatHistory(false);
                setChatHistoryExitRequest((request) => request + 1);
              }}
              onLongPressDebug={() => setHomeOverlay({ kind: 'debug' })}
              onOpenChat={(item) => {
                setActiveHistoryItem(item);
                setActiveSidekick('aiChat');
                setShowChatHistory(false);
                setOverlay('none');
              }}
              onOpenPlaces={(item) => {
                setActiveHistoryItem(item);
                setParsedPlaces(item.places);
                setActiveSidekick('none');
                setShowChatHistory(false);
                setOverlay('none');
              }}
            />
          )}
    </>
  );
}

// ---- Root — wraps everything with HomeProvider so context is available
//      even while SaveScreen (which replaces HomeScreen) is shown. ----

function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }: { data: { session: Session | null } }) => {
      if (data.session) {
        setSession(data.session);
      } else {
        // No stored session: silently create an anonymous identity so the
        // app is usable without a login wall and every row gets a user_id.
        try {
          const anon = await signInAnonymously();
          setSession(anon.session ?? null);
        } catch (e) {
          console.warn('[AuthGate] anonymous sign-in failed:', e);
        }
      }
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event: string, newSession: Session | null) => {
      setSession(newSession);
      // Signed out (or session lost): immediately re-establish an anonymous
      // identity so the app never runs without auth.uid() under RLS —
      // otherwise upgrades ("Auth session missing") and all RLS-protected
      // reads/writes fail until the next app restart.
      if (!newSession) {
        signInAnonymously()
          .then((anon) => setSession(anon.session ?? null))
          .catch((e) => console.warn('[AuthGate] re-anonymize failed:', e));
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return null; // splash moment while restoring/creating session
  // Anonymous flow: never block the app. AuthScreen is opened on demand
  // (avatar tap) for upgrading to a permanent account.
  return <>{children}</>;
}

export default function App() {
  return (
    <SafeAreaProvider>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthGate>
        <AppDialogProvider>
          <HomeProvider>
            <StatusBar style="dark" />
            <AppContent />
            <PortalHost />
          </HomeProvider>
        </AppDialogProvider>
      </AuthGate>
    </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
