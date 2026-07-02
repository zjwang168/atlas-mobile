import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Spring tuned to match the iOS system "press" feel — quick shrink, soft settle.
const SPRING = { mass: 0.5, damping: 12, stiffness: 260 } as const;

type PressableScaleProps = Omit<PressableProps, 'style'> & {
  /** Static container style. */
  style?: StyleProp<ViewStyle>;
  /** Scale at full press. 0.92 ≈ subtle, 0.88 ≈ stronger. */
  scaleTo?: number;
};

/**
 * A Pressable that springs down on press-in and back on release — the standard
 * 2026 way to give a React Native button a native iOS press feel. Works anywhere,
 * including inside animated bottom sheets and scroll views.
 */
export function PressableScale({
  style,
  scaleTo = 0.9,
  onPressIn,
  onPressOut,
  children,
  ...props
}: PressableScaleProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      {...props}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, SPRING);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, SPRING);
        onPressOut?.(e);
      }}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
