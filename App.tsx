import './global.css';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import HomeScreen from './src/features/home/HomeScreen';
import ImportScreen from './src/features/import/ImportScreen';
import PreviewScreen from './src/features/import/PreviewScreen';

type Overlay = 'none' | 'import' | 'preview';

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
          <HomeScreen onOpenImport={() => setOverlay('import')} />

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