import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, TouchableOpacity, View } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { atlasBuilderColor } from "./tokens";
import type { DraftPlace } from "./types";

export function AtlasCandidateCard({
  place,
  added,
  onAdd,
}: {
  place: DraftPlace | null;
  added: boolean;
  onAdd: () => void;
}) {
  const unavailable = Boolean(place?.provisional);
  return (
    <View className="min-h-[82px] px-[15px] pb-[5px] pt-[10px]">
      <View
        className={cn(
          "min-h-[67px] flex-row items-center gap-[10px] rounded-[20px] border border-border bg-surface px-[11px] py-[10px]",
          !place && "bg-bg-secondary",
        )}
      >
        {place ? (
          <>
            <View className="h-8 w-8 items-center justify-center rounded-full bg-primary">
              <Ionicons
                name="location"
                size={16}
                color={atlasBuilderColor.textInverse}
              />
            </View>
            <View className="min-w-0 flex-1">
              <Text
                numberOfLines={1}
                className="bodySmallEmphasis text-text-primary"
              >
                {place.name}
              </Text>
              <Text
                numberOfLines={1}
                className="caption mt-px text-text-secondary"
              >
                {unavailable
                  ? "Verifying map position..."
                  : place.subtitle || "Selected location"}
              </Text>
            </View>
            {added ? (
              <View className="min-h-[30px] flex-row items-center gap-1 rounded-full bg-primary-light px-[9px]">
                <Ionicons
                  name="checkmark"
                  size={13}
                  color={atlasBuilderColor.primary}
                />
                <Text className="captionEmphasis text-primary">
                  Added
                </Text>
              </View>
            ) : unavailable ? (
              <View className="h-9 w-9 items-center justify-center rounded-full bg-bg-secondary">
                <ActivityIndicator
                  size="small"
                  color={atlasBuilderColor.primary}
                />
              </View>
            ) : (
              <TouchableOpacity
                accessibilityLabel={`Add ${place.name} to Atlas`}
                onPress={onAdd}
                className="h-9 w-9 items-center justify-center rounded-full bg-primary"
              >
                <Ionicons
                  name="add"
                  size={21}
                  color={atlasBuilderColor.textInverse}
                />
              </TouchableOpacity>
            )}
          </>
        ) : (
          <>
            <View className="h-8 w-8 items-center justify-center rounded-full bg-muted">
              <Ionicons
                name="location-outline"
                size={16}
                color={atlasBuilderColor.textSecondary}
              />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="captionEmphasis text-text-secondary">
                Choose a place on the map
              </Text>
              <Text className="caption mt-px text-text-tertiary">
                Its details will appear here
              </Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}
