import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, ScrollView, Text, useColorScheme, View } from 'react-native';

import { PlaceDetail, PlaceLink, PlaceTag } from '../../../types/place';

type PlaceInfoSectionProps = {
  place: PlaceDetail;
};

type SectionAction = { icon: keyof typeof Ionicons.glyphMap; iconSize?: number; onPress?: () => void };

function SectionHeader({ label, action }: { label: string; action?: SectionAction }) {
  const colorScheme = useColorScheme();
  const foreground = colorScheme === 'dark' ? '#fafafa' : '#18181B';

  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-lg font-semibold text-foreground">{label}</Text>
      {action && (
        <Pressable
          onPress={action.onPress}
          className="h-9 w-9 items-center justify-center"
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
        >
          <Ionicons name={action.icon} size={action.iconSize ?? 20} color={foreground} />
        </Pressable>
      )}
    </View>
  );
}

function TagList({ tags }: { tags: PlaceTag[] }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingRight: 18 }}
    >
      {tags.map((tag) => (
        <View key={tag.id} className="rounded-full bg-card px-3 py-1.5">
          <Text className="text-sm font-medium text-text-tertiary">{tag.label}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Paragraphs({ text }: { text: string }) {
  const parts = text.split('\n\n');
  return (
    <View className="gap-3">
      {parts.map((part, i) => (
        <Text key={i} className="text-base leading-relax text-text-secondary">
          {part}
        </Text>
      ))}
    </View>
  );
}

function LinkRow({ link }: { link: PlaceLink }) {
  const colorScheme = useColorScheme();
  const foreground = colorScheme === 'dark' ? '#fafafa' : '#18181B';

  return (
    <Pressable
      onPress={() => Linking.openURL(link.url)}
      className="min-h-8 flex-row items-center justify-between pr-2"
      style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
    >
      <Text className="text-sm text-text-secondary">{link.label}</Text>
      <Ionicons name="chevron-forward" size={12} color={foreground} />
    </Pressable>
  );
}

export default function PlaceInfoSection({ place }: PlaceInfoSectionProps) {
  return (
    <View className="gap-6 px-4 pt-6">
      {place.tags.length > 0 && (
        <View className="pt-2">
          <SectionHeader label="Tags" action={{ icon: 'add', iconSize: 20 }} />
          <View className="mt-2">
            <TagList tags={place.tags} />
          </View>
        </View>
      )}

      <View className="pt-2">
        <SectionHeader label="Collection" action={{ icon: 'add', iconSize: 20 }} />
        {place.collections && place.collections.length > 0 && (
          <View className="mt-2">
            <TagList tags={place.collections} />
          </View>
        )}
      </View>

      <View className="pt-2">
        <SectionHeader label="Summary" />
        <View className="mt-2">
          <Paragraphs text={place.summary} />
        </View>
      </View>

      <View className="pt-2">
        <SectionHeader label="Visit Strategy" />
        <View className="mt-2">
          <Paragraphs text={place.visitStrategy} />
        </View>
      </View>

      {place.links && place.links.length > 0 && (
        <View className="pt-2">
          <SectionHeader label="Links" action={{ icon: 'add', iconSize: 20 }} />
          <View className="mt-2 gap-1">
            {place.links.map((link) => (
              <LinkRow key={`${link.label}-${link.url}`} link={link} />
            ))}
          </View>
        </View>
      )}

      <View className="pt-2">
        <SectionHeader label="Note" action={{ icon: 'pencil-outline', iconSize: 16 }} />
        {place.note && (
          <View className="mt-2">
            <Paragraphs text={place.note} />
          </View>
        )}
      </View>
    </View>
  );
}
