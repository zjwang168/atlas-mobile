import {
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { Text } from "@/components/ui/text";
import Ionicons from "@expo/vector-icons/Ionicons";
import { cn } from "@/lib/utils";
import { TRANSPORT_OPTIONS, type TransportMode } from "./constants";
import { atlasBuilderColor } from "./tokens";

export function TransportPickerModal({
  visible,
  selected,
  onSelect,
  onRemove,
  onClose,
}: {
  visible: boolean;
  selected: TransportMode | null;
  onSelect: (mode: TransportMode) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
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
            <Text className="bodySmallEmphasis text-text-primary">
              Add transport
            </Text>
            <View className="w-12" />
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerClassName="gap-2 px-[18px] pb-7"
          >
            {TRANSPORT_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.mode}
                onPress={() => onSelect(option.mode)}
                className={cn(
                  "min-h-12 flex-row items-center gap-3 rounded-[20px] bg-bg-secondary px-3.5",
                  selected === option.mode &&
                    "border border-primary bg-primary-light",
                )}
              >
                <Ionicons
                  name={option.icon}
                  size={21}
                  color={
                    selected === option.mode
                      ? atlasBuilderColor.primary
                      : atlasBuilderColor.textSecondary
                  }
                />
                <Text
                  className={cn(
                    "subheader text-text-secondary",
                    selected === option.mode && "text-primary",
                  )}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {selected ? (
            <TouchableOpacity
              onPress={onRemove}
              className="mb-0.5 mt-1.5 min-h-[34px] self-center px-3.5"
            >
              <Text className="captionEmphasis text-error">
                Remove transport
              </Text>
            </TouchableOpacity>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
