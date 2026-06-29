import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, type TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { typography } from '../../theme/typography';

// Semantic colors — mirror the SPARC Figma color tokens.
const COLOR = {
  primary: '#12C170',
  primaryLight: '#E9FBF1',
  bg: '#FFFFFF',
  bgSecondary: '#F7F7F7',
  textPrimary: '#1A1A1A',
  textSecondary: '#717171',
  textTertiary: '#B0B0B0',
  borderStrong: '#E0E0E0',
  foreground: '#09090B',
  grabber: '#CCCCCC',
} as const;

const RADIUS_BUBBLE = 18;

type ImportScreenProps = {
  onClose: () => void;
  onSubmit: (text: string) => void;
};

/** True for strings that look like a pasteable URL. */
function looksLikeUrl(value: string): boolean {
  return /^(https?:\/\/|www\.)\S+$/i.test(value.trim());
}

/**
 * "Add places" sheet — pulls up from the bottom over the home screen.
 *
 * Native pieces: the iOS keyboard (real, via BottomSheetTextInput + autoFocus)
 * and the sheet's grabber / drag / backdrop (bottom-sheet built-ins).
 * Everything else (cards, paste banner, composer) is custom-styled to match Figma.
 *
 * The Paste banner + composer live in a BottomSheetFooter so the library keeps
 * them pinned just above the keyboard — matching the design's layout.
 */
export default function ImportScreen({ onClose, onSubmit }: ImportScreenProps) {
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheet>(null);
  const inputRef = useRef<TextInput>(null);

  const [text, setText] = useState('');
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);

  const snapPoints = useMemo(() => ['92%'], []);
  const canSubmit = text.trim().length > 0;

  // Peek at the clipboard once on mount to offer a one-tap paste.
  useEffect(() => {
    let active = true;
    Clipboard.getStringAsync()
      .then((value) => {
        if (active && value && looksLikeUrl(value)) setClipboardUrl(value.trim());
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const handlePasteBanner = useCallback(() => {
    if (clipboardUrl) {
      setText(clipboardUrl);
      setClipboardUrl(null);
    }
  }, [clipboardUrl]);

  const handleSubmit = useCallback(() => {
    if (text.trim().length > 0) onSubmit(text.trim());
  }, [text, onSubmit]);

  // Focus the input once the sheet settles open (more reliable than autoFocus
  // mid-animation); unmount the overlay when it's fully closed.
  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
      else inputRef.current?.focus();
    },
    [onClose]
  );

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.2}
        pressBehavior="close"
      />
    ),
    []
  );

  const renderFooter = useCallback(
    (props: BottomSheetFooterProps) => (
      <BottomSheetFooter {...props} bottomInset={0}>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          {/* Paste-copied-link banner — only when the clipboard holds a URL. */}
          {clipboardUrl && (
            <View style={styles.pasteCard}>
              <View style={styles.pasteHeaderRow}>
                <Ionicons name="copy-outline" size={16} color={COLOR.textSecondary} />
                <Text style={styles.pasteHeaderText}>Paste copied link?</Text>
              </View>
              <View style={styles.pasteBodyRow}>
                <Text style={styles.pasteUrl} numberOfLines={1}>
                  {clipboardUrl}
                </Text>
                <TouchableOpacity
                  style={styles.pasteButton}
                  onPress={handlePasteBanner}
                  activeOpacity={0.8}
                >
                  <Text style={styles.pasteButtonText}>Paste</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Composer */}
          <View style={styles.composer}>
            <TouchableOpacity style={styles.attachButton} activeOpacity={0.7}>
              <Ionicons name="add" size={24} color={COLOR.textPrimary} />
            </TouchableOpacity>

            <BottomSheetTextInput
              ref={inputRef as never}
              value={text}
              onChangeText={setText}
              placeholder="Copy anything here..."
              placeholderTextColor={COLOR.textTertiary}
              multiline
              autoFocus
              style={styles.input}
            />

            <TouchableOpacity
              style={styles.sendButton}
              onPress={handleSubmit}
              disabled={!canSubmit}
              activeOpacity={0.8}
            >
              <Ionicons name="arrow-up" size={20} color={COLOR.primary} />
            </TouchableOpacity>
          </View>
        </View>
      </BottomSheetFooter>
    ),
    [clipboardUrl, text, canSubmit, insets.bottom, handlePasteBanner, handleSubmit]
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      onChange={handleSheetChange}
      enablePanDownToClose
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      backdropComponent={renderBackdrop}
      footerComponent={renderFooter}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <BottomSheetView style={styles.content}>
        {/* Title + close */}
        <View style={styles.headerRow}>
          <Text style={styles.title}>Add places</Text>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => sheetRef.current?.close()}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={20} color={COLOR.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Source cards — attach is stubbed for now. */}
        <View style={styles.cardsRow}>
          <Pressable style={styles.card}>
            <Ionicons name="document-outline" size={24} color={COLOR.textPrimary} />
            <Text style={styles.cardLabel}>Add files</Text>
          </Pressable>
          <Pressable style={styles.card}>
            <Ionicons name="images-outline" size={24} color={COLOR.textPrimary} />
            <Text style={styles.cardLabel}>Screenshots</Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: COLOR.bg,
    borderTopLeftRadius: 38,
    borderTopRightRadius: 38,
  },
  handleIndicator: {
    backgroundColor: COLOR.grabber,
    width: 36,
    height: 5,
    borderRadius: 100,
  },
  content: {
    paddingTop: 4,
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  title: {
    ...typography.display,
    color: COLOR.foreground,
    letterSpacing: -0.28,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Source cards
  cardsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
  },
  card: {
    flex: 1,
    height: 78,
    borderRadius: RADIUS_BUBBLE,
    backgroundColor: COLOR.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  cardLabel: {
    ...typography.labelTab,
    color: COLOR.textPrimary,
  },

  // Footer (paste banner + composer)
  footer: {
    paddingHorizontal: 12,
    gap: 12,
  },

  // Paste banner
  pasteCard: {
    backgroundColor: COLOR.bgSecondary,
    borderWidth: 0.5,
    borderColor: COLOR.borderStrong,
    borderRadius: RADIUS_BUBBLE,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  pasteHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pasteHeaderText: {
    ...typography.subheader,
    color: COLOR.textSecondary,
  },
  pasteBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pasteUrl: {
    flex: 1,
    ...typography.body,
    color: COLOR.textPrimary,
  },
  pasteButton: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: COLOR.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pasteButtonText: {
    ...typography.bodySmallEmphasis,
    color: '#FFFFFF',
  },

  // Composer
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLOR.bg,
    borderWidth: 1.5,
    borderColor: COLOR.primary,
    borderRadius: 45,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  attachButton: {
    width: 32,
    height: 32,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    ...typography.body,
    color: COLOR.textPrimary,
    maxHeight: 120,
    paddingTop: 0,
    paddingBottom: 0,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 100,
    backgroundColor: COLOR.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
