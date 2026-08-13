import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import { Text } from "@/components/ui/text";
import Reanimated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

function TypewriterCharacter({
  character,
  index,
  progress,
}: {
  character: string;
  index: number;
  progress: { value: number };
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      progress.value,
      [index - 0.25, index + 0.55],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }));
  return (
    <Reanimated.View style={animatedStyle}>
      <Text className="captionEmphasis text-text-secondary">{character}</Text>
    </Reanimated.View>
  );
}

function TypewriterHint() {
  const characters = "Now, add your first pin.".split("");
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(
      withTiming(characters.length + 0.5, { duration: 2500 }),
      -1,
      false,
    );
  }, [characters.length, progress]);
  return (
    <View className="min-h-[18px] flex-row">
      {characters.map((character, index) => (
        <TypewriterCharacter
          key={`${character}-${index}`}
          character={character}
          index={index}
          progress={progress}
        />
      ))}
    </View>
  );
}

export function AtlasEmptySkeleton() {
  const pulse = useRef(new Animated.Value(0.58)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.8,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.58,
          duration: 1800,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <Animated.View
      className="flex-1 bg-bg px-[15px] pb-3.5 pt-3.5"
      style={{ opacity: pulse }}
    >
      <View className="gap-2 px-1 pb-[15px]">
        <View className="h-2 w-[76px] rounded bg-muted" />
        <View className="h-[15px] w-[58%] rounded-[7px] bg-border-strong" />
      </View>
      {[0, 1, 2].map((index) => (
        <View key={index} className="mb-2">
          <View className="mb-1 min-h-7 flex-row items-center justify-center gap-2">
            <View className="h-5 w-[74px] rounded-full bg-muted" />
            <View className="h-5 w-[92px] rounded-full bg-muted" />
          </View>
          <View className="min-h-[74px] flex-row items-center gap-[10px] rounded-[20px] bg-bg-secondary p-[10px]">
            <View className="h-[27px] w-[27px] rounded-full bg-border-strong" />
            <View className="h-[52px] w-[52px] rounded-xl bg-muted" />
            <View className="flex-1 gap-[9px]">
              {index === 0 ? (
                <>
                  <TypewriterHint />
                  <Text className="caption min-h-[18px] text-text-tertiary">
                    Tap a pin or search, then add it here.
                  </Text>
                </>
              ) : (
                <>
                  <View className="h-[11px] w-[78%] rounded-md bg-border-strong" />
                  <View className="h-[9px] w-[48%] rounded-md bg-muted" />
                </>
              )}
            </View>
            <View className="h-[34px] w-[25px] rounded-lg bg-muted" />
          </View>
          {index < 2 ? (
            <View className="h-4 w-0.5 self-center rounded-sm bg-muted" />
          ) : null}
        </View>
      ))}
    </Animated.View>
  );
}
