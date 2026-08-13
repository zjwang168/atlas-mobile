import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, useColorScheme, View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useHomePlaces } from '../../home/HomeContext';
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
        <Button onPress={action.onPress} size="icon" variant="ghost">
          <Ionicons name={action.icon} size={action.iconSize ?? 20} color={foreground} />
        </Button>
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
        <Badge key={tag.id} variant="secondary" className="px-3 py-1.5">
          <Text className="text-sm font-medium text-text-tertiary">{tag.label}</Text>
        </Badge>
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

function NoteSection({ place }: { place: PlaceDetail }) {
  const { updateSavedPlaceNote } = useHomePlaces();
  const colorScheme = useColorScheme();
  const foreground = colorScheme === 'dark' ? '#fafafa' : '#18181B';
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(place.note ?? '');
  const [saving, setSaving] = useState(false);

  // Reset the draft (and drop out of edit mode) whenever the underlying place changes.
  useEffect(() => {
    setDraft(place.note ?? '');
    setIsEditing(false);
  }, [place.id, place.note]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSavedPlaceNote(place.id, draft);
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(place.note ?? '');
    setIsEditing(false);
  };

  return (
    <View className="pt-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-lg font-semibold text-foreground">Note</Text>
        {place.specialRole ? null : isEditing ? (
          <View className="flex-row items-center gap-1">
            <Button accessibilityLabel="Cancel note edit" onPress={handleCancel} size="icon" variant="ghost" disabled={saving}>
              <Ionicons name="close" size={20} color={foreground} />
            </Button>
            <Button accessibilityLabel="Save note" onPress={handleSave} size="icon" variant="ghost" disabled={saving}>
              <Ionicons name="checkmark" size={20} color={foreground} />
            </Button>
          </View>
        ) : (
          <Button accessibilityLabel="Edit note" onPress={() => setIsEditing(true)} size="icon" variant="ghost">
            <Ionicons name="pencil-outline" size={16} color={foreground} />
          </Button>
        )}
      </View>
      {place.specialRole ? (
        <Text className="mt-2 text-sm leading-relax text-text-secondary">Manage this location in Atlas AI.</Text>
      ) : isEditing ? (
        <Input
          className="mt-2 h-auto min-h-24 items-start py-2"
          multiline
          textAlignVertical="top"
          autoFocus
          placeholder="Add a note..."
          value={draft}
          onChangeText={setDraft}
          editable={!saving}
        />
      ) : (
        place.note && (
          <View className="mt-2">
            <Paragraphs text={place.note} />
          </View>
        )
      )}
    </View>
  );
}

export default function PlaceInfoSection({ place }: PlaceInfoSectionProps) {
  const hasSummary = place.summary.trim().length > 0;
  const hasVisitStrategy = place.visitStrategy.trim().length > 0;
  const hasCollections = (place.collections?.length ?? 0) > 0;
  const hasLinks = (place.links?.length ?? 0) > 0;

  return (
    <View className="gap-6 px-4 pt-6">
      {/* Tags and Note always render their section, regardless of content —
          every other section below is hidden entirely when it has nothing to show. */}
      <View className="pt-2">
        <SectionHeader label="Tags" action={place.specialRole ? undefined : { icon: 'add', iconSize: 20 }} />
        {place.tags.length > 0 && (
          <View className="mt-2">
            <TagList tags={place.tags} />
          </View>
        )}
      </View>

      {hasSummary && (
        <View className="pt-2">
          <SectionHeader label="Summary" />
          <View className="mt-2">
            <Paragraphs text={place.summary} />
          </View>
        </View>
      )}

      {hasCollections && (
        <View className="pt-2">
          <SectionHeader label="Collection" action={place.specialRole ? undefined : { icon: 'add', iconSize: 20 }} />
          <View className="mt-2">
            <TagList tags={place.collections!} />
          </View>
        </View>
      )}

      {hasVisitStrategy && (
        <View className="pt-2">
          <SectionHeader label="Visit Strategy" />
          <View className="mt-2">
            <Paragraphs text={place.visitStrategy} />
          </View>
        </View>
      )}

      {hasLinks && (
        <View className="pt-2">
          <SectionHeader label="Links" action={place.specialRole ? undefined : { icon: 'add', iconSize: 20 }} />
          <View className="mt-2 gap-1">
            {place.links!.map((link) => (
              <LinkRow key={`${link.label}-${link.url}`} link={link} />
            ))}
          </View>
        </View>
      )}

      <NoteSection place={place} />
    </View>
  );
}
