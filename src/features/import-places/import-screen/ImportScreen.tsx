import Ionicons from '@expo/vector-icons/Ionicons';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions, type TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { typography } from '../../../theme/typography';

export type ImportMode = 'smartText' | 'findTextPlaces' | 'redditLinks' | 'anyLinks' | 'youtubeLinks' | 'findImagePlaces';

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
  onSubmit: (text: string, mode: ImportMode, webSearch?: boolean) => void;
  onSubmitImageScan?: (imagesBase64: string[], mode?: ImportMode) => void;
  onScanResult?: (result: any) => void;
  /** Opens the Atlas AI chat history list (AtlasAIHome) over this sheet. */
  onOpenChatHistory?: () => void;
};

const modes: { key: ImportMode; icon: string; title: string; subtitle: string }[] = [
  { key: 'smartText', icon: 'document-text-outline', title: 'Smart Text', subtitle: 'Paste a prompt, note, or itinerary' },
  { key: 'findTextPlaces', icon: 'image-outline', title: 'Find Text Places', subtitle: 'Scan image text for places' },
  { key: 'redditLinks', icon: 'logo-reddit', title: 'Reddit Links', subtitle: 'Save places from Reddit threads' },
  { key: 'anyLinks', icon: 'link-outline', title: 'Any Links', subtitle: 'Vision scan any web page' },
  { key: 'youtubeLinks', icon: 'logo-youtube', title: 'YouTube Links', subtitle: 'Extract places from transcripts' },
  { key: 'findImagePlaces', icon: 'camera-outline', title: 'Find Image Places', subtitle: 'Identify landmarks from photos' },
];

const TIPS: { mode: ImportMode; text: string }[] = [
  { mode: 'findTextPlaces', text: 'Scan screenshots for places' },
  { mode: 'findTextPlaces', text: 'Screenshot a X post & extract locations' },
  { mode: 'findImagePlaces', text: 'Upload a photo to identify its location' },
  { mode: 'smartText', text: 'Paste any text to extract spots' },
  { mode: 'smartText', text: 'Try "Game of Thrones filming locations"' },
  { mode: 'smartText', text: 'Try "Where did Taylor Swift marry?"' },
  { mode: 'redditLinks', text: 'Save cool spots from Reddit' },
  { mode: 'anyLinks', text: 'Paste a travel URL & save all' },
  { mode: 'anyLinks', text: 'Any Links uses a pure vision model (Gemini 2.5 Compute Use) and may take longer for accuracy' },
  { mode: 'smartText', text: 'Paste a X post to extract locations' },
  { mode: 'smartText', text: 'Paste a Thread post to extract locations' },
  { mode: 'youtubeLinks', text: 'Paste a YouTube link to extract places from the transcript' },
];

/**
 * "Add places" sheet — pulls up from the bottom over the home screen.
 *
 * Users pick a mode (Smart Text, Image Scan, Reddit Links, Any Links),
 * then provide input via text field or image picker accordingly.
 */
export default function ImportScreen({ onClose, onSubmit, onSubmitImageScan, onScanResult, onOpenChatHistory }: ImportScreenProps) {
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheet>(null);
  const inputRef = useRef<TextInput>(null);
  const { width: screenWidth } = useWindowDimensions();

  const [selectedMode, setSelectedMode] = useState<ImportMode | null>(null);
  const [text, setText] = useState('');
  const [images, setImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [tipIndex, setTipIndex] = useState(0);
  const [webSearchHighlighted, setWebSearchHighlighted] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const snapPoints = useMemo(() => ['92%'], []);

  const pickImages = useCallback(async () => {
    const isSingleImage = selectedMode === 'findImagePlaces';
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: !isSingleImage,
      selectionLimit: isSingleImage ? 1 : 3,
      quality: 0.7,
      base64: true,
    });
    if (!result.canceled && result.assets.length > 0) {
      setImages(result.assets.slice(0, isSingleImage ? 1 : 3));
    }
  }, [selectedMode]);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  useEffect(() => {
    if (selectedMode !== 'smartText') {
      setWebSearchHighlighted(false);
    }
  }, [selectedMode]);

  const handleSubmit = useCallback(async () => {
    if (!selectedMode) return;
    if (selectedMode === 'findTextPlaces' || selectedMode === 'findImagePlaces') {
      if (images.length === 0) return;
      const imageDataList = images
        .map((img) => img.base64)
        .filter((b64): b64 is string => Boolean(b64));
      if (imageDataList.length === 0) {
        Alert.alert('Error', 'No image data available.');
        return;
      }
      // Switch to analyzing immediately so the user sees the waiting screen
      // right away instead of sitting on My Places during sheet animation.
      onSubmitImageScan?.(imageDataList, selectedMode);
      return;
    }
    if (!text.trim()) return;
    onSubmit(text.trim(), selectedMode, selectedMode === 'smartText' ? webSearchHighlighted : undefined);
  }, [selectedMode, text, images, onSubmit, onSubmitImageScan, onScanResult, onClose]);

  // Rotating tip banner — cycle every 3 seconds with fade transition
  useEffect(() => {
    const interval = setInterval(() => {
      // Fade out → change text → fade in
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setTipIndex((prev) => (prev + 1) % TIPS.length);
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [fadeAnim]);

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
          {/* Input area — changes based on selectedMode */}
          {selectedMode === 'findTextPlaces' || selectedMode === 'findImagePlaces' ? (
            /* Image modes: show image picker with thumbnails */
            <View style={styles.imagePickerArea}>
              {images.length > 0 ? (
                <View style={styles.imagePickerContent}>
                  {/* Image thumbnails row */}
                  <View style={styles.imageThumbRow}>
                    {images.map((img, idx) => {
                      const RNImage = require('react-native').Image;
                      return (
                        <View key={idx} style={styles.imageThumbWrapper}>
                          <View style={styles.imageThumbWrap}>
                            <RNImage source={{ uri: img.uri }} style={styles.imageThumb} />
                          </View>
                          <TouchableOpacity
                            style={styles.imageRemoveBtn}
                            onPress={() => removeImage(idx)}
                            hitSlop={8}
                          >
                            <Ionicons name="close-circle" size={22} color="#FF3B30" />
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                    {selectedMode === 'findTextPlaces' && images.length < 3 && (
                      <TouchableOpacity style={styles.imageAddBtn} onPress={pickImages} activeOpacity={0.7}>
                        <Ionicons name="add" size={24} color={COLOR.primary} />
                      </TouchableOpacity>
                    )}
                  </View>
                  {/* Send button */}
                  <TouchableOpacity
                    style={[styles.imageSendBtn, images.length === 0 && styles.sendButtonDisabled]}
                    onPress={handleSubmit}
                    disabled={images.length === 0}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="scan-outline" size={18} color="#FFFFFF" />
                    <Text style={styles.imageSendText}>
                      {selectedMode === 'findImagePlaces' ? 'Find Place' : `Scan ${images.length} image${images.length > 1 ? 's' : ''}`}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.imagePickerButton} onPress={pickImages} activeOpacity={0.7}>
                  <Ionicons name="images-outline" size={32} color={COLOR.primary} />
                  <Text style={styles.imagePickerText}>
                    {selectedMode === 'findImagePlaces' ? 'Select 1 Image' : 'Select up to 3 images'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            /* Text input modes (smartText, redditLinks, anyLinks, or none) */
            <View style={styles.composer}>
              {selectedMode === 'smartText' && (
                <>
                  <View style={styles.composerHeader}>
                    <View style={styles.composerLabelWrap}>
                     
                     
                    </View>
                    <TouchableOpacity
                      style={[styles.webSearchButton, webSearchHighlighted && styles.webSearchButtonActive]}
                      onPress={() => {
                        setWebSearchHighlighted((prev) => {
                          const next = !prev;
                          console.log(`[ImportScreen] Smart Text web search = ${next ? 'ON' : 'OFF'}`);
                          return next;
                        });
                      }}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name="globe-outline"
                        size={15}
                        color={webSearchHighlighted ? '#FFFFFF' : COLOR.textPrimary}
                      />
                      <Text style={[styles.webSearchText, webSearchHighlighted && styles.webSearchTextActive]}>
                        {webSearchHighlighted ? 'Web Search On' : 'Web Search Off'}
                      </Text>
                      <View style={[styles.webSearchDot, webSearchHighlighted && styles.webSearchDotActive]} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.composerNote}>
                    {webSearchHighlighted
                      ? 'Qwen 3.5 web search will be used.'
                      : 'DeepSeek V4 Flash will be used.'}
                  </Text>
                  
                </>
              )}
              {selectedMode === 'anyLinks' && (
                <Text style={styles.anyLinksNote}>
                  Any Links mode uses a pure vision model and may take longer to improve parsing accuracy.
                  {'\n'}{'\n'}
                  Gemini 3.5 Flash will be used.
                </Text>
              )}

              <View style={styles.inputRow}>
                <BottomSheetTextInput
                  ref={inputRef as never}
                  value={text}
                  onChangeText={setText}
                  placeholder={
                    selectedMode === null
                      ? 'Choose a mode above...'
                      : selectedMode === 'smartText'
                      ? 'Show me Breaking Bad filming locations...'
                    : selectedMode === 'redditLinks'
                      ? 'Copy a Reddit post/thread URL here...'
                      : selectedMode === 'anyLinks'
                      ? 'Paste any web page URL here...'
                      : 'Extract places from URLs here...'
                  }
                  placeholderTextColor={COLOR.textTertiary}
                  multiline
                  autoFocus
                  editable={selectedMode !== null}
                  style={styles.input}
                  textAlignVertical="top"
                />

                {selectedMode !== null && (
                  <TouchableOpacity
                    style={[
                      styles.sendButton,
                      !text.trim() && styles.sendButtonDisabled,
                    ]}
                    onPress={handleSubmit}
                    disabled={!text.trim()}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name="arrow-up"
                      size={20}
                      color={text.trim() ? COLOR.primary : COLOR.textTertiary}
                    />
                    </TouchableOpacity>
                )}
              </View>

              
            </View>
          )}
        </View>
      </BottomSheetFooter>
    ),
    [selectedMode, text, insets.bottom, handleSubmit, webSearchHighlighted]
  );

  const buttonWidth = (screenWidth - 48) / 2; // 16 padding left + 12 gap + 16 padding right = 44... actually (screenWidth - 16*2 - 12) / 2 = (screenWidth - 44) / 2

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
          <View style={styles.headerActions}>
            {onOpenChatHistory && (
              <TouchableOpacity
                style={styles.headerIconButton}
                onPress={onOpenChatHistory}
                activeOpacity={0.7}
              >
                <Ionicons name="time-outline" size={20} color={COLOR.textPrimary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.headerIconButton}
              onPress={() => sheetRef.current?.close()}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={20} color={COLOR.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        

        {/* Mode selection grid (2x2) */}
        <View style={styles.modesGrid}>
          {modes.map((mode) => {
            const isActive = selectedMode === mode.key;
            return (
              <Pressable
                key={mode.key}
                style={[
                  styles.modeButton,
                  { width: buttonWidth },
                  isActive && styles.modeButtonActive,
                ]}
                onPress={() => {
                  setSelectedMode(mode.key);
                  setText('');
                }}
              >
                <View style={[styles.modeIconBubble, isActive && styles.modeIconBubbleActive]}>
                  <Ionicons
                    name={mode.icon as any}
                    size={22}
                    color={isActive ? COLOR.primary : COLOR.textPrimary}
                  />
                </View>
                <Text style={[styles.modeTitle, isActive && styles.modeTitleActive]}>
                  {mode.title}
                </Text>
                <Text style={styles.modeSubtitle}>{mode.subtitle}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Rotating tip banner */}
        <Animated.View style={[styles.tipBanner, { opacity: fadeAnim }]}>
          <View style={styles.tipDot} />
          <Text style={styles.tipText}>
            {TIPS[tipIndex].mode === 'findTextPlaces' ? 'Find Text Places' :
             TIPS[tipIndex].mode === 'findImagePlaces' ? 'Find Image Places' :
             TIPS[tipIndex].mode === 'smartText' ? 'Smart Text' :
             TIPS[tipIndex].mode === 'redditLinks' ? 'Reddit Links' : 'Any Links'}
            {' · '}
            {TIPS[tipIndex].text}
          </Text>
        </Animated.View>
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Hero
  heroCard: {
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(18, 193, 112, 0.12)',
    backgroundColor: '#FFFFFF',
  },
  heroBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(18, 193, 112, 0.10)',
    marginBottom: 12,
  },
  heroBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLOR.primary,
    letterSpacing: 0.2,
  },
  heroTitle: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.45,
    color: COLOR.foreground,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: COLOR.textSecondary,
  },

  // Mode grid (2 columns)
  modesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  modeButton: {
    minHeight: 112,
    borderRadius: 24,
    backgroundColor: '#FCFCFC',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 18,
    elevation: 1,
  },
  modeButtonActive: {
    backgroundColor: COLOR.primaryLight,
    borderWidth: 1.5,
    borderColor: COLOR.primary,
  },
  modeIconBubble: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  modeIconBubbleActive: {
    backgroundColor: '#FFFFFF',
  },
  modeTitle: {
    fontWeight: '600',
    fontSize: 15,
    color: COLOR.textPrimary,
    textAlign: 'center',
  },
  modeTitleActive: {
    color: COLOR.primary,
  },
  modeSubtitle: {
    fontSize: 12,
    color: COLOR.textSecondary,
    textAlign: 'center',
  },

  // Footer
  footer: {
    paddingHorizontal: 12,
    gap: 12,
  },

  // Image picker (Image Scan mode)
  imagePickerArea: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  imagePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLOR.primaryLight,
    borderWidth: 1.5,
    borderColor: COLOR.primary,
    borderRadius: RADIUS_BUBBLE,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  imagePickerText: {
    ...typography.bodySmallEmphasis,
    color: COLOR.primary,
  },
  imagePickerContent: {
    width: '100%',
    alignItems: 'center',
  },
  imageThumbRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 14,
  },
  imageThumbWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageThumbWrap: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: '#F0F0ED',
  },
  imageThumb: {
    width: 72,
    height: 72,
    borderRadius: 14,
  },
  imageRemoveBtn: {
    position: 'absolute',
    top: -8,
    right: -8,
    zIndex: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 11,
  },
  imageAddBtn: {
    width: 72,
    height: 72,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLOR.primary,
    borderStyle: 'dashed',
    backgroundColor: COLOR.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageSendBtn: {
    height: 48,
    borderRadius: 999,
    backgroundColor: COLOR.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 32,
    minWidth: 200,
    alignSelf: 'center',
  },
  imageSendText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // Composer
  composer: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 10,
    backgroundColor: '#f9f7f7',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 28,
    paddingHorizontal: 14,
    paddingVertical: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 3,
  },
  composerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  composerLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  composerLabelIcon: {
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18, 193, 112, 0.12)',
  },
  composerLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLOR.textPrimary,
  },
  webSearchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    minWidth: 132,
    justifyContent: 'center',
  },
  webSearchButtonActive: {
    backgroundColor: COLOR.primary,
    borderColor: COLOR.primary,
    shadowColor: COLOR.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 2,
  },
  webSearchText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLOR.textPrimary,
  },
  webSearchTextActive: {
    color: '#FFFFFF',
  },
  webSearchDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(26,26,26,0.35)',
    marginLeft: 2,
  },
  webSearchDotActive: {
    backgroundColor: '#FFFFFF',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    backgroundColor: '#ffffff',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: COLOR.textPrimary,
    maxHeight: 120,
    paddingTop: 2,
    paddingBottom: 2,
    textAlignVertical: 'top',
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: COLOR.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: COLOR.bgSecondary,
  },
  composerNote: {
    fontSize: 12,
    lineHeight: 16,
    color: COLOR.textSecondary,
    paddingHorizontal: 2,
  },
  anyLinksNote: {
    fontSize: 12,
    lineHeight: 16,
    color: COLOR.textSecondary,
    paddingHorizontal: 2,
    marginBottom: 2,
  },

  // Rotating tip banner
  tipBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#F7F7F7',
    marginHorizontal: 12,
    borderRadius: 14,
    marginBottom: 8,
  },
  tipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#12C170',
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    color: '#717171',
    fontWeight: '500',
  },
});
