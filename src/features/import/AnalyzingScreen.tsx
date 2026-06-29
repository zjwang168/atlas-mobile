import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { typography } from '../../theme/typography';

const COLOR = {
  textPrimary: '#1A1A1A',
  textSecondary: '#717171',
  bg: '#FFFFFF',
} as const;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type AnalyzingScreenProps = {
  url: string;
  /** Optional thumbnail for the link preview pill. */
  thumbnailUri?: string;
  onCancel: () => void;
};

/**
 * Processing state shown while a pasted link is being parsed.
 *
 * Background is a soft mint "mesh gradient" built from a few radial-gradient
 * blobs in SVG; their centers drift slowly so the color gently breathes.
 * The link preview pill sways left↔right to signal active work.
 */
export default function AnalyzingScreen({ url, thumbnailUri, onCancel }: AnalyzingScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();

  // Drift progress 0→1, looping — drives every blob's offset.
  const drift = useSharedValue(0);
  // Sway angle for the link pill, in degrees.
  const sway = useSharedValue(0);

  useEffect(() => {
    drift.value = withRepeat(withTiming(1, { duration: 7000, easing: Easing.inOut(Easing.sin) }), -1, true);
    sway.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [drift, sway]);

  // Three blobs drift on slightly different vectors.
  const blobA = useAnimatedProps(() => ({
    cx: W * 0.25 + drift.value * W * 0.18,
    cy: H * 0.32 + drift.value * H * 0.06,
  }));
  const blobB = useAnimatedProps(() => ({
    cx: W * 0.85 - drift.value * W * 0.2,
    cy: H * 0.45 + drift.value * H * 0.1,
  }));
  const blobC = useAnimatedProps(() => ({
    cx: W * 0.55 + drift.value * W * 0.1,
    cy: H * 0.8 - drift.value * H * 0.12,
  }));

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-4 + sway.value * 8}deg` }],
  }));

  return (
    <View style={styles.container}>
      {/* Mesh gradient background */}
      <Svg style={StyleSheet.absoluteFill} width={W} height={H}>
        <Defs>
          <RadialGradient id="blobA" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#9FE6BE" stopOpacity={0.9} />
            <Stop offset="100%" stopColor="#9FE6BE" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="blobB" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#C9F2DC" stopOpacity={0.95} />
            <Stop offset="100%" stopColor="#C9F2DC" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="blobC" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#D7F3E4" stopOpacity={0.95} />
            <Stop offset="100%" stopColor="#D7F3E4" stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <Rect x={0} y={0} width={W} height={H} fill="#EAF7EF" />
        <AnimatedCircle animatedProps={blobA} r={W * 0.7} fill="url(#blobA)" />
        <AnimatedCircle animatedProps={blobB} r={W * 0.8} fill="url(#blobB)" />
        <AnimatedCircle animatedProps={blobC} r={W * 0.75} fill="url(#blobC)" />
      </Svg>

      {/* Grabber + close */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.grabber} />
        <TouchableOpacity style={styles.closeButton} onPress={onCancel} activeOpacity={0.7}>
          <Ionicons name="close" size={20} color={COLOR.textPrimary} />
        </TouchableOpacity>
      </View>

      {/* Center content */}
      <View style={styles.center}>
        <Animated.View style={[styles.pill, pillStyle]}>
          <View style={styles.thumb}>
            {thumbnailUri ? (
              <Animated.Image source={{ uri: thumbnailUri }} style={styles.thumbImg} />
            ) : null}
            <View style={styles.linkBadge}>
              <Ionicons name="link" size={14} color="#FFFFFF" />
            </View>
          </View>
          <Text style={styles.pillUrl} numberOfLines={1}>
            {url}
          </Text>
        </Animated.View>

        <Text style={styles.title}>Analyzing your link...</Text>
        <Text style={styles.subtitle}>Please noted that location may be parsed incorrectly</Text>
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
    overflow: 'hidden',
  },
  topBar: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: 100,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  closeButton: {
    position: 'absolute',
    right: 20,
    bottom: 0,
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    maxWidth: '92%',
    backgroundColor: COLOR.bg,
    borderRadius: 24,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 22,
    marginBottom: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 4,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#E5E5EA',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  linkBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillUrl: {
    flexShrink: 1,
    ...typography.h3,
    color: COLOR.textPrimary,
  },

  title: {
    ...typography.display,
    color: COLOR.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 10,
    ...typography.body,
    color: COLOR.textSecondary,
    textAlign: 'center',
  },

  bottomBar: {
    alignItems: 'center',
  },
  cancelButton: {
    paddingHorizontal: 44,
    paddingVertical: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.75)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  cancelText: {
    ...typography.bodyEmphasis,
    color: COLOR.textPrimary,
  },
});
