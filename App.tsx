import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import HomeScreen from './src/features/home/HomeScreen';
import ImportScreen from './src/features/import/ImportScreen';
import PreviewScreen from './src/features/import/PreviewScreen';

type Overlay = 'none' | 'import' | 'preview';

/**
 * Error boundary to catch rendering errors from Mapbox or other native modules.
 * Prevents a full white/black screen when a child component crashes.
 */
class MapErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null };

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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />

      {overlay === 'import' ? (
        <ImportScreen
          onClose={() => setOverlay('none')}
          onSubmit={(text) => {
            console.log('Imported text:', text);
            setOverlay('preview');
          }}
        />
      ) : (
        <>
          <MapErrorBoundary>
            <HomeScreen onOpenImport={() => setOverlay('import')} />
          </MapErrorBoundary>

          {overlay === 'preview' && (
            <PreviewScreen
              onClose={() => setOverlay('import')}
              onSave={() => setOverlay('none')}
            />
          )}
        </>
      )}
    </GestureHandlerRootView>
  );
}
