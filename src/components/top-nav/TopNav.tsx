import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import { BlurView } from 'expo-blur';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { memo, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mockUser } from '../../../mock-data/mockUser';
import LeftNav from './left-nav/LeftNav';

export type TopMode = 'saved' | 'discover';

const SEGMENT_WIDTH = 80;
const SEGMENT_CONTROL_WIDTH = SEGMENT_WIDTH * 2 + 4;
const LIQUID_GLASS_AVAILABLE =
  isGlassEffectAPIAvailable() && isLiquidGlassAvailable();

type TopNavProps = {
  onNavigatePress?: () => void;
  isCenteredOnUser?: boolean;
  onAvatarPress?: () => void;
  topMode?: TopMode;
  onTopModeChange?: (mode: TopMode) => void;
  showTopMode?: boolean;
};

type TopModeSwitchProps = {
  value: TopMode;
  onChange: (mode: TopMode) => void;
};

function TopModeSwitch({ value, onChange }: TopModeSwitchProps) {
  const reducedMotion = useReducedMotion();
  const selectorX = useSharedValue(value === 'saved' ? 0 : SEGMENT_WIDTH);

  useEffect(() => {
    const next = value === 'saved' ? 0 : SEGMENT_WIDTH;
    selectorX.value = reducedMotion
      ? next
      : withSpring(next, { damping: 20, stiffness: 240, mass: 0.72 });
  }, [reducedMotion, selectorX, value]);

  const selectorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: selectorX.value }],
  }));

  return (
    <View style={styles.segmentShadow}>
      <View style={styles.segmentControl}>
        <BlurView
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          tint="systemUltraThinMaterialLight"
          intensity={80}
        />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: 100, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.45)' },
          ]}
        />
        <Animated.View pointerEvents="none" style={[styles.segmentSelector, selectorStyle]} />
        <SegmentButton
          active={value === 'saved'}
          label="Saved"
          onPress={() => onChange('saved')}
        />
        <SegmentButton
          active={value === 'discover'}
          label="Discover"
          onPress={() => onChange('discover')}
        />
      </View>
    </View>
  );
}

function SegmentButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.segmentButton, pressed && styles.segmentPressed]}
    >
      <Text
        style={[
          typography.subheader,
          styles.segmentLabel,
          { color: active ? '#1A1A1A' : '#1A1A1A' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function TopNav({
  onNavigatePress,
  isCenteredOnUser = true,
  onAvatarPress,
  topMode = 'saved',
  onTopModeChange,
  showTopMode = true,
}: TopNavProps) {
  const { top } = useSafeAreaInsets();

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        pointerEvents="box-none"
        style={[styles.topRow, { paddingTop: top }]}
      >
        <LeftNav
          onNavigatePress={onNavigatePress}
          isCenteredOnUser={isCenteredOnUser}
        />
        {showTopMode && onTopModeChange ? (
          <View style={[styles.modeHost, { top: top }]}>
            <TopModeSwitch value={topMode} onChange={onTopModeChange} />
          </View>
        ) : null}
        {showTopMode ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Open profile"
            onPress={onAvatarPress}
            scaleTo={0.94}
            style={styles.avatarShadow}
          >
            <Avatar alt={mockUser.avatarFallback} style={styles.avatar}>
              <AvatarImage source={{ uri: mockUser.avatarUri }} />
              <AvatarFallback>
                <Text style={typography.captionEmphasis}>{mockUser.avatarFallback}</Text>
              </AvatarFallback>
            </Avatar>
          </PressableScale>
        ) : (
          <View style={styles.avatarSpacer} />
        )}
      </View>
    </View>
  );
}

export default memo(TopNav);

const styles = StyleSheet.create({
  topRow: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  modeHost: {
    position: 'absolute',
    left: '50%',
    transform: [{ translateX: -SEGMENT_CONTROL_WIDTH / 2 }],
  },
  segmentShadow: {
    width: SEGMENT_CONTROL_WIDTH,
    height: 44,
    borderRadius: 100,
    boxShadow: '0 8px 40px rgba(0,0,0,0.12)',
  },
  segmentControl: {
    width: SEGMENT_CONTROL_WIDTH,
    height: 44,
    padding: 2,
    borderRadius: 100,
    borderCurve: 'continuous',
    overflow: 'hidden',
    flexDirection: 'row',
    backgroundColor: 'transparent',
  },
  segmentSelector: {
    position: 'absolute',
    top: 2,
    left: 2,
    width: SEGMENT_WIDTH,
    height: 40,
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.7)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  segmentButton: {
    width: SEGMENT_WIDTH,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 20,
    borderCurve: 'continuous',
  },
  segmentPressed: {
    opacity: 0.68,
  },
  segmentLabel: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    letterSpacing: -0.15,
  },
  avatarShadow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
  },
  avatar: {
    width: 44,
    height: 44,
  },
  avatarSpacer: {
    width: 44,
    height: 44,
  },
});
