import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ParseProgressEvent } from '../../../services/api/apiService';
import { typography } from '../../../theme/typography';

const COLOR = {
  textPrimary: '#1A1A1A',
  textSecondary: '#717171',
  textTertiary: '#999',
  bg: '#FFFFFF',
  cardBg: 'rgba(255,255,255,0.78)',
} as const;

type AnalyzingScreenProps = {
  url: string;
  thumbnailUri?: string;
  progressEvents?: ParseProgressEvent[];
  notice?: string;
  onCancel: () => void;
};

type TokenInfo = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

type LiveStep = {
  key: string;
  label: string;
  detail: string;
  elapsed_s: number;
};

function LiveReasoningRow({ label, detail, elapsed_s }: { label: string; detail: string; elapsed_s: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(progress, {
      toValue: 1,
      useNativeDriver: true,
      friction: 10,
      tension: 90,
    }).start();
  }, [progress]);

  return (
    <Animated.View
      style={[
        styles.liveRow,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) },
          ],
        },
      ]}
    >
      <Text style={styles.liveStep}>
        {label} · {elapsed_s}s
      </Text>
      <Text style={styles.liveDetail}>{detail}</Text>
    </Animated.View>
  );
}

/**
 * Processing state with progress timeline, token usage, and ad slot placeholder.
 */
export default function AnalyzingScreen({
  url,
  thumbnailUri,
  progressEvents = [],
  notice,
  onCancel,
}: AnalyzingScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const [elapsed, setElapsed] = useState(0);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const shimmer = useRef(new Animated.Value(0)).current;

  // Timer
  useEffect(() => {
    const started = Date.now();
    const intervalId = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  // Poll performance endpoint for token usage
  useEffect(() => {
    const poll = async () => {
      try {
        const apiBase = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';
        const resp = await fetch(`${apiBase}/api/performance?limit=1`);
        const data = await resp.json();
        const latest = data?.metrics?.[0];
        if (latest?.llm_calls?.length > 0) {
          const totalInput = latest.llm_calls.reduce((s: number, c: any) => s + (c.input_tokens || 0), 0);
          const totalOutput = latest.llm_calls.reduce((s: number, c: any) => s + (c.output_tokens || 0), 0);
          setTokenInfo({
            input_tokens: totalInput,
            output_tokens: totalOutput,
            total_tokens: totalInput + totalOutput,
          });
        }
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, []);

  // Progress events
  const eventByKey = useMemo(() => {
    const map = new Map<string, ParseProgressEvent>();
    for (const event of progressEvents) map.set(event.key, event);
    return map;
  }, [progressEvents]);

  const sourceEvent = eventByKey.get('source_fetched');
  const entityEvent = eventByKey.get('entity_linking_done');
  const geocodeEvent = eventByKey.get('geocode_done');
  const finishedEvent = eventByKey.get('finished');

  const liveSteps: LiveStep[] = useMemo(() => {
    return progressEvents
      .filter((event) => event.key.startsWith('stream_'))
      .slice(-6)
      .map((event, index) => {
        const detailValue = event.data?.chunk ?? event.data?.detail ?? event.label;
        return {
          key: `${event.key}-${index}`,
          label: event.label,
          detail: String(detailValue),
          elapsed_s: event.elapsed_s,
        };
      });
  }, [progressEvents]);

  const timeline = [
    {
      key: 'source_fetched',
      label: 'Source prepared',
      event: sourceEvent,
      detail: sourceEvent?.data?.title
        ? String(sourceEvent.data.title).slice(0, 40)
        : 'Reading source content',
    },
    {
      key: 'entity_linking_done',
      label: 'Places identified',
      event: entityEvent,
      detail: entityEvent?.data?.location_count
        ? `${entityEvent.data.location_count} candidate places`
        : 'Finding named places',
    },
    {
      key: 'geocode_done',
      label: 'Coordinates resolved',
      event: geocodeEvent,
      detail: geocodeEvent?.data?.resolved_count
        ? `${geocodeEvent.data.resolved_count}/${geocodeEvent.data.query_count} coordinates resolved`
        : 'Matching places to map pins',
    },
    {
      key: 'finished',
      label: 'Ready',
      event: finishedEvent,
      detail: finishedEvent ? 'Opening results in 2s' : 'Building result screen',
    },
  ];

  return (
    <View style={styles.container}>
      {/* Close button */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.closeButton} onPress={onCancel} activeOpacity={0.7}>
          <Ionicons name="close" size={20} color={COLOR.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.center}>
        {/* URL pill */}
        <View style={styles.pill}>
          <View style={styles.thumb}>
            {thumbnailUri ? (
              <View style={styles.thumbImg}>
                <Ionicons name="link" size={16} color="#FFFFFF" />
              </View>
            ) : (
              <Ionicons name="link" size={16} color="#FFFFFF" />
            )}
          </View>
          <Text style={styles.pillUrl} numberOfLines={1}>
            {url}
          </Text>
        </View>

        {/* Progress card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.eyebrow}>Processing</Text>
              <Text style={styles.title}>Analyzing your link</Text>
            </View>
            <View style={styles.timerBadge}>
              <Text style={styles.timerText}>{elapsed}s</Text>
            </View>
          </View>
          <ScrollView
            style={styles.cardScroll}
            contentContainerStyle={styles.cardScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            {liveSteps.length > 0 && (
              <View style={styles.liveBox}>
                <View style={styles.liveHeader}>
                  <Text style={styles.liveLabel}>Live reasoning</Text>
                  <Animated.View
                    style={[
                      styles.livePulse,
                      {
                        opacity: shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
                        transform: [
                          {
                            translateX: shimmer.interpolate({ inputRange: [0, 1], outputRange: [0, 10] }),
                          },
                        ],
                      },
                    ]}
                  />
                </View>
                {liveSteps.map((step) => (
                  <LiveReasoningRow
                    key={step.key}
                    label={step.label}
                    detail={step.detail}
                    elapsed_s={step.elapsed_s}
                  />
                ))}
              </View>
            )}

            {/* Timeline */}
            <View style={styles.timeline}>
              {timeline.map((item) => {
                const done = Boolean(item.event);
                return (
                  <View key={item.key} style={styles.timelineRow}>
                    <View style={[styles.dot, done && styles.dotDone]}>
                      {done ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : null}
                    </View>
                    <View style={styles.timelineText}>
                      <Text style={[styles.timelineLabel, done && styles.timelineLabelDone]}>
                        {item.event?.label || item.label}
                        {item.event ? ` ${item.event.elapsed_s}s` : ''}
                      </Text>
                      <Text style={styles.timelineDetail}>{item.detail}</Text>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Token usage */}
            {tokenInfo && (
              <View style={styles.tokenRow}>
                <Ionicons name="flash-outline" size={13} color={COLOR.textTertiary} />
                <Text style={styles.tokenText}>
                  Tokens: {tokenInfo.total_tokens.toLocaleString()} (in: {tokenInfo.input_tokens.toLocaleString()}, out: {tokenInfo.output_tokens.toLocaleString()})
                </Text>
              </View>
            )}
          </ScrollView>
        </View>

        {/* Ad Slot */}
        <View style={styles.adSlot}>
          <View style={styles.adBadge}>
            <Text style={styles.adBadgeText}>Ad Slot</Text>
          </View>
          <View style={styles.adDivider} />
          <View style={styles.adContent}>
            <View style={styles.adPlaceholderBlock}>
              <View style={[styles.adBar, { width: '70%' }]} />
              <View style={[styles.adBar, { width: '45%' }]} />
            </View>
            <View style={styles.adIcon}>
              <Ionicons name="image-outline" size={20} color="#DDD" />
            </View>
          </View>
          <Text style={styles.adFootnote}>Support us by whitelisting ads</Text>
        </View>
      </View>

      {/* Cancel */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel} activeOpacity={0.8}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#F5F5F0',
    zIndex: 100,
  },
  notice: {
    marginTop: 10,
    marginBottom: 2,
    fontSize: 12,
    lineHeight: 18,
    color: COLOR.textSecondary,
  },
  liveBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(18, 193, 112, 0.08)',
  },
  liveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  liveLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: COLOR.textSecondary,
    textTransform: 'uppercase',
  },
  livePulse: {
    width: 18,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#12C170',
  },
  liveRow: {
    marginBottom: 10,
  },
  liveStep: {
    marginBottom: 2,
    fontSize: 13,
    fontWeight: '700',
    color: COLOR.textPrimary,
  },
  liveDetail: {
    fontSize: 13,
    lineHeight: 18,
    color: COLOR.textSecondary,
  },
  topBar: {
    alignItems: 'flex-end',
    paddingHorizontal: 20,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
  },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: '92%',
    backgroundColor: COLOR.bg,
    borderRadius: 24,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 18,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  thumb: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#C4C4C4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImg: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillUrl: {
    flexShrink: 1,
    ...typography.h3,
    color: COLOR.textPrimary,
  },

  card: {
    width: '100%',
    height: 290,
    borderRadius: 24,
    backgroundColor: COLOR.cardBg,
    padding: 20,
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 4,
  },
  cardScroll: {
    flex: 1,
  },
  cardScrollContent: {
    paddingBottom: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  eyebrow: {
    ...typography.subheader,
    color: '#999',
    marginBottom: 2,
  },
  title: {
    ...typography.display,
    color: COLOR.textPrimary,
    fontSize: 20,
  },
  timerBadge: {
    borderRadius: 999,
    backgroundColor: '#F0F0ED',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  timerText: {
    ...typography.bodyEmphasis,
    color: COLOR.textSecondary,
  },

  // Timeline
  timeline: {
    marginTop: 18,
    gap: 12,
  },
  timelineRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: {
    backgroundColor: '#12C170',
  },
  timelineText: {
    flex: 1,
  },
  timelineLabel: {
    ...typography.bodySmall,
    color: COLOR.textSecondary,
    fontWeight: '500',
  },
  timelineLabelDone: {
    color: COLOR.textPrimary,
    fontWeight: '600',
  },
  timelineDetail: {
    marginTop: 1,
    fontSize: 11,
    color: COLOR.textTertiary,
  },

  // Token usage
  tokenRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  tokenText: {
    fontSize: 11,
    color: COLOR.textTertiary,
    fontFamily: 'monospace',
  },

  // Ad Slot
  adSlot: {
    width: '100%',
    borderRadius: 20,
    backgroundColor: COLOR.cardBg,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  adBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: '#F0F0ED',
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 10,
  },
  adBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLOR.textTertiary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  adDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.06)',
    marginBottom: 14,
  },
  adContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  adPlaceholderBlock: {
    flex: 1,
    gap: 8,
  },
  adBar: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E8E8E4',
  },
  adIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F0F0ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adFootnote: {
    marginTop: 10,
    fontSize: 11,
    color: COLOR.textTertiary,
    textAlign: 'center',
  },

  bottomBar: {
    alignItems: 'center',
  },
  cancelButton: {
    paddingHorizontal: 44,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  cancelText: {
    ...typography.bodyEmphasis,
    color: COLOR.textSecondary,
  },
});
