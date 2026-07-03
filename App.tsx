import './global.css';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PortalHost } from '@rn-primitives/portal';

import HomeScreen from './src/features/home/HomeScreen';
import ImportScreen from './src/features/import-places/import-screen/ImportScreen';
import AnalyzingScreen from './src/features/import-places/analyzing-screen/AnalyzingScreen';
import SaveScreen from './src/features/import-places/save-screen/SaveScreen';
import { parseLink, type ParseResult } from './src/services/import/importService';
import { savePlaces } from '@/services/place/placeService';

type Overlay = 'none' | 'import' | 'analyzing' | 'save';

/**
 * Error boundary to catch rendering errors from Mapbox or other native modules.
 * Prevents a full white/black screen when a child component crashes.
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

export default function App() {
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [importText, setImportText] = useState('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);

  // Run the parse while the Analyzing screen is showing; advance to the Save
  // screen when it resolves (unless the user cancelled out of analyzing).
  useEffect(() => {
    if (overlay !== 'analyzing') return;
    let cancelled = false;
    parseLink(importText)
      .then((result) => {
        if (!cancelled) {
          setParseResult(result);
          setOverlay('save');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('Parse failed:', err);
          setOverlay('import');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [overlay, importText]);

  return (
    <SafeAreaProvider>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />

      {overlay === 'save' && parseResult ? (
        // Results screen fully replaces the home screen.
        <SaveScreen
          result={parseResult}
          onClose={() => setOverlay('none')}

          onSave={async (ids) => {
            try {
              const selected = parseResult.places.filter((p) => ids.includes(p.id));
              const saved = await savePlaces(selected, {
                region: parseResult.region,
              });
              console.log(`Saved ${saved.length} places to Supabase`);
            } catch (e) {
              console.error('Save failed:', e);
            }
            setOverlay('none');
          }}

          onAddToPlan={(ids) => {
            console.log('Add to plan:', ids);
            setOverlay('none');
          }}
        />
      ) : (
        <>
          <MapErrorBoundary>
            <HomeScreen onOpenImport={() => setOverlay('import')} />
          </MapErrorBoundary>

          {/* "Add places" sheet — pulls up over the home. */}
          {overlay === 'import' && (
            <ImportScreen
              onClose={() => setOverlay('none')}
              onSubmit={(text) => {
                setImportText(text);
                setOverlay('analyzing');
              }}
            />
          )}

          {/* Processing state while the link is parsed. */}
          {overlay === 'analyzing' && (
            <AnalyzingScreen url={importText} onCancel={() => setOverlay('none')} />
          )}
        </>
      )}
      <PortalHost />
    </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
