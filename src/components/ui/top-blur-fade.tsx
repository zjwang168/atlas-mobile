import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { easeGradient } from 'react-native-easing-gradient';

type TopBlurFadeProps = {
  /** Total height of the faded blur strip. */
  height?: number;
  /** expo-blur intensity (0–100). */
  intensity?: number;
  tint?: 'light' | 'dark' | 'default';
  /** Overall opacity — pass an Animated value to fade the blur in on scroll. */
  opacity?: number | Animated.AnimatedInterpolation<number>;
  /** White wash at the strong end (0–1), layered over the blur like the native
      tab bar's scroll edge. 0 disables it. */
  scrim?: number;
};

// Smooth (bezier-eased) alpha ramp: opaque at the top → transparent at the
// bottom. Mask uses the alpha, so the blur is full at the top and dissolves
// to nothing lower down — without a hard boundary.
const { colors, locations } = easeGradient({
  colorStops: {
    0: { color: 'black' },
    1: { color: 'transparent' },
  },
});

/**
 * A top-edge progressive blur — a real `BlurView` masked by an
 * `expo-linear-gradient` (CALayer-backed) so the blur is full at the top and
 * dissolves smoothly toward the bottom.
 *
 * NOTE: over a native Metal surface (e.g. the Mapbox map) the masked blur does
 * NOT actually blur — only the fade shows — because UIVisualEffectView can't
 * sample a Metal layer through an offscreen mask. Over normal RN content (a
 * ScrollView/FlatList) it blurs as intended.
 *
 * Place it above the content, with absolute positioning. Pass `opacity` (an
 * Animated value) to fade it in as content scrolls under it.
 */
function TopBlurFade({
  height = 130,
  intensity = 90,
  tint = 'light',
  opacity = 1,
  scrim = 0.5,
}: TopBlurFadeProps) {
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, height, opacity }}
    >
      <MaskedView
        style={StyleSheet.absoluteFill}
        maskElement={
          <LinearGradient
            colors={colors as [string, string, ...string[]]}
            locations={locations as [number, number, ...number[]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        }
      >
        <BlurView intensity={intensity} tint={tint} style={StyleSheet.absoluteFill} />
        {/* White wash over the blur — strongest at the top edge, like the native
            tab bar's scroll-edge effect. */}
        {scrim > 0 && (
          <LinearGradient
            colors={[`rgba(255,255,255,${scrim})`, 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}
      </MaskedView>
    </Animated.View>
  );
}

export default memo(TopBlurFade);
