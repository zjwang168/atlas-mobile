import Ionicons from '@expo/vector-icons/Ionicons';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Reanimated, { FadeInDown, FadeInUp, FadeOutDown, FadeOutUp } from 'react-native-reanimated';
import {
  Alert,
  Animated,
  Image,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getLinkPreview, type LinkPreview } from '../../../services/api/apiService';
import { typography } from '../../../theme/typography';

export type ImportMode =
  | 'smartText'
  | 'findTextPlaces'
  | 'redditLinks'
  | 'tiktokLinks'
  | 'instagramReels'
  | 'facebookReels'
  | 'anyLinks'
  | 'youtubeLinks'
  | 'findImagePlaces';

type ImportSection = 'menu' | 'social' | 'images' | 'text' | 'links';
type SocialMode = Extract<ImportMode, 'redditLinks' | 'youtubeLinks' | 'tiktokLinks' | 'instagramReels' | 'facebookReels' | 'anyLinks'>;
type ImageMode = Extract<ImportMode, 'findTextPlaces' | 'findImagePlaces'>;

type ImportScreenProps = {
  onClose: () => void;
  onSubmit: (text: string, mode: ImportMode, webSearch?: boolean) => void;
  onSubmitImageScan?: (imagesBase64: string[], mode?: ImportMode) => void;
  onScanResult?: (result: unknown) => void;
  /** Kept for App-level compatibility; chat history now belongs to Chat, not Add places. */
  onOpenChatHistory?: () => void;
};

type MenuCard = {
  key: Exclude<ImportSection, 'menu'>;
  title: string;
  subtitle: string;
  icon: 'social' | 'images' | 'text' | 'links';
};

const COLOR = {
  primary: '#12C170',
  primaryLight: '#E9FBF1',
  bg: '#FFFFFF',
  surface: '#FBFBFB',
  surfaceSecondary: '#F5F5F5',
  textPrimary: '#1A1A1A',
  textSecondary: '#717171',
  textTertiary: '#B0B0B0',
  border: 'rgba(60,60,67,0.12)',
  grabber: '#CCCCCC',
} as const;

const MENU_CARDS: MenuCard[] = [
  {
    key: 'social',
    title: 'Social media',
    subtitle: 'Reddit and social videos',
    icon: 'social',
  },
  {
    key: 'images',
    title: 'Image recognition',
    subtitle: 'Photos and screenshots',
    icon: 'images',
  },
  {
    key: 'text',
    title: 'Paste text',
    subtitle: 'Notes, itineraries, and lists',
    icon: 'text',
  },
  {
    key: 'links',
    title: 'Any other links',
    subtitle: 'Articles, blogs, and webpages',
    icon: 'links',
  },
];

function looksLikeUrl(value: string): boolean {
  return /^(https?:\/\/|www\.)\S+$/i.test(value.trim());
}

function resolveSocialMode(value: string, fallback: SocialMode = 'anyLinks'): SocialMode {
  const normalized = value.trim().toLowerCase();
  if (/(youtube\.com|youtu\.be)/i.test(normalized)) return 'youtubeLinks';
  if (/(^|\.)tiktok\.com/i.test(normalized)) return 'tiktokLinks';
  if (/(^|\.)instagram\.com\/(reel|reels)\//i.test(normalized) || /(^|\.)instagr\.am\/(reel|reels)\//i.test(normalized)) return 'instagramReels';
  if (/(^|\.)facebook\.com\//i.test(normalized) || /(^|\.)fb\.watch\//i.test(normalized)) return 'facebookReels';
  if (/(reddit\.com|redd\.it|old\.reddit\.com)/i.test(normalized)) return 'redditLinks';
  return fallback;
}

type ResolvedLinkPreview = LinkPreview & { url: string };

type SlidingSegmentedControlProps = {
  labels: readonly string[];
  selectedIndex: number;
  width: number;
  onSelect: (index: number) => void;
};

function SlidingSegmentedControl({
  labels,
  selectedIndex,
  width,
  onSelect,
}: SlidingSegmentedControlProps) {
  const position = useRef(new Animated.Value(selectedIndex)).current;
  const segmentWidth = (width - 4) / 2;

  useEffect(() => {
    Animated.spring(position, {
      toValue: selectedIndex,
      stiffness: 300,
      damping: 28,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [position, selectedIndex]);

  return (
    <View style={[styles.segmentedControl, { width }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.segmentIndicator,
          {
            width: segmentWidth,
            transform: [
              {
                translateX: position.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, segmentWidth],
                }),
              },
            ],
          },
        ]}
      />
      {labels.map((label, index) => {
        const active = selectedIndex === index;
        return (
          <Pressable
            key={label}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(index)}
            style={styles.segmentButton}
          >
            <Text
              style={[
                styles.segmentText,
                !active && styles.segmentTextInactive,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function LinkPreviewCard({ preview }: { preview: LinkPreview }) {
  const isYouTube = preview.kind === 'youtube';
  const isReddit = preview.kind === 'reddit';
  const isTikTok = preview.kind === 'tiktok';
  const isInstagram = preview.kind === 'instagram';
  const isFacebook = preview.kind === 'facebook';
  return (
    <View style={styles.linkPreviewCard}>
      {preview.image_url ? (
        <Image source={{ uri: preview.image_url }} style={styles.linkPreviewImage} resizeMode="cover" />
      ) : (
        <View style={[styles.linkPreviewFallback, isYouTube && styles.linkPreviewYoutubeFallback, isReddit && styles.linkPreviewRedditFallback, isInstagram && styles.linkPreviewInstagramFallback, isFacebook && styles.linkPreviewFacebookFallback]}>
          <Ionicons name={isReddit ? 'logo-reddit' : isYouTube ? 'logo-youtube' : isTikTok ? 'logo-tiktok' : isInstagram ? 'logo-instagram' : isFacebook ? 'logo-facebook' : 'globe-outline'} size={25} color={isYouTube ? '#FF0000' : isReddit ? '#FF4500' : isTikTok ? '#161616' : isInstagram ? '#D62976' : isFacebook ? '#1877F2' : COLOR.primary} />
        </View>
      )}
      <View style={styles.linkPreviewCopy}>
        <View style={styles.linkPreviewLabelRow}>
          <Ionicons name={isReddit ? 'logo-reddit' : isYouTube ? 'logo-youtube' : isTikTok ? 'logo-tiktok' : isInstagram ? 'logo-instagram' : isFacebook ? 'logo-facebook' : 'link-outline'} size={13} color={isYouTube ? '#FF0000' : isReddit ? '#FF4500' : isTikTok ? '#161616' : isInstagram ? '#D62976' : isFacebook ? '#1877F2' : COLOR.textSecondary} />
          <Text style={styles.linkPreviewLabel}>{isYouTube ? 'YouTube video' : isReddit ? 'Reddit post' : isTikTok ? 'TikTok video' : isInstagram ? 'Instagram Reel' : isFacebook ? 'Facebook Reel' : preview.hostname}</Text>
        </View>
        <Text style={styles.linkPreviewTitle} numberOfLines={2}>{preview.title}</Text>
      </View>
    </View>
  );
}

function LinkPreviewLoading() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 540, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 540, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <View accessibilityLabel="Loading link preview" style={styles.linkPreviewLoading}>
      {[0, 1, 2].map((index) => {
        const start = index === 0 ? 0.01 : index * 0.22;
        const peak = Math.min(start + 0.18, 0.96);
        const end = Math.min(start + 0.38, 0.99);
        const opacity = pulse.interpolate({
          inputRange: [0, start, peak, end, 1],
          outputRange: [0.35, 0.35, 1, 0.35, 0.35],
          extrapolate: 'clamp',
        });
        return <Animated.View key={index} style={[styles.previewLoadingDot, { opacity }]} />;
      })}
    </View>
  );
}

function MenuCardIcon({ type }: { type: MenuCard['icon'] }) {
  if (type === 'social') {
    return (
      <View style={styles.socialIconGroup}>
        <View style={[styles.brandIconBubble, styles.redditIconBubble]}>
          <Ionicons name="logo-reddit" size={17} color="#FF4500" />
        </View>
        <View style={[styles.brandIconBubble, styles.youtubeIconBubble]}>
          <Ionicons name="logo-youtube" size={17} color="#FF0000" />
        </View>
        <View style={[styles.brandIconBubble, styles.tiktokIconBubble]}>
          <Ionicons name="logo-tiktok" size={17} color="#161616" />
        </View>
        <View style={[styles.brandIconBubble, styles.instagramIconBubble]}>
          <Ionicons name="logo-instagram" size={17} color="#D62976" />
        </View>
        <View style={[styles.brandIconBubble, styles.facebookIconBubble]}>
          <Ionicons name="logo-facebook" size={17} color="#1877F2" />
        </View>
      </View>
    );
  }

  const iconName =
    type === 'images'
      ? 'images-outline'
      : type === 'text'
        ? 'document-text-outline'
        : 'link-outline';

  const bubbleStyle =
    type === 'images'
      ? styles.imageMenuIconBubble
      : type === 'text'
        ? styles.textMenuIconBubble
        : styles.linkMenuIconBubble;
  const iconColor =
    type === 'images' ? '#1686E8' : type === 'text' ? '#E99A08' : COLOR.primary;

  return (
    <View style={[styles.menuIconBubble, bubbleStyle]}>
      <Ionicons name={iconName} size={24} color={iconColor} />
    </View>
  );
}

export default function ImportScreen({
  onClose,
  onSubmit,
  onSubmitImageScan,
}: ImportScreenProps) {
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheet>(null);
  const inputRef = useRef<TextInput>(null);
  const openingDetailRef = useRef(false);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardVisibleRef = useRef(false);
  const inputFocusedRef = useRef(false);
  const { height: windowHeight } = useWindowDimensions();

  const [section, setSection] = useState<ImportSection>('menu');
  const [selectedMode, setSelectedMode] = useState<ImportMode | null>(null);
  const [socialMode, setSocialMode] = useState<SocialMode>('anyLinks');
  const [imageMode, setImageMode] = useState<ImageMode>('findTextPlaces');
  const [text, setText] = useState('');
  const [images, setImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [clipboardAvailable, setClipboardAvailable] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [linkPreview, setLinkPreview] = useState<ResolvedLinkPreview | null>(null);
  const [previewPending, setPreviewPending] = useState(false);

  const snapPoints = useMemo(
    () =>
      section === 'menu'
        ? [Math.ceil(windowHeight * 0.58)]
        : [Math.ceil(windowHeight * 0.58), '92%'],
    [section, windowHeight],
  );

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      keyboardVisibleRef.current = true;
      setKeyboardVisible(true);
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      keyboardVisibleRef.current = false;
      setKeyboardVisible(false);
      setKeyboardHeight(0);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const scheduleInputFocus = useCallback((delay = 80) => {
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => {
      requestAnimationFrame(() => inputRef.current?.focus());
      focusTimerRef.current = null;
    }, delay);
  }, []);

  useEffect(
    () => () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (section !== 'social' && section !== 'links') return;

    let active = true;
    Clipboard.hasStringAsync()
      .then((hasText) => {
        if (active) setClipboardAvailable(hasText);
      })
      .catch(() => {
        // Clipboard access is optional; the manual input remains available.
      });

    return () => {
      active = false;
    };
  }, [section]);

  useEffect(() => {
    if ((section !== 'social' && section !== 'links') || text.trim()) return;
    Clipboard.hasStringAsync()
      .then(setClipboardAvailable)
      .catch(() => setClipboardAvailable(false));
  }, [section, text]);

  useEffect(() => {
    const supportsPreview = section === 'social' || section === 'links';
    const url = text.trim();
    if (!supportsPreview || !looksLikeUrl(url)) {
      setLinkPreview(null);
      setPreviewPending(false);
      return undefined;
    }

    setPreviewPending(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      getLinkPreview(url, controller.signal)
        .then((preview) => {
          if (!controller.signal.aborted) setLinkPreview({ ...preview, url });
        })
        .catch(() => {
          if (!controller.signal.aborted) setLinkPreview(null);
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewPending(false);
        });
    }, 350);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [section, text]);

  const openSection = useCallback(
    (nextSection: Exclude<ImportSection, 'menu'>) => {
      Keyboard.dismiss();
      inputFocusedRef.current = false;
      openingDetailRef.current = true;
      setSection(nextSection);
      setText('');
      setLinkPreview(null);
      setImages([]);

      if (nextSection === 'images') setSelectedMode(imageMode);
      if (nextSection === 'text') setSelectedMode('smartText');
      if (nextSection === 'links') setSelectedMode('anyLinks');
      if (nextSection === 'social') {
        setSocialMode('anyLinks');
        setSelectedMode('anyLinks');
      }

      requestAnimationFrame(() => sheetRef.current?.snapToIndex(1));
    },
    [imageMode],
  );

  const returnToMenu = useCallback(() => {
    Keyboard.dismiss();
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    inputFocusedRef.current = false;
    openingDetailRef.current = false;
    setSection('menu');
    setSelectedMode(null);
    setSocialMode('anyLinks');
    setText('');
    setLinkPreview(null);
    setImages([]);
    requestAnimationFrame(() => sheetRef.current?.snapToIndex(0));
  }, []);

  const selectImageMode = useCallback((mode: ImageMode) => {
    setImageMode(mode);
    setSelectedMode(mode);
    setImages([]);
  }, []);

  const pickImages = useCallback(async () => {
    const isSingleImage = imageMode === 'findImagePlaces';
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
  }, [imageMode]);

  const removeImage = useCallback((index: number) => {
    setImages((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedMode) return;

    if (section === 'images') {
      if (images.length === 0) return;
      const imageDataList = images
        .map((image) => image.base64)
        .filter((base64): base64 is string => Boolean(base64));

      if (imageDataList.length === 0) {
        Alert.alert('Error', 'No image data available.');
        return;
      }

      onSubmitImageScan?.(imageDataList, imageMode);
      return;
    }

    const trimmedText = text.trim();
    if (!trimmedText) return;

    if (section === 'social') {
      const resolvedMode = resolveSocialMode(trimmedText);
      setSocialMode(resolvedMode);
      setSelectedMode(resolvedMode);
      onSubmit(trimmedText, resolvedMode);
      return;
    }

    onSubmit(
      trimmedText,
      selectedMode,
      selectedMode === 'smartText' ? webSearchEnabled : undefined,
    );
  }, [
    imageMode,
    images,
    onSubmit,
    onSubmitImageScan,
    section,
    selectedMode,
    text,
    webSearchEnabled,
  ]);

  const applyPastedLink = useCallback(
    (value: string) => {
      const candidate = value.trim();
      if (!looksLikeUrl(candidate)) return;
      if (section === 'social') {
        const detected = resolveSocialMode(candidate);
        setSocialMode(detected);
        setSelectedMode(detected);
      } else {
        setSelectedMode('anyLinks');
      }
      setText(candidate);
      inputRef.current?.focus();
    },
    [section],
  );

  const pasteClipboardLink = useCallback(async () => {
    const value = await Clipboard.getStringAsync();
    applyPastedLink(value);
  }, [applyPastedLink]);

  const handleNativePaste = useCallback(
    (payload: Clipboard.PasteEventPayload) => {
      if (payload.type === 'text') applyPastedLink(payload.text);
    },
    [applyPastedLink],
  );

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
      if (index === 1) {
        openingDetailRef.current = false;
        if (section !== 'images' && section !== 'menu') {
          scheduleInputFocus();
        }
      }
      if (
        index === 0 &&
        section !== 'menu' &&
        !openingDetailRef.current &&
        !keyboardVisibleRef.current &&
        !inputFocusedRef.current
      ) {
        setSection('menu');
        setSelectedMode(null);
        setText('');
        setLinkPreview(null);
        setImages([]);
        inputFocusedRef.current = false;
      }
    },
    [onClose, scheduleInputFocus, section],
  );

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.22}
        pressBehavior="close"
      />
    ),
    [],
  );

  const renderBackButton = () => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back to Add places"
      onPress={returnToMenu}
      style={({ pressed }) => [
        styles.backButton,
        pressed && styles.backButtonPressed,
      ]}
    >
      <Ionicons name="arrow-back" size={25} color={COLOR.textPrimary} />
    </Pressable>
  );

  const renderSocialHeader = () => (
    <View>
      <View style={styles.detailHeader}>
        {renderBackButton()}
        <Text style={styles.detailTitle}>Social media</Text>
        <View style={styles.headerBalanceSpacer} />
      </View>
      <View style={styles.socialAutoHint}>
        <Ionicons name="sparkles-outline" size={16} color={COLOR.primary} />
        <Text style={styles.socialAutoHintText}>Atlas supports Reddit posts, TikTok, YouTube, Reels, and Facebook videos. </Text>
      </View>
    </View>
  );

  const renderSimpleHeader = (title: string) => (
    <View style={styles.detailHeader}>
      {renderBackButton()}
      <Text style={styles.detailTitle}>{title}</Text>
      <View style={styles.headerBalanceSpacer} />
    </View>
  );

  const renderInputOverlay = () => {
    if (section === 'menu' || section === 'images') return null;

    const isSocial = section === 'social';
    const isLinkSection = isSocial || section === 'links';
    const isText = section === 'text';
    const canSubmit = text.trim().length > 0;
    const placeholder = isSocial
      ? 'Paste a public social video link...'
      : section === 'links'
        ? 'Paste any web page URL...'
        : 'Paste notes, an itinerary, or a list...';
    const trimmedText = text.trim();
    const hasLinkInput = isLinkSection && trimmedText.length > 0;
    const hasMatchingPreview = Boolean(linkPreview && linkPreview.url === trimmedText);
    const showClipboardPrompt = isLinkSection && clipboardAvailable && !hasLinkInput;

    return (
      <View
        pointerEvents="box-none"
        style={[
          styles.footerOverlay,
          {
            bottom: keyboardVisible ? keyboardHeight + 12 : 0,
          },
        ]}
      >
        <View
          style={[
            styles.footer,
            {
              paddingBottom: keyboardVisible ? 0 : insets.bottom + 12,
            },
          ]}
        >
            {showClipboardPrompt ? (
              <Reanimated.View entering={FadeInDown.duration(180)} exiting={FadeOutUp.duration(150)}>
                <View style={styles.clipboardCard}>
                <View style={styles.clipboardCopy}>
                  <View style={styles.clipboardLabelRow}>
                    <Ionicons
                      name="copy-outline"
                      size={16}
                      color={COLOR.textSecondary}
                    />
                    <Text style={styles.clipboardLabel}>
                      Paste copied link?
                    </Text>
                  </View>
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={styles.clipboardValue}
                  >
                    A copied link is ready to import
                  </Text>
                </View>
                {Platform.OS === 'ios' && Clipboard.isPasteButtonAvailable ? (
                  <Clipboard.ClipboardPasteButton
                    acceptedContentTypes={['plain-text', 'url']}
                    backgroundColor={COLOR.primary}
                    foregroundColor="#FFFFFF"
                    cornerStyle="capsule"
                    displayMode="labelOnly"
                    onPress={handleNativePaste}
                    style={styles.nativePasteButton}
                  />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={pasteClipboardLink}
                    style={styles.pasteButton}
                  >
                    <Text style={styles.pasteButtonText}>Paste</Text>
                  </Pressable>
                )}
                </View>
              </Reanimated.View>
            ) : null}

            {hasLinkInput && previewPending && !hasMatchingPreview ? (
              <Reanimated.View entering={FadeInUp.duration(160)} exiting={FadeOutDown.duration(130)}>
                <LinkPreviewLoading />
              </Reanimated.View>
            ) : null}

            {isText ? (
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: webSearchEnabled }}
                onPress={() => setWebSearchEnabled((enabled) => !enabled)}
                style={[
                  styles.webSearchToggle,
                  webSearchEnabled && styles.webSearchToggleActive,
                ]}
              >
                <Ionicons
                  name="globe-outline"
                  size={17}
                  color={webSearchEnabled ? '#FFFFFF' : COLOR.textPrimary}
                />
                <Text
                  style={[
                    styles.webSearchToggleText,
                    webSearchEnabled && styles.webSearchToggleTextActive,
                  ]}
                >
                  Web search {webSearchEnabled ? 'on' : 'off'}
                </Text>
              </Pressable>
            ) : null}

            {hasMatchingPreview && linkPreview ? (
              <Reanimated.View entering={FadeInUp.duration(220)} exiting={FadeOutDown.duration(140)}>
                <LinkPreviewCard preview={linkPreview} />
              </Reanimated.View>
            ) : null}

            <View style={[styles.inputRow, isText && styles.inputRowMultiline]}>
              <Ionicons
                name="add"
                size={28}
                color={COLOR.textPrimary}
                style={styles.inputLeadingIcon}
              />
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={setText}
                placeholder={placeholder}
                placeholderTextColor={COLOR.textTertiary}
                multiline={isText}
                numberOfLines={isText ? 4 : undefined}
                scrollEnabled
                lineBreakModeIOS={isText ? 'wordWrapping' : 'tail'}
                lineBreakStrategyIOS={isText ? 'standard' : 'none'}
                autoCapitalize={isText ? 'sentences' : 'none'}
                autoCorrect={isText}
                keyboardType={
                  isSocial || section === 'links' ? 'url' : 'default'
                }
                returnKeyType={isText ? 'default' : 'go'}
                onSubmitEditing={isText ? undefined : handleSubmit}
                onFocus={() => {
                  inputFocusedRef.current = true;
                }}
                onBlur={() => {
                  inputFocusedRef.current = false;
                }}
                style={[
                  styles.input,
                  isText ? styles.inputMultiline : styles.inputSingleLine,
                ]}
                textAlignVertical={isText ? 'top' : 'center'}
              />
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Import places"
                style={[
                  styles.sendButton,
                  !canSubmit && styles.sendButtonDisabled,
                ]}
                onPress={handleSubmit}
                disabled={!canSubmit}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="arrow-forward"
                  size={21}
                  color={canSubmit ? '#FFFFFF' : '#D6EEE2'}
                />
              </TouchableOpacity>
            </View>
          </View>
      </View>
    );
  };

  const renderMenu = () => (
    <BottomSheetView style={styles.menuContent}>
      <View style={styles.menuToolbar}>
        <Text style={styles.menuTitle}>Add places</Text>
      </View>
      <View style={styles.menuGrid}>
        {[MENU_CARDS.slice(0, 2), MENU_CARDS.slice(2, 4)].map(
          (row, rowIndex) => (
            <View key={`menu-row-${rowIndex}`} style={styles.menuRow}>
              {row.map((card) => (
                <Pressable
                  key={card.key}
                  accessibilityRole="button"
                  onPress={() => openSection(card.key)}
                  style={({ pressed }) => [
                    styles.menuCard,
                    pressed && styles.menuCardPressed,
                  ]}
                >
                  <MenuCardIcon type={card.icon} />
                  <View style={styles.menuCardCopy}>
                    <Text style={styles.menuCardTitle}>{card.title}</Text>
                    <Text style={styles.menuCardSubtitle}>{card.subtitle}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ),
        )}
      </View>
    </BottomSheetView>
  );

  const renderImages = () => (
    <BottomSheetView style={styles.detailContent}>
      {renderSimpleHeader('Image recognition')}
      <View style={styles.imageSegmentedControl}>
        <SlidingSegmentedControl
          labels={['Read text', 'Identify location']}
          selectedIndex={imageMode === 'findTextPlaces' ? 0 : 1}
          width={278}
          onSelect={(index) =>
            selectImageMode(
              index === 0 ? 'findTextPlaces' : 'findImagePlaces',
            )
          }
        />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={pickImages}
        style={styles.imageDropZone}
      >
        {images.length === 0 ? (
          <>
            <View style={styles.imageDropIcon}>
              <Ionicons name="add" size={40} color={COLOR.primary} />
            </View>
            <Text style={styles.imageDropTitle}>Choose photos</Text>
            <Text style={styles.imageDropSubtitle}>
              {imageMode === 'findTextPlaces'
                ? 'Select up to 3 screenshots'
                : 'Select one photo of a place'}
            </Text>
          </>
        ) : (
          <View style={styles.imagePreviewRow}>
            {images.map((image, index) => (
              <View
                key={`${image.uri}_${index}`}
                style={styles.imagePreviewWrap}
              >
                <Image
                  source={{ uri: image.uri }}
                  style={styles.imagePreview}
                />
                <TouchableOpacity
                  onPress={() => removeImage(index)}
                  style={styles.removeImageButton}
                  hitSlop={8}
                >
                  <Ionicons name="close-circle" size={24} color="#FF3B30" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </Pressable>

      <TouchableOpacity
        style={[
          styles.imageSubmitButton,
          images.length === 0 && styles.imageSubmitButtonDisabled,
        ]}
        onPress={handleSubmit}
        disabled={images.length === 0}
        activeOpacity={0.8}
      >
        <Text style={styles.imageSubmitButtonText}>
          {imageMode === 'findTextPlaces' ? 'Extract places' : 'Identify place'}
        </Text>
      </TouchableOpacity>
    </BottomSheetView>
  );

  const renderDetail = () => {
    if (section === 'social') {
      return (
        <BottomSheetView style={styles.detailContent}>
          {renderSocialHeader()}
        </BottomSheetView>
      );
    }
    if (section === 'images') return renderImages();
    if (section === 'text') {
      return (
        <BottomSheetView style={styles.detailContent}>
          {renderSimpleHeader('Paste text')}
        </BottomSheetView>
      );
    }
    return (
      <BottomSheetView style={styles.detailContent}>
        {renderSimpleHeader('Any other links')}
      </BottomSheetView>
    );
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <BottomSheet
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        detached={false}
        bottomInset={0}
        enableDynamicSizing={false}
        onChange={handleSheetChange}
        enablePanDownToClose
        enableOverDrag={false}
        keyboardBehavior="extend"
        keyboardBlurBehavior="none"
        enableBlurKeyboardOnGesture={false}
        android_keyboardInputMode="adjustPan"
        backdropComponent={renderBackdrop}
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.sheetBackground}
      >
        {section === 'menu' ? renderMenu() : renderDetail()}
      </BottomSheet>
      {renderInputOverlay()}
    </View>
  );
}

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: COLOR.bg,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
  },
  handleIndicator: {
    backgroundColor: COLOR.grabber,
    width: 36,
    height: 5,
    borderRadius: 100,
  },
  menuContent: {
    paddingTop: 0,
  },
  menuToolbar: {
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuTitle: {
    ...typography.h3,
    color: COLOR.textPrimary,
    letterSpacing: -0.17,
  },
  menuGrid: {
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 4,
  },
  menuRow: {
    flexDirection: 'row',
    gap: 10,
  },
  menuCard: {
    flex: 1,
    height: 146,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 24,
    borderCurve: 'continuous',
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(60,60,67,0.08)',
    justifyContent: 'space-between',
    boxShadow: '0 8px 26px rgba(0,0,0,0.07)',
  },
  menuCardPressed: {
    backgroundColor: '#F7F7F7',
    transform: [{ scale: 0.985 }],
  },
  menuCardCopy: {
    gap: 3,
  },
  menuCardTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
    color: COLOR.textPrimary,
    letterSpacing: -0.25,
  },
  menuCardSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
    color: COLOR.textSecondary,
  },
  menuIconBubble: {
    width: 46,
    height: 46,
    borderRadius: 15,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageMenuIconBubble: {
    backgroundColor: '#E7F4FF',
  },
  textMenuIconBubble: {
    backgroundColor: '#FFF3D6',
  },
  linkMenuIconBubble: {
    backgroundColor: '#E8F9EF',
  },
  socialIconGroup: {
    width: 102,
    height: 66,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
    gap: 4,
  },
  brandIconBubble: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  redditIconBubble: {
    backgroundColor: '#FFF0EA',
  },
  youtubeIconBubble: {
    backgroundColor: '#FFF0F0',
  },
  tiktokIconBubble: {
    backgroundColor: '#F1F1F1',
  },
  instagramIconBubble: {
    backgroundColor: '#FFF0F7',
  },
  facebookIconBubble: {
    backgroundColor: '#EDF5FF',
  },
  linkPreviewInstagramFallback: {
    backgroundColor: '#FFF0F7',
  },
  linkPreviewFacebookFallback: {
    backgroundColor: '#EDF5FF',
  },
  detailContent: {
    flex: 1,
    paddingTop: 2,
  },
  detailHeader: {
    height: 66,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  socialAutoHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  socialAutoHintText: {
    flex: 1,
    color: COLOR.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2F2F2',
  },
  backButtonPressed: {
    backgroundColor: '#E8E8E8',
    transform: [{ scale: 0.96 }],
  },
  headerBalanceSpacer: {
    width: 48,
    height: 48,
  },
  detailTitle: {
    ...typography.h3,
    color: COLOR.textPrimary,
  },
  segmentedControl: {
    height: 44,
    padding: 2,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 22,
    backgroundColor: '#EEEEF0',
    overflow: 'hidden',
  },
  segmentIndicator: {
    position: 'absolute',
    left: 2,
    top: 2,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  },
  segmentButton: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  segmentText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: COLOR.textPrimary,
  },
  segmentTextInactive: {
    color: COLOR.textSecondary,
  },
  footer: {
    gap: 10,
    paddingHorizontal: 12,
  },
  footerOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
  },
  clipboardCard: {
    minHeight: 78,
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLOR.border,
    backgroundColor: 'rgba(250,250,250,0.94)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  clipboardCopy: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  clipboardLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  clipboardLabel: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
    color: COLOR.textSecondary,
  },
  clipboardValue: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '400',
    color: COLOR.textPrimary,
  },
  pasteButton: {
    minWidth: 64,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLOR.primary,
  },
  nativePasteButton: {
    width: 72,
    height: 40,
  },
  linkPreviewLoading: {
    minHeight: 76,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLOR.border,
    backgroundColor: 'rgba(255,255,255,0.98)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  previewLoadingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLOR.primary,
  },
  pasteButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  webSearchToggle: {
    alignSelf: 'flex-end',
    minHeight: 36,
    paddingHorizontal: 13,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLOR.surfaceSecondary,
  },
  webSearchToggleActive: {
    backgroundColor: COLOR.primary,
  },
  webSearchToggleText: {
    ...typography.bodySmallEmphasis,
    color: COLOR.textPrimary,
  },
  webSearchToggleTextActive: {
    color: '#FFFFFF',
  },
  linkPreviewCard: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 8,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLOR.border,
    backgroundColor: 'rgba(255,255,255,0.98)',
    boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
  },
  linkPreviewImage: {
    width: 92,
    height: 60,
    borderRadius: 5,
    backgroundColor: COLOR.surfaceSecondary,
  },
  linkPreviewFallback: {
    width: 60,
    height: 60,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F9EF',
  },
  linkPreviewYoutubeFallback: { backgroundColor: '#FFF0F0' },
  linkPreviewRedditFallback: { backgroundColor: '#FFF0EA' },
  linkPreviewCopy: { flex: 1, minWidth: 0, gap: 4, paddingRight: 4 },
  linkPreviewLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  linkPreviewLabel: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 16, fontWeight: '600', color: COLOR.textSecondary },
  linkPreviewTitle: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: COLOR.textPrimary },
  inputRow: {
    minHeight: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: COLOR.primary,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 15,
    paddingRight: 8,
    boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
  },
  inputRowMultiline: {
    minHeight: 116,
    borderRadius: 26,
    alignItems: 'flex-end',
    paddingBottom: 8,
  },
  inputLeadingIcon: {
    marginRight: 7,
  },
  input: {
    flex: 1,
    paddingVertical: 0,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '400',
    color: COLOR.textPrimary,
  },
  inputSingleLine: {
    height: 54,
    maxHeight: 54,
    overflow: 'hidden',
  },
  inputMultiline: {
    height: 104,
    paddingTop: 16,
    paddingBottom: 10,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLOR.primary,
  },
  sendButtonDisabled: {
    backgroundColor: COLOR.primaryLight,
  },
  imageSegmentedControl: {
    alignSelf: 'center',
    marginTop: 8,
  },
  imageDropZone: {
    flex: 1,
    minHeight: 280,
    marginHorizontal: 20,
    marginTop: 18,
    marginBottom: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(60,60,67,0.15)',
    borderRadius: 28,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  imageDropIcon: {
    width: 88,
    height: 88,
    borderRadius: 24,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLOR.primaryLight,
  },
  imageDropTitle: {
    ...typography.bodyEmphasis,
    color: COLOR.textPrimary,
  },
  imageDropSubtitle: {
    ...typography.bodySmall,
    color: COLOR.textSecondary,
  },
  imagePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  imagePreviewWrap: {
    position: 'relative',
  },
  imagePreview: {
    width: 92,
    height: 112,
    borderRadius: 16,
    borderCurve: 'continuous',
  },
  removeImageButton: {
    position: 'absolute',
    top: -9,
    right: -9,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  imageSubmitButton: {
    height: 54,
    marginHorizontal: 20,
    marginBottom: 18,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLOR.primary,
  },
  imageSubmitButtonDisabled: {
    backgroundColor: COLOR.surfaceSecondary,
  },
  imageSubmitButtonText: {
    ...typography.bodyEmphasis,
    color: COLOR.textPrimary,
  },
});
