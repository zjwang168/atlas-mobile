import { elevation } from '@/theme/elevation';
import { BlurView } from 'expo-blur';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { Pressable, StyleSheet, View } from 'react-native';

const LIQUID_GLASS_AVAILABLE = isGlassEffectAPIAvailable() && isLiquidGlassAvailable();

type GlassCircleButtonProps = {
  accessibilityLabel: string;
  onPress: () => void;
  /** Diameter. Default 48 — the size the map controls use. */
  size?: number;
  children: React.ReactNode;
};

/**
 * The round translucent control used over the map — liquid glass where the OS
 * supports it, a blur underneath where it doesn't. Sized by its `size` prop
 * rather than by padding, so a caller can line several up on one row.
 */
export function GlassCircleButton({
  accessibilityLabel,
  onPress,
  size = 48,
  children,
}: GlassCircleButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      // Shadow on the outer view, clipping on the inner one: `overflow: hidden`
      // sets clipsToBounds, which would otherwise cut the shadow off too.
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2 },
        styles.shadow,
        pressed && styles.pressed,
      ]}
    >
      <View style={[{ borderRadius: size / 2 }, styles.clip]}>
        {LIQUID_GLASS_AVAILABLE ? (
          <GlassView
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            glassEffectStyle="regular"
            tintColor="rgba(255,255,255,0.1)"
          />
        ) : (
          <BlurView pointerEvents="none" style={StyleSheet.absoluteFill} intensity={40} tint="light" />
        )}
        {children}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shadow: { ...elevation.floatingButton },
  pressed: { opacity: 0.7 },
  clip: {
    flex: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
