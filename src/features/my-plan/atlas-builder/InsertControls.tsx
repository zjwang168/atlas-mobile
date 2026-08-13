import Ionicons from "@expo/vector-icons/Ionicons";
import { TouchableOpacity } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { TRANSPORT_OPTIONS, type TransportMode } from "./constants";
import { atlasBuilderColor } from "./tokens";

export function TimeInsert({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      accessibilityLabel="Add a time divider"
      onPress={onPress}
      className="min-h-[26px] flex-row items-center justify-center gap-1 rounded-full bg-bg-secondary px-[9px]"
    >
      <Ionicons
        name="time-outline"
        size={13}
        color={atlasBuilderColor.textSecondary}
      />
      <Text className="captionEmphasis text-text-secondary">
        Add time
      </Text>
    </TouchableOpacity>
  );
}

export function TransportInsert({
  mode,
  onPress,
}: {
  mode: TransportMode | null;
  onPress: () => void;
}) {
  const option = TRANSPORT_OPTIONS.find((entry) => entry.mode === mode);
  return (
    <TouchableOpacity
      accessibilityLabel="Add transport"
      onPress={onPress}
      className={cn(
        "min-h-[26px] flex-row items-center justify-center gap-1 rounded-full bg-bg-secondary px-[9px]",
        option && "border border-primary bg-primary-light",
      )}
    >
      <Ionicons
        name={option?.icon ?? "swap-horizontal-outline"}
        size={13}
        color={
          option ? atlasBuilderColor.primary : atlasBuilderColor.textSecondary
        }
      />
      {!option ? (
        <Text className="captionEmphasis text-text-secondary">
          Add transport
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}
