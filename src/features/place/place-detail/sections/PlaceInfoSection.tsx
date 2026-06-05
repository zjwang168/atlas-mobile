import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { PlaceDetail, PlaceLink, PlaceTag } from '../../../../types/place';

type PlaceInfoSectionProps = {
  place: PlaceDetail;
  onEdit: (place: PlaceDetail) => void;
};

export default function PlaceInfoSection({ place, onEdit }: PlaceInfoSectionProps) {
  return (
    <View className="gap-6 px-4.5 pt-6">
      {place.tags.length > 0 && (
        <LabeledSection
          label="Tags"
          action={
            <Pressable
              className="h-7 w-7 items-center justify-center rounded-full bg-gray-100"
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Ionicons name="add" size={18} color="#18181B" />
            </Pressable>
          }
        >
          <TagList tags={place.tags} />
        </LabeledSection>
      )}

      <LabeledSection
        label="Summary"
        action={
          <Pressable
            onPress={() => onEdit(place)}
            className="flex-row items-center gap-0.5 rounded-full border border-gray-300 px-3 py-1"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Text className="text-xs font-semibold text-gray-900">Edit</Text>
            <Ionicons name="chevron-forward" size={13} color="#18181B" />
          </Pressable>
        }
      >
        <Text className="text-sm leading-6.5 text-gray-800">{place.summary}</Text>
      </LabeledSection>

      <LabeledSection label="Visit Strategy">
        <Text className="text-sm leading-6.5 text-gray-800">{place.visitStrategy}</Text>
      </LabeledSection>

      {place.links && place.links.length > 0 && (
        <LabeledSection label="Links">
          <View className="gap-1">
            {place.links.map((link) => (
              <LinkRow key={`${link.label}-${link.url}`} link={link} />
            ))}
          </View>
        </LabeledSection>
      )}
    </View>
  );
}

function LabeledSection({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View className="pt-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-semibold text-gray-900">{label}</Text>
        {action}
      </View>
      <View className="mt-2.5">{children}</View>
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
        <View key={tag.id} className="rounded-full bg-green-50 px-3 py-1.5">
          <Text className="text-xs font-semibold text-green-900">{tag.label}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function LinkRow({ link }: { link: PlaceLink }) {
  return (
    <Pressable
      onPress={() => Linking.openURL(link.url)}
      className="min-h-11 flex-row items-center justify-between"
      style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
    >
      <Text className="text-sm text-gray-900">{link.label}</Text>
      <Ionicons name="arrow-up-outline" size={18} color="#18181B" />
    </Pressable>
  );
}
