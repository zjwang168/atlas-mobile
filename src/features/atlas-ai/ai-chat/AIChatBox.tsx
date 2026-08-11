import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { BlurView } from 'expo-blur';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import type { Icon } from 'phosphor-react-native';
import { ArrowUpIcon } from 'phosphor-react-native/src/icons/ArrowUp';
import { ClockIcon } from 'phosphor-react-native/src/icons/Clock';
import { CopyIcon } from 'phosphor-react-native/src/icons/Copy';
import { DotsThreeIcon } from 'phosphor-react-native/src/icons/DotsThree';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { PencilSimpleLineIcon } from 'phosphor-react-native/src/icons/PencilSimpleLine';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { ShareIcon } from 'phosphor-react-native/src/icons/Share';
import { ThumbsDownIcon } from 'phosphor-react-native/src/icons/ThumbsDown';
import { ThumbsUpIcon } from 'phosphor-react-native/src/icons/ThumbsUp';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  LinearTransition,
  SlideInDown,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import VoiceInputButton from '@/components/voice-input/VoiceInputButton';
import { useAppDialog } from '@/components/feedback/AppDialog';
import TopBlurFade from '@/components/ui/top-blur-fade';
import { chatWithAtlasStream, createChatSession, fetchConversation } from '@/services/api/apiService';
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

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
};

type MessageFeedback = 'up' | 'down';

function stripActionMarkers(text: string): string {
  return text
    .replace(/\[\[PLACE_ACTION_CARD:[\s\S]*?\]\]/g, '')
    .replace(/\[\[CONFIRM_ADD_PLACES:[\s\S]*?\]\]/g, '')
    .trim();
}

function FadingStreamToken({ token, reducedMotion }: { token: string; reducedMotion: boolean }) {
  const progress = useRef(new NativeAnimated.Value(reducedMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reducedMotion) return;
    progress.setValue(0);
    const animation = NativeAnimated.timing(progress, {
      toValue: 1,
      duration: 360,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion]);

  return (
    <NativeAnimated.Text style={[styles.streamingToken, { opacity: progress }]}>
      {token}
    </NativeAnimated.Text>
  );
}

function ThinkingIndicator({ reducedMotion }: { reducedMotion: boolean }) {
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
      <Text style={styles.thinkingText}>thinking {elapsedSeconds}s</Text>
    </View>
  );
}

function StreamingAssistantText({ text, reducedMotion }: { text: string; reducedMotion: boolean }) {
  const displayTokens = Array.from(text);

  return (
    <View style={styles.streamingResponseText}>
      {displayTokens.map((token, index) => (
        token === '\n' ? (
          <View key={`${index}:line-break`} style={styles.streamingLineBreak} />
        ) : (
          <FadingStreamToken
            key={`${index}:${token}`}
            token={token}
            reducedMotion={reducedMotion}
          />
        )
      ))}
    </View>
  );
}


function buildWelcomeMessage(places: ParsedPlace[], title?: string): string {
  if (places.length === 0) {
    return [
      '### Atlas AI',
      '',
      'I am ready to help you compare neighborhoods, reason through places, or turn a rough idea into a plan.',
      '',
      '### Next step',
      '',
      'Ask me what you want to compare, where the strongest options are, or what is missing.',
    ].join('\n');
  }

  const highlightNames = places.slice(0, 3).map((place) => `**${place.name}**`).join(', ');
  const moreCount = places.length > 3 ? ` and ${places.length - 3} more` : '';
  const sourceLabel = title ? `from **${title}**` : 'from this saved set';
  const regionLine = places[0]?.subtitle ? `The first place I see is **${places[0].subtitle}**.` : '';

  return [
    '### What I found',
    '',
    `I pulled together **${places.length} place${places.length > 1 ? 's' : ''}** ${sourceLabel}.`,
    highlightNames ? `A few anchors are ${highlightNames}${moreCount}.` : '',
    regionLine,
    '',
    '### Next step',
    '',
    'Ask me to compare them, group them by area, or help turn them into a plan.',
  ]
    .filter(Boolean)
    .join('\n');
}

type AIChatBoxProps = {
  places: ParsedPlace[];
  onClose: () => void;
  onOpenHistory?: () => void;
  onNewChat?: () => void;
  title?: string;
  visible?: boolean;
  conversationId?: string | null;
  showLanding?: boolean;
};

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
  onNewChat,
  title,
  visible = true,
  conversationId = null,
  showLanding = false,
}: AIChatBoxProps) {
  const { show: showDialog } = useAppDialog();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: buildWelcomeMessage(places, title),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [inputContentHeight, setInputContentHeight] = useState(21);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [messageFeedback, setMessageFeedback] = useState<
    Record<string, MessageFeedback | undefined>
  >({});
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const hydratedConversationIdRef = useRef<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const lastWelcomeKeyRef = useRef<string>('');
  const streamQueueRef = useRef<string[]>([]);
  const streamTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const streamCompletionRef = useRef<(() => void) | null>(null);
  const streamedTextRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);

  const scrollToLatest = () => {
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      flatListRef.current?.scrollToEnd({ animated: false });
    });
  };

  const finishDisplayedStream = () => {
    const messageId = streamingMessageIdRef.current;
    if (messageId) {
      setMessages((current) => current.map((message) => (
        message.id === messageId ? { ...message, streaming: false } : message
      )));
    }
    streamCompletionRef.current = null;
    streamingMessageIdRef.current = null;
    setPending(false);
  };

  const flushStreamQueue = () => {
    const messageId = streamingMessageIdRef.current;
    const nextTokens = streamQueueRef.current.splice(0, reducedMotion ? streamQueueRef.current.length : 8).join('');
    if (messageId && nextTokens) {
      setMessages((current) => current.map((message) => (
        message.id === messageId ? { ...message, text: `${message.text}${nextTokens}` } : message
      )));
      scrollToLatest();
      return;
    }

    if (streamTimerRef.current) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
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

  const completeStreamAfterDisplay = () => {
    streamCompletionRef.current = finishDisplayedStream;
    if (!streamTimerRef.current && streamQueueRef.current.length === 0) {
      finishDisplayedStream();
    }
  };

  useEffect(() => () => {
    if (streamTimerRef.current) clearInterval(streamTimerRef.current);
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
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
    });
    setSessionId(created.session_id);
    return created.session_id;
  };

  useEffect(() => {
    const welcomeKey = `${conversationId ?? 'new'}|${title ?? ''}|${places
      .map((place) => `${place.id}:${place.name}:${place.latitude.toFixed(5)}:${place.longitude.toFixed(5)}`)
      .join('|')}`;

    if (!conversationId && lastWelcomeKeyRef.current !== welcomeKey) {
      lastWelcomeKeyRef.current = welcomeKey;
      setSessionId(null);
      setPending(false);
      setInputText('');
      setMessages([
        {
          id: `welcome_${welcomeKey}`,
          role: 'assistant',
          text: buildWelcomeMessage(places, title),
        },
      ]);
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
          .map((message, index) => ({
            id: `${message.role}_${index}_${Date.now()}`,
            role: message.role === 'user' ? 'user' : 'assistant',
            text: message.content,
          }));

        const sessionPlaces = detail.session.locations ?? [];
        const hasOpeningAssistant = restoredMessages[0]?.role === 'assistant';
        const openingMessage =
          hasOpeningAssistant
            ? null
            : {
                id: `opening_${conversationId}`,
                role: 'assistant' as const,
                text: buildWelcomeMessage(
                  sessionPlaces.map((place) => ({
                    id: `${place.name}_${place.latitude}_${place.longitude}`,
                    name: place.name,
                    subtitle: place.full_address || place.description || '',
                    type: place.category || 'Place',
                    latitude: place.latitude,
                    longitude: place.longitude,
                  })),
                  detail.session.title || title,
                ),
              };

        setSessionId(session.session_id);
        activeConversationIdRef.current = detail.session.conversation_id || conversationId;
        setMessages(openingMessage ? [openingMessage, ...restoredMessages] : restoredMessages);
        hydratedConversationIdRef.current = conversationId;
      } catch (error) {
        console.warn('[AIChatBox] hydrateFromConversation failed:', error);
      }
    };

    hydrateFromConversation();

    return () => {
      cancelled = true;
    };
  }, [conversationId, places, title]);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || pending) return;

    const assistantMessageId = `ai_${Date.now()}`;
    streamQueueRef.current = [];
    streamedTextRef.current = false;
    streamingMessageIdRef.current = assistantMessageId;

    setMessages((prev) => [
      ...prev,
      { id: `user_${Date.now()}`, role: 'user', text },
      { id: assistantMessageId, role: 'assistant', text: '', streaming: true },
    ]);
    scrollToLatest();
    setInputText('');
    setPending(true);

    try {
      const currentSessionId = await ensureSession();
      await chatWithAtlasStream(
        currentSessionId,
        text,
        { onToken: enqueueStreamDelta },
        activeConversationIdRef.current,
      );
    } catch (error) {
      if (!streamedTextRef.current) {
        enqueueStreamDelta('I couldn\'t respond just now. Please try sending that again in a moment.');
      }
    } finally {
      completeStreamAfterDisplay();
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    const displayText = stripActionMarkers(item.text);
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
          <View style={styles.userBubble}>
            <Text style={[styles.messageText, styles.userText]}>
              {item.text}
            </Text>
          </View>
        ) : (
          <View style={styles.assistantContent}>
            <View style={styles.assistantMessageText}>
              {item.streaming && !displayText ? <ThinkingIndicator reducedMotion={reducedMotion} /> : null}
              {!item.streaming || displayText ? <Text style={styles.assistantLabel}>Atlas AI</Text> : null}
              {item.streaming && displayText ? (
                <StreamingAssistantText text={displayText} reducedMotion={reducedMotion} />
              ) : displayText ? (
                <Markdown style={markdownStyles}>{displayText}</Markdown>
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
          </View>
        )}
      </View>
    );
  };

  if (!visible) return null;

  const hasComposerText = inputText.length > 0;
  const landingVisible =
    showLanding && !messages.some((message) => message.role === 'user');
  const hasStartedChat = messages.some((message) => message.role === 'user');
  const headerTop = Math.max(insets.top, 56);
  const headerOverlayHeight = headerTop + 68;
  const composerHeight = hasComposerText
    ? Math.min(196, Math.max(120, inputContentHeight + 72))
    : 56;
  const composerEdgeGap = keyboardVisible ? 12 : 28;
  const composerBottom = keyboardHeight + composerEdgeGap;
  const composerOverlayHeight = composerHeight + composerBottom + 96;
  const headerMaterialHeight = headerOverlayHeight - 32;
  const composerMaterialHeight = composerHeight + composerEdgeGap + 6;
  const bottomMaterialOffset =
    landingVisible && keyboardVisible ? 0 : keyboardHeight;

  const sendButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Send message"
      onPress={handleSend}
      disabled={!inputText.trim() || pending}
      style={({ pressed }) => [
        styles.sendButton,
        pressed && inputText.trim() && !pending && styles.sendButtonPressed,
      ]}
    >
      {pending ? (
        <ActivityIndicator size="small" color="#FFFFFF" />
      ) : (
        <ArrowUpIcon size={20} weight="regular" color="#FFFFFF" />
      )}
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
                paddingBottom: composerOverlayHeight,
              },
            ]}
            contentInsetAdjustmentBehavior="never"
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={scrollToLatest}
            scrollIndicatorInsets={{
              top: headerOverlayHeight,
              bottom: composerHeight + composerBottom,
            }}
            showsVerticalScrollIndicator={false}
          />
        ) : null}

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
            <View
              style={[
                styles.headerActionGroupShadow,
                !hasStartedChat && styles.headerActionGroupShadowSingle,
              ]}
            >
              <View
                style={[
                  styles.headerActionGroup,
                  !hasStartedChat && styles.headerActionGroupSingle,
                ]}
              >
                {LIQUID_GLASS_AVAILABLE ? (
                  <GlassView
                    pointerEvents="none"
                    style={StyleSheet.absoluteFill}
                    glassEffectStyle="regular"
                    tintColor="rgba(255,255,255,0.35)"
                  />
                ) : (
                  <View pointerEvents="none" style={styles.glassButtonFallback} />
                )}
                {hasStartedChat ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Start a new chat"
                    onPress={onNewChat}
                    disabled={!onNewChat}
                    style={({ pressed }) => [
                      styles.headerActionButton,
                      pressed && styles.glassButtonPressed,
                      !onNewChat && styles.glassButtonDisabled,
                    ]}
                  >
                    <PencilSimpleLineIcon
                      size={24}
                      weight="regular"
                      color={COLOR.foreground}
                    />
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open chat history"
                  onPress={onOpenHistory}
                  disabled={!onOpenHistory}
                  style={({ pressed }) => [
                    styles.headerActionButton,
                    pressed && styles.glassButtonPressed,
                    !onOpenHistory && styles.glassButtonDisabled,
                  ]}
                >
                  <ClockIcon size={24} weight="regular" color={COLOR.foreground} />
                </Pressable>
              </View>
            </View>
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
                borderRadius: hasComposerText ? 24 : 32,
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

            <TextInput
              ref={inputRef}
              value={inputText}
              onChangeText={setInputText}
              onContentSizeChange={({ nativeEvent }) => {
                setInputContentHeight(Math.max(21, Math.ceil(nativeEvent.contentSize.height)));
              }}
              placeholder={voiceRecording ? 'Hold to speak' : 'Ask AtlasAI'}
              placeholderTextColor="#B0B0B0"
              style={[
                styles.composerInput,
                hasComposerText ? styles.composerInputExpanded : styles.composerInputCompact,
              ]}
              multiline
              textAlignVertical="top"
              scrollEnabled={composerHeight >= 196}
              editable={!pending}
            />

            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.composerLeadingAction}
            >
              <PlusIcon size={24} weight="regular" color={COLOR.foreground} />
            </View>

            <View style={styles.composerTrailingActions}>
              <VoiceInputButton
                disabled={pending}
                onRecordingChange={setVoiceRecording}
                onTranscript={(text) => setInputText((current) => current ? `${current} ${text}` : text)}
                style={styles.utilityButton}
              />

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
  streamingResponseText: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
  },
  streamingToken: {
    color: '#000000',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    letterSpacing: -0.16,
  },
  streamingLineBreak: {
    width: '100%',
    height: 0,
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
  messageText: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
    letterSpacing: -0.16,
  },
  userText: {
    color: '#000000',
  },
  composerWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 3,
  },
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
