import { PortalHost } from '@rn-primitives/portal';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, LogBox, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './global.css';

import { savePlaces } from '@/services/place/placeService';
import { HomeProvider, useHome } from './src/features/home/HomeContext';
import { signInAnonymously, supabase } from './src/services/supabase/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import HomeScreen from './src/features/home/HomeScreen';
import AtlasAIHome from './src/features/atlas-ai/chat-history/AtlasAIHome';
import AnalyzingScreen from './src/features/import-places/analyzing-screen/AnalyzingScreen';
import ImportScreen from './src/features/import-places/import-screen/ImportScreen';
import SaveScreen from './src/features/import-places/save-screen/SaveScreen';
import type { ParseProgressEvent } from './src/services/api/apiService';
import {
  discoverFromAtlasQuery,
  formatParsedPlaceSubtitle,
  parseInput,
  parseText,
  parseYoutubeLink,
  scanAnyLink,
  type ParseProgressHandler,
  type ParseResult,
} from './src/services/import/importService';
import { saveChatHistory } from './src/services/supabase/supabaseClient';

LogBox.ignoreLogs([
  'RCTScrollViewComponentView implements focusItemsInRect',
  '[CoreHaptics] CHHapticPattern',
]);

type Overlay = 'none' | 'import' | 'analyzing' | 'save';
type ImportMeta = {
  mode?: 'parse' | 'smart_text' | 'atlas_discover' | 'image_scan' | 'web_scrape' | 'youtube_links' | 'find_image_places';
  rawInput: string;
  title?: string;
  sourceUrl?: string;
  webSearch?: boolean;
  imageDataList?: string[];
};

type BackendLocation = {
  name: string;
  latitude: number;
  longitude: number;
  full_address?: string;
  description?: string | null;
  category?: string | null;
  sentiment?: 'positive' | 'neutral' | 'negative' | null;
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
            {this.state.error?.message || 'An unexpected error occurred.'}
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
  const parseResultRef = useRef<ParseResult | null>(null);
  const { chatHistory, setParsedPlaces, refreshSavedPlaces, setOverlay: setHomeOverlay, addChatHistoryItem, replaceChatHistoryItem, setActiveHistoryItem, setSelectedPlaceCoordinate, setSelectedPlaceId, setActiveSidekick } = useHome();

  // Run the parse while the Analyzing screen is showing; advance to the Save
  // screen when it resolves (unless the user cancelled out of analyzing).
  useEffect(() => {
    if (overlay !== 'analyzing') return;
    let cancelled = false;
    setParseProgressEvents([]);
    const handleProgress: ParseProgressHandler = (progress) => {
      if (!cancelled) setParseProgressEvents(progress.events);
    };

    // Any Links mode: use Gemini computer use screenshots, then GLM-OCR.
    if (importMeta?.mode === 'web_scrape') {
      const sourceUrl = importMeta?.rawInput || importText;
      scanAnyLink(sourceUrl, handleProgress)
        .then((result) => {
          if (cancelled || !result) return;
          const effectiveTitle = importMeta?.title || result.sourceTitle || sourceUrl;
          const adaptedResult: ParseResult = {
            ...result,
            sourceTitle: effectiveTitle,
          };
          parseResultRef.current = adaptedResult;
          setParsedPlaces(adaptedResult.places);
          const tempHistoryId = addChatHistoryItem({
            title: effectiveTitle,
            sourceUrl,
            locationCount: adaptedResult.places.length,
            places: adaptedResult.places,
            sourceType: 'any_links',
          });
          setTimeout(() => {
            if (!cancelled) setOverlay('save');
          }, 2000);
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('Any Links scan failed:', err);
            Alert.alert('Scan Failed', err.message || 'Failed to scan URL.');
            setOverlay('import');
          }
        });
      return;
      }

    if (importMeta?.mode === 'youtube_links') {
      const sourceUrl = importMeta?.rawInput || importText;
      parseYoutubeLink(sourceUrl, handleProgress)
        .then((result) => {
          if (cancelled || !result) return;
          const effectiveTitle = importMeta?.title || result.sourceTitle || sourceUrl;
          const adaptedResult: ParseResult = {
            ...result,
            sourceTitle: effectiveTitle,
          };
          parseResultRef.current = adaptedResult;
          setParsedPlaces(adaptedResult.places);
          const tempHistoryId = addChatHistoryItem({
            title: effectiveTitle,
            sourceUrl,
            locationCount: adaptedResult.places.length,
            places: adaptedResult.places,
            sourceType: 'youtube_links',
          });

            saveChatHistory({
            title: effectiveTitle,
            sourceUrl,
            locationCount: adaptedResult.places.length,
            places: adaptedResult.places,
            sourceType: 'youtube_links',
          })
            .then(({ id, createdAt }) => {
              replaceChatHistoryItem(tempHistoryId, {
                id,
                title: effectiveTitle,
                sourceUrl,
                locationCount: adaptedResult.places.length,
                places: adaptedResult.places,
                createdAt,
                sourceType: 'youtube_links',
              });
            })
            .catch((err) => console.warn('[App] saveChatHistory error:', err));

          setTimeout(() => {
            if (!cancelled) setOverlay('save');
          }, 2000);
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('YouTube parse failed:', err);
            Alert.alert('Parse Failed', err.message || 'Failed to parse YouTube URL.');
            setOverlay('import');
          }
        });
      return;
    }

      // Image scan mode: call scan_images_base64 API
    if (importMeta?.mode === 'image_scan') {
        const apiBase = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';
      fetch(`${apiBase}/scan_images_base64`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: importMeta?.imageDataList || JSON.parse(importText) }),
      })
        .then(async (response) => {
          if (cancelled) return;
          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.detail || `HTTP ${response.status}`);
          }
          return response.json();
        })
        .then((result) => {
          if (cancelled || !result) return;
          const adaptedResult = buildParseResult(
            result,
            'scan',
            'Scanned places from image',
          );
          parseResultRef.current = adaptedResult;
          setParsedPlaces(adaptedResult.places);
          const effectiveTitle = result.title || 'Scanned places from image';
          addChatHistoryItem({
            title: effectiveTitle,
            sourceUrl: 'image_scan',
            locationCount: adaptedResult.places.length,
            places: adaptedResult.places,
            sourceType: 'image_scan',
          });
          setTimeout(() => {
            if (!cancelled) setOverlay('save');
          }, 2000);
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('Image scan failed:', err);
            Alert.alert('Scan Failed', err.message || 'Failed to scan images.');
            setOverlay('import');
          }
        });
      return;
    }

    // Find Image Places mode: call find_image_places API
    if (importMeta?.mode === 'find_image_places') {
      const imageData = importMeta?.imageDataList?.[0];
      if (!imageData) {
        Alert.alert('Error', 'No image data available.');
        setOverlay('import');
        return;
      }
      const apiBase = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';
      fetch(`${apiBase}/find_image_places`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageData }),
      })
        .then(async (response) => {
          if (cancelled) return;
          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.detail || `HTTP ${response.status}`);
          }
          return response.json();
        })
        .then((result) => {
          if (cancelled || !result) return;
          const locations = result.locations || [];
          const firstLoc = locations[0] || {};
          const isUnknown = !firstLoc.latitude && !firstLoc.longitude;
          if (isUnknown) {
            Alert.alert(
              'Could Not Identify Location',
              'We were unable to identify the geographic location in this image. Please try a different photo.',
            );
            setOverlay('import');
            return;
          }
          const adaptedResult = buildParseResult(
            result,
            'find_image',
            'Identified location from image',
          );
          parseResultRef.current = adaptedResult;
          setParsedPlaces(adaptedResult.places);
          const effectiveTitle = result.title || 'Identified location from image';
          addChatHistoryItem({
            title: effectiveTitle,
            sourceUrl: 'find_image_places',
            locationCount: adaptedResult.places.length,
            places: adaptedResult.places,
            sourceType: 'find_image_places',
          });
          setTimeout(() => {
            if (!cancelled) setOverlay('save');
          }, 2000);
        })
        .catch((err) => {
          if (!cancelled) {
            console.warn('Find image place failed:', err);
            Alert.alert('Failed', err.message || 'Failed to identify location.');
            setOverlay('import');
          }
        });
      return;
    }

    const runner =
      importMeta?.mode === 'smart_text'
        ? (text: string, onProgress?: ParseProgressHandler) =>
            parseText(text, { webSearch: importMeta?.webSearch }, onProgress)
        : importMeta?.mode === 'atlas_discover'
        ? discoverFromAtlasQuery
        : parseInput;
    // Which flow produced this chat — stored to conversations.source_type
    // and shown as a chip in Chat History.
    const historySourceType =
      importMeta?.mode === 'smart_text' || importMeta?.mode === 'atlas_discover'
        ? 'smart_text'
        : /^(https?:\/\/|www\.)\S+$/i.test(importText.trim())
        ? importText.includes('reddit.com')
          ? 'reddit_links'
          : 'link'
        : 'text';

    runner(importText, handleProgress)
      .then((result) => {
        if (!cancelled) {
          const effectiveTitle = importMeta?.title || result.sourceTitle || importText;
          const sourceUrl = importMeta?.sourceUrl || importText;
          const adaptedResult: ParseResult = {
            ...result,
            sourceTitle: effectiveTitle,
          };
          // 保存解析结果到 ref 和 HomeContext
          parseResultRef.current = adaptedResult;
          setParsedPlaces(adaptedResult.places);

          // 添加到 Chat History（前端缓存）
          const tempHistoryId = addChatHistoryItem({
            title: effectiveTitle,
            sourceUrl,
            locationCount: adaptedResult.places.length,
            places: adaptedResult.places,
            sourceType: historySourceType,
          });

          // 同步到 Supabase（异步，不阻塞 UI）
          saveChatHistory({
            title: effectiveTitle,
            sourceUrl,
            locationCount: adaptedResult.places.length,
            places: adaptedResult.places,
            sourceType: historySourceType,
          })
            .then(({ id, createdAt }) => {
              replaceChatHistoryItem(tempHistoryId, {
                id,
                title: effectiveTitle,
                sourceUrl,
                locationCount: adaptedResult.places.length,
                places: adaptedResult.places,
                createdAt,
                sourceType: historySourceType,
              });
            })
            .catch((err) => console.warn('[App] saveChatHistory error:', err));

          setTimeout(() => {
            if (!cancelled) setOverlay('save');
          }, 2000);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('Parse failed:', err);
          Alert.alert(
            'Atlas AI 解析失败',
            err instanceof Error ? err.message : '请稍后再试。',
          );
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
      cancelled = true;
    };
  }, [overlay, importText, importMeta, setParsedPlaces, addChatHistoryItem, replaceChatHistoryItem, setActiveSidekick]);

  const parseResult = parseResultRef.current;

  return (
    <>
      {overlay === 'save' && parseResult ? (
        <SaveScreen
          result={parseResult}
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
              const saved = await savePlaces(selected, {
                region: parseResult.region,
                url: importMeta?.sourceUrl || importText,
              });
              // 不保留解析结果，让地图回到默认位置（西雅图）
              setParsedPlaces([]);
              // 刷新 MyPlaces 列表
              await refreshSavedPlaces();
              const sourceUrl = importMeta?.sourceUrl || importText;
              const effectiveTitle = parseResult.sourceTitle || importMeta?.title || sourceUrl;
              const nextHistoryItem = chatHistory.find(
                (item) =>
                  item.sourceUrl === sourceUrl &&
                  item.title === effectiveTitle &&
                  item.locationCount === parseResult.places.length,
              ) ?? chatHistory[0] ?? null;
              if (nextHistoryItem) {
                setActiveHistoryItem(nextHistoryItem);
                setActiveSidekick('aiChat');
              }
              setSelectedPlaceCoordinate(parseResult.centerCoordinate);
              console.log(`Saved ${saved.length} places to Supabase`);
            } catch (e) {
              console.error('Save failed:', e);
            }
            setSelectedPlaceId(null);
            setImportMeta(null);
            setOverlay('none');
          }}

          onAddToPlan={(ids) => {
            const selected = parseResult.places.filter((p) => ids.includes(p.id));
            // 保存解析结果到 Context
            setParsedPlaces(selected);
            setActiveHistoryItem(null);
            // 关闭保存界面，打开 CreatePlan 界面
            setOverlay('none');
            // 使用 HomeContext overlay 触发 CreatePlan
            setHomeOverlay({ kind: 'createPlan' });
          }}
        />
      ) : (
        <>
          <MapErrorBoundary>
            <HomeScreen
              onOpenImport={() => setOverlay('import')}
            />
          </MapErrorBoundary>

          {/* "Add places" sheet — pulls up over the home. */}
          {overlay === 'import' && (
            <ImportScreen
              onClose={() => setOverlay('none')}
              onOpenChatHistory={() => setShowChatHistory(true)}
              onSubmit={(text, mode, webSearch) => {
                parseResultRef.current = null;
                setActiveHistoryItem(null);
                const pipelineMode: 'parse' | 'smart_text' | 'atlas_discover' | 'image_scan' | 'web_scrape' | 'youtube_links' | 'find_image_places' =
                  mode === 'smartText' ? 'smart_text' :
                  mode === 'findTextPlaces' ? 'image_scan' :
                  mode === 'findImagePlaces' ? 'find_image_places' :
                  mode === 'youtubeLinks' ? 'youtube_links' :
                  mode === 'anyLinks' ? 'web_scrape' :
                  'parse';
                setImportMeta({ mode: pipelineMode, rawInput: text, title: text, webSearch });
                setImportText(text);
                setOverlay('analyzing');
              }}
              onSubmitImageScan={(imagesBase64, submitMode) => {
                parseResultRef.current = null;
                setActiveHistoryItem(null);
                const isFindImagePlaces = submitMode === 'findImagePlaces';
                setImportMeta({
                  mode: isFindImagePlaces ? 'find_image_places' : 'image_scan',
                  rawInput: isFindImagePlaces ? 'find_image_places' : 'image_scan',
                  title: isFindImagePlaces ? 'Find Image Place' : 'Scanned places from image',
                  imageDataList: imagesBase64,
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
              progressEvents={parseProgressEvents}
              notice={
                importMeta?.mode === 'web_scrape'
                  ? 'Any Links uses a pure vision pipeline, so please allow extra time to improve parsing accuracy.'
                  : undefined
              }
              onCancel={() => {
                setImportMeta(null);
                setOverlay('none');
              }}
            />
          )}

          {/* Chat history list — opened from ImportScreen's header button, rendered
              above it (mounted after in the tree). */}
          {showChatHistory && (
            <AtlasAIHome
              visible={showChatHistory}
              onClose={() => setShowChatHistory(false)}
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
        <HomeProvider>
          <StatusBar style="dark" />
          <AppContent />
          <PortalHost />
        </HomeProvider>
      </AuthGate>
    </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
