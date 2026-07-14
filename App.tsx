import { PortalHost } from '@rn-primitives/portal';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, LogBox, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './global.css';

import { savePlaces } from '@/services/place/placeService';
import { HomeProvider, useHome } from './src/features/home/HomeContext';
import HomeScreen from './src/features/home/HomeScreen';
import AnalyzingScreen from './src/features/import-places/analyzing-screen/AnalyzingScreen';
import ImportScreen from './src/features/import-places/import-screen/ImportScreen';
import SaveScreen from './src/features/import-places/save-screen/SaveScreen';
import type { ParseProgressEvent } from './src/services/api/apiService';
import {
  discoverFromAtlasQuery,
  formatParsedPlaceSubtitle,
  parseInput,
  parseText,
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
  mode?: 'parse' | 'smart_text' | 'atlas_discover' | 'image_scan' | 'web_scrape';
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
  const parseResultRef = useRef<ParseResult | null>(null);
  const { setParsedPlaces, refreshSavedPlaces, setOverlay: setHomeOverlay, addChatHistoryItem, replaceChatHistoryItem, setActiveHistoryItem, setSelectedPlaceCoordinate, setSelectedPlaceId, setActiveSidekick } = useHome();

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
          addChatHistoryItem({
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
              console.log(`Saved ${saved.length} places to Supabase`);
            } catch (e) {
              console.error('Save failed:', e);
            }
            setActiveHistoryItem(null);
            setSelectedPlaceCoordinate(null);
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
              onStartAiImport={(meta) => {
                parseResultRef.current = null;
                setActiveHistoryItem(null);
                setImportMeta(meta);
                setImportText(meta.rawInput);
                setOverlay('analyzing');
              }}
            />
          </MapErrorBoundary>

          {/* "Add places" sheet — pulls up over the home. */}
          {overlay === 'import' && (
            <ImportScreen
              onClose={() => setOverlay('none')}
              onSubmit={(text, mode, webSearch) => {
                parseResultRef.current = null;
                setActiveHistoryItem(null);
                const pipelineMode: 'parse' | 'smart_text' | 'atlas_discover' | 'image_scan' | 'web_scrape' =
                  mode === 'smartText' ? 'smart_text' :
                  mode === 'imageScan' ? 'image_scan' :
                  mode === 'anyLinks' ? 'web_scrape' :
                  'parse';
                setImportMeta({ mode: pipelineMode, rawInput: text, title: text, webSearch });
                setImportText(text);
                setOverlay('analyzing');
              }}
              onSubmitImageScan={(imagesBase64) => {
                parseResultRef.current = null;
                setActiveHistoryItem(null);
                setImportMeta({
                  mode: 'image_scan',
                  rawInput: 'image_scan',
                  title: 'Scanned places from image',
                  imageDataList: imagesBase64,
                });
                setImportText('image_scan');
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
        </>
      )}
    </>
  );
}

// ---- Root — wraps everything with HomeProvider so context is available
//      even while SaveScreen (which replaces HomeScreen) is shown. ----

export default function App() {
  return (
    <SafeAreaProvider>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HomeProvider>
        <StatusBar style="dark" />
        <AppContent />
        <PortalHost />
      </HomeProvider>
    </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
