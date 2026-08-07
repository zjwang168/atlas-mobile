import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import type { PlacesView } from '@/features/my-places/MyPlaces';
import { typography } from '@/theme/typography';
import { BlurView } from 'expo-blur';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { MapPinSimpleLineIcon } from 'phosphor-react-native/src/icons/MapPinSimpleLine';
import { NotebookIcon } from 'phosphor-react-native/src/icons/Notebook';
import { memo, useEffect } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mockUser } from '../../../mock-data/mockUser';
import LeftNav from './left-nav/LeftNav';
import RightNav from './right-nav/RightNav';

const SEGMENT_WIDTH = 92;
const SEGMENT_CONTROL_WIDTH = SEGMENT_WIDTH * 2 + 4;
const LIQUID_GLASS_AVAILABLE =
  isGlassEffectAPIAvailable() && isLiquidGlassAvailable();

type TopNavProps = {
  onSearchPress?: () => void;
  onGlobePress?: () => void;
  onNavigatePress?: () => void;
  onAvatarPress?: () => void;
  placesView?: PlacesView;
  onPlacesViewChange?: (view: PlacesView) => void;
  showPlacesMode?: boolean;
};

type PlacesModeSwitchProps = {
  value: PlacesView;
  onChange: (view: PlacesView) => void;
};

function PlacesModeSwitch({ value, onChange }: PlacesModeSwitchProps) {
  const reducedMotion = useReducedMotion();
  const selectorX = useSharedValue(value === 'allPlaces' ? 0 : SEGMENT_WIDTH);

  useEffect(() => {
    const next = value === 'allPlaces' ? 0 : SEGMENT_WIDTH;
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
        {LIQUID_GLASS_AVAILABLE ? (
          <GlassView
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            glassEffectStyle="clear"
            tintColor="rgba(255,255,255,0.7)"
          />
        ) : (
          <BlurView
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            tint="systemUltraThinMaterialLight"
            intensity={10}
          />
        )}
        <Animated.View pointerEvents="none" style={[styles.segmentSelector, selectorStyle]} />
        <SegmentButton
          active={value === 'allPlaces'}
          label="Places"
          icon="places"
          onPress={() => onChange('allPlaces')}
        />
        <SegmentButton
          active={value === 'atlas'}
          label="Atlas"
          icon="atlas"
          onPress={() => onChange('atlas')}
        />
      </View>
    </View>
  );
}

function SegmentButton({
  active,
  label,
  icon,
  onPress,
}: {
  active: boolean;
  label: string;
  icon: 'places' | 'atlas';
  onPress: () => void;
}) {
  const Icon = icon === 'places' ? MapPinSimpleLineIcon : NotebookIcon;
  const color = active ? (icon === 'places' ? '#12C170' : '#12C170') : '#717171';

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.segmentButton, pressed && styles.segmentPressed]}
    >
      <Icon size={18} weight={active ? 'fill' : 'regular'} color={color} />
      <Text
        style={[
          typography.subheader,
          styles.segmentLabel,
          { color: active ? '#1A1A1A' : '#717171' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function TopNav({
  onSearchPress,
  onGlobePress,
  onNavigatePress,
  onAvatarPress,
  placesView = 'allPlaces',
  onPlacesViewChange,
  showPlacesMode = true,
}: TopNavProps) {
  const { top } = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View
        pointerEvents="box-none"
        style={[styles.topRow, { paddingTop: top + 8 }]}
      >
        <LeftNav onSearchPress={onSearchPress} />
        {showPlacesMode && onPlacesViewChange ? (
          <View style={[styles.modeHost, { top: top + 8 }]}>
            <PlacesModeSwitch value={placesView} onChange={onPlacesViewChange} />
          </View>
        ) : null}
        {showPlacesMode ? (
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

      <View
        pointerEvents="box-none"
        style={[styles.mapControls, { top: Math.round(height * 0.326) }]}
      >
        <RightNav onGlobePress={onGlobePress} onNavigatePress={onNavigatePress} />
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
  mapControls: {
    position: 'absolute',
    right: 12,
  },
});
