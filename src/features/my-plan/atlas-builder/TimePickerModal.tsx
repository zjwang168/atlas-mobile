import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { PLANNING_HOURS } from "./constants";
import { atlasBuilderColor } from "./tokens";

export function TimePickerModal({
  visible,
  day,
  time,
  dayLocked,
  hasExisting,
  validationMessage,
  onChangeDay,
  onChangeTime,
  onClose,
  onRemove,
  onSave,
}: {
  visible: boolean;
  day: number | null;
  time: string;
  dayLocked: boolean;
  hasExisting: boolean;
  validationMessage?: string | null;
  onChangeDay: (day: number | null) => void;
  onChangeTime: (time: string) => void;
  onClose: () => void;
  onRemove: () => void;
  onSave: () => void;
}) {
  const dayOptions: Array<number | null> = [
    null,
    ...Array.from({ length: 14 }, (_, index) => index + 1),
  ];
  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
    >
      <Pressable onPress={onClose} className="flex-1 justify-end bg-black/30">
        <Pressable
          onPress={(event) => event.stopPropagation()}
          className="rounded-t-[24px] bg-surface pb-7"
        >
          <View className="min-h-16 flex-row items-center justify-between border-b border-border px-[18px]">
            <TouchableOpacity onPress={onClose}>
              <Text className="body text-text-secondary">Cancel</Text>
            </TouchableOpacity>
            <View>
              <Text className="bodySmallEmphasis text-center text-text-primary">
                Schedule time
              </Text>
              <Text className="caption mt-0.5 text-center text-text-secondary">
                Place it in your itinerary
              </Text>
            </View>
            <TouchableOpacity onPress={onSave}>
              <Text className="bodyEmphasis text-primary">Done</Text>
            </TouchableOpacity>
          </View>
          {validationMessage ? (
            <View
              pointerEvents="none"
              className={cn(
                "absolute left-[18px] right-[18px] top-[70px] z-10 min-h-[38px]",
                "flex-row items-center gap-[7px] rounded-2xl border border-warning",
                "bg-bg-secondary px-3 py-[9px]",
              )}
            >
              <Ionicons
                name="alert-circle-outline"
                size={16}
                color={atlasBuilderColor.warningText}
              />
              <Text
                numberOfLines={2}
                className="caption flex-1 font-semibold text-warning"
              >
                {validationMessage}
              </Text>
            </View>
          ) : null}
          <View className="h-[236px] flex-row px-[30px]">
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerClassName="grow py-[72px]"
            >
              {dayOptions.map((value) => (
                <TouchableOpacity
                  disabled={dayLocked && value !== null}
                  key={value ?? "flexible-day"}
                  onPress={() => onChangeDay(value)}
                  className={cn(
                    "min-h-10 items-center justify-center rounded-full",
                    day === value && "bg-primary-light",
                    dayLocked && value !== null && "opacity-30",
                  )}
                >
                  <Text
                    className={cn(
                      "body text-text-secondary",
                      day === value && "font-semibold text-primary",
                      dayLocked && value !== null && "text-text-tertiary",
                    )}
                  >
                    {value === null ? "Flexible day" : `Day ${value}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View className="my-[25px] w-px bg-border" />
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerClassName="grow py-[72px]"
            >
              {PLANNING_HOURS.map((value) => (
                <TouchableOpacity
                  key={value}
                  onPress={() => onChangeTime(value)}
                  className={cn(
                    "min-h-10 items-center justify-center rounded-full",
                    time === value && "bg-primary-light",
                  )}
                >
                  <Text
                    className={cn(
                      "body text-text-secondary",
                      time === value && "font-semibold text-primary",
                    )}
                  >
                    {value}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          {dayLocked ? (
            <Text className="caption mx-[30px] -mt-3 text-center text-text-secondary">
              To assign a day, change a Flexible day time tag to a numbered day.
            </Text>
          ) : null}
          {hasExisting ? (
            <TouchableOpacity
              onPress={onRemove}
              className="mb-0.5 mt-1.5 min-h-[34px] self-center px-3.5"
            >
              <Text className="captionEmphasis text-error">Remove time</Text>
            </TouchableOpacity>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
