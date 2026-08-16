import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { LockSimpleIcon } from 'phosphor-react-native/src/icons/LockSimple';
import { PencilSimpleIcon } from 'phosphor-react-native/src/icons/PencilSimple';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, useColorScheme, View } from 'react-native';

import { useHomePlaces } from '../../home/HomeContext';
import { PlaceDetail } from '../../../types/place';
import { DetailCard } from './DetailCard';

type PlaceNoteCardProps = {
  place: PlaceDetail;
};

/**
 * The user's own note about the place — why they saved it, what to order.
 * Always rendered, empty or not: it is the one section that exists to be
 * written to, so it has to be reachable before there is anything in it.
 */
export const PlaceNoteCard = memo(function PlaceNoteCard({ place }: PlaceNoteCardProps) {
  const { updateSavedPlaceNote } = useHomePlaces();
  const colorScheme = useColorScheme();
  const foreground = colorScheme === 'dark' ? '#fafafa' : '#0a0a0a';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(place.note ?? '');
  const [saving, setSaving] = useState(false);

  // Drop any in-progress edit when the panel swaps to a different place.
  useEffect(() => {
    setDraft(place.note ?? '');
    setEditing(false);
  }, [place.id, place.note]);

  const save = async () => {
    setSaving(true);
    try {
      await updateSavedPlaceNote(place.id, draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(place.note ?? '');
    setEditing(false);
  };

  if (place.specialRole) return null;

  return (
    <DetailCard>
      <View style={styles.header}>
        <Text className="text-text-primary" style={typography.bodyEmphasis}>
          Your note
        </Text>

        {editing ? (
          <View style={styles.actions}>
            <IconButton label="Cancel note edit" onPress={cancel} disabled={saving}>
              <XIcon size={18} weight="bold" color={foreground} />
            </IconButton>
            <IconButton label="Save note" onPress={() => { void save(); }} disabled={saving}>
              <CheckIcon size={18} weight="bold" color="#12C170" />
            </IconButton>
          </View>
        ) : (
          <IconButton label="Edit note" onPress={() => setEditing(true)}>
            <PencilSimpleIcon size={18} weight="bold" color={foreground} />
          </IconButton>
        )}
      </View>

      {editing ? (
        <Input
          className="h-auto min-h-24 items-start py-2"
          multiline
          textAlignVertical="top"
          autoFocus
          placeholder="Why you saved it, what to order, who you came with…"
          value={draft}
          onChangeText={setDraft}
          editable={!saving}
        />
      ) : (
        <View style={styles.body}>
          <Text
            className={place.note ? 'text-text-secondary' : 'text-text-tertiary'}
            style={typography.bodySmallRelaxed}
          >
            {place.note || 'Nothing here yet. Tap the pencil to add one.'}
          </Text>
        </View>
      )}

      {/* Notes read as private by default — say so plainly, so nobody is
          surprised the day sharing them becomes possible. */}
      <View style={styles.privacy}>
        <LockSimpleIcon size={12} weight="fill" color="#8E8E93" />
        <Text className="text-text-tertiary" style={typography.caption}>
          Private to you
        </Text>
      </View>
    </DetailCard>
  );
});

function IconButton({
  label,
  onPress,
  disabled,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, (pressed || disabled) && styles.iconButtonMuted]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 6,
    paddingRight: 2,
    paddingTop: 4,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 100,
  },
  iconButtonMuted: {
    opacity: 0.45,
  },
  body: {
    paddingHorizontal: 6,
  },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingBottom: 4,
  },
});
