import Ionicons from "@expo/vector-icons/Ionicons";
import { memo, useCallback, useEffect, useMemo } from "react";
import { Image, ScrollView, TouchableOpacity, View } from "react-native";
import Reanimated, {
  scrollTo,
  useAnimatedRef,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import { atlasBuilderColor } from "./tokens";
import type { FocusArea } from "./types";

const AUTO_SCROLL_PIXELS_PER_MS = 0.012;

const FocusAreaRow = memo(function FocusAreaRow({
  area,
  disabled,
  onPress,
}: {
  area: FocusArea;
  disabled?: boolean;
  onPress: (area: FocusArea) => void;
}) {
  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={() => onPress(area)}
      accessibilityRole="button"
      accessibilityLabel={`Plan ${area.label}, ${area.count} saved place${area.count === 1 ? "" : "s"}`}
      accessibilityHint="Opens this saved area on the map"
      className="min-h-[76px] flex-row items-center gap-[11px] rounded-[20px] border border-border bg-surface p-[9px]"
    >
      {/* Cover thumbnail sized and rounded to match AtlasItem.tsx's row
          treatment, itself echoing AtlasCard.tsx's cover-image styling. */}
      <View className="h-14 w-14 overflow-hidden rounded-2xl bg-muted">
        {area.photoUrl ? (
          <Image
            source={{ uri: area.photoUrl }}
            accessible={false}
            className="h-full w-full"
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Ionicons
              name="image-outline"
              size={19}
              color={atlasBuilderColor.textSecondary}
            />
          </View>
        )}
      </View>
      <View className="min-w-0 flex-1">
        <Text
          numberOfLines={1}
          className="bodySmallEmphasis text-text-primary"
        >
          Plan {area.label}
        </Text>
        <Text numberOfLines={1} className="caption mt-0.5 text-text-secondary">
          {area.count} saved place{area.count === 1 ? "" : "s"}
        </Text>
      </View>
      <Ionicons
        name="arrow-forward"
        size={17}
        color={atlasBuilderColor.textSecondary}
      />
    </TouchableOpacity>
  );
});

export function FocusAreas({
  areas,
  onFocus,
  disabled,
  autoScroll = true,
}: {
  areas: FocusArea[];
  onFocus: (area: FocusArea) => void;
  disabled?: boolean;
  autoScroll?: boolean;
}) {
  const scrollRef = useAnimatedRef<ScrollView>();
  const autoScrollEnabled = useSharedValue(autoScroll);
  const contentHeight = useSharedValue(0);
  const viewportHeight = useSharedValue(0);
  const offset = useSharedValue(0);
  const stopped = useSharedValue(false);
  const loopAreas = useMemo(
    () => (areas.length > 1 ? [...areas, ...areas] : areas),
    [areas],
  );

  const stopAutoScroll = useCallback(() => {
    stopped.value = true;
  }, []);

  useEffect(() => {
    autoScrollEnabled.value = autoScroll;
    stopped.value = !autoScroll;
    offset.value = 0;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [areas, autoScroll, autoScrollEnabled, offset, scrollRef, stopped]);

  useFrameCallback((frameInfo) => {
    "worklet";
    if (!autoScrollEnabled.value || stopped.value) return;

    const cycleHeight =
      areas.length > 1
        ? contentHeight.value / 2
        : contentHeight.value - viewportHeight.value;
    if (cycleHeight <= 8) return;

    const elapsed = frameInfo.timeSincePreviousFrame ?? 16.67;
    const nextOffset = offset.value + elapsed * AUTO_SCROLL_PIXELS_PER_MS;
    offset.value = nextOffset >= cycleHeight ? 0 : nextOffset;
    scrollTo(scrollRef, 0, offset.value, false);
  });

  return (
    <Reanimated.ScrollView
      ref={scrollRef}
      className="flex-1"
      contentContainerClassName="pb-4"
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
      scrollEventThrottle={16}
      onLayout={(event) => {
        viewportHeight.value = event.nativeEvent.layout.height;
      }}
      onContentSizeChange={(_, height) => {
        contentHeight.value = height;
      }}
      onTouchStart={stopAutoScroll}
      onScrollBeginDrag={stopAutoScroll}
    >
      {loopAreas.map((area, index) => (
        <View
          key={`${area.label}-${index}`}
          className={index === loopAreas.length - 1 ? undefined : "mb-2"}
        >
          <FocusAreaRow area={area} disabled={disabled} onPress={onFocus} />
        </View>
      ))}
    </Reanimated.ScrollView>
  );
}
