import Ionicons from "@expo/vector-icons/Ionicons";
import { NotePencilIcon } from "phosphor-react-native/src/icons/NotePencil";
import { useMemo } from "react";
import { Image, TouchableOpacity, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Reanimated, {
  type SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated";
import { useAppDialog } from "@/components/feedback/AppDialog";
import { Text } from "@/components/ui/text";
import VoiceInputButton from "@/components/voice-input/VoiceInputButton";
import { atlasBuilderColor } from "./tokens";
import type { DraftPlace } from "./types";

/** Fixed at the right edge behind the row — doesn't translate with the
    swipe. Scale and fade track swipe progress directly, matching
    PlaceCard.tsx's DeleteAction. */
function AtlasItemDeleteAction({
  progress,
  onDelete,
}: {
  progress: SharedValue<number>;
  onDelete: () => void;
}) {
  const style = useAnimatedStyle(() => {
    const amount = Math.min(progress.value, 1);
    return { opacity: amount, transform: [{ scale: amount }] };
  });
  return (
    <Reanimated.View
      className="w-[63px] items-center justify-center"
      style={style}
    >
      <TouchableOpacity
        accessibilityLabel="Delete place"
        onPress={onDelete}
        className="h-full w-[63px] items-center justify-center bg-error"
      >
        <Ionicons
          name="trash-outline"
          size={17}
          color={atlasBuilderColor.textInverse}
        />
      </TouchableOpacity>
    </Reanimated.View>
  );
}

export function AtlasItem({
  item,
  index,
  onFocus,
  onRemove,
  onMove,
  onNote,
}: {
  item: DraftPlace;
  index: number;
  onFocus: () => void;
  onRemove: () => void;
  onMove: (index: number, delta: number) => void;
  onNote: (note: string) => void;
}) {
  const { show: showDialog } = useAppDialog();
  const reorderGesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(180)
        .runOnJS(true)
        .onEnd((event) => {
          if (event.translationY > 28) onMove(index, 1);
          if (event.translationY < -28) onMove(index, -1);
        }),
    [index, onMove],
  );
  return (
    <View className="mb-px overflow-hidden rounded-[20px]">
      <ReanimatedSwipeable
        friction={2}
        rightThreshold={29}
        overshootRight
        overshootFriction={2}
        animationOptions={{
          mass: 1,
          damping: 14,
          stiffness: 90,
          overshootClamping: false,
        }}
        renderRightActions={(progress) => (
          <AtlasItemDeleteAction progress={progress} onDelete={onRemove} />
        )}
      >
        <View className="min-h-[76px] flex-row items-center gap-[9px] rounded-[20px] border border-border bg-surface p-[9px]">
          <View className="h-7 w-7 items-center justify-center rounded-full bg-primary">
            <Text className="captionEmphasis text-text-inverse">
              {index + 1}
            </Text>
          </View>
          {item.photo_url ? (
            <Image
              source={{ uri: item.photo_url }}
              className="h-[50px] w-[50px] rounded-xl bg-muted"
            />
          ) : (
            <View className="h-[50px] w-[50px] items-center justify-center rounded-xl bg-muted">
              <Text className="h3 text-text-secondary">
                {item.name.slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          <TouchableOpacity onPress={onFocus} className="min-w-0 flex-1">
            <Text
              numberOfLines={1}
              className="bodySmallEmphasis text-text-primary"
            >
              {item.name}
            </Text>
            <Text
              numberOfLines={1}
              className="caption mt-0.5 text-text-secondary"
            >
              {item.subtitle}
            </Text>
            {item.note ? (
              <Text
                numberOfLines={2}
                className="caption mt-[5px] border-l-2 border-border-strong pl-2 font-medium text-text-secondary"
              >
                {item.note}
              </Text>
            ) : null}
          </TouchableOpacity>
          <VoiceInputButton
            icon={NotePencilIcon}
            showVoiceBadge
            style={{
              width: 40,
              height: 30,
              borderRadius: 15,
              backgroundColor: atlasBuilderColor.backgroundSecondary,
            }}
            onShortPress={() =>
              showDialog({
                title: "Note",
                input: {
                  placeholder: "Add a note",
                  initialValue: item.note ?? "",
                  hint: "Tip: press and hold the voice button to add it by voice.",
                },
                actions: [
                  { label: "Cancel" },
                  { label: "Save", variant: "primary", onPress: onNote },
                ],
              })
            }
            onTranscript={(text) =>
              onNote(item.note ? `${item.note} ${text}` : text)
            }
          />
          <GestureDetector gesture={reorderGesture}>
            <View className="h-9 w-7 items-center justify-center">
              <Ionicons
                name="reorder-three-outline"
                size={23}
                color={atlasBuilderColor.textSecondary}
              />
            </View>
          </GestureDetector>
        </View>
      </ReanimatedSwipeable>
    </View>
  );
}
