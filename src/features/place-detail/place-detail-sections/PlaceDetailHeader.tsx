import { PlaceCover, placeCategoryKey, type PlaceCategoryKey } from '@/components/place-cover/PlaceCover';
import { PlaceTagChip } from '@/components/place-tag-chip/PlaceTagChip';
import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import type { Icon } from 'phosphor-react-native';
import { BedIcon } from 'phosphor-react-native/src/icons/Bed';
import { CameraIcon } from 'phosphor-react-native/src/icons/Camera';
import { ForkKnifeIcon } from 'phosphor-react-native/src/icons/ForkKnife';
import { MapPinIcon } from 'phosphor-react-native/src/icons/MapPin';
import { ShoppingBagIcon } from 'phosphor-react-native/src/icons/ShoppingBag';
import { StarIcon } from 'phosphor-react-native/src/icons/Star';
import { TreeIcon } from 'phosphor-react-native/src/icons/Tree';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { memo, useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import { updatePlaceName } from '../../../services/place/placeService';
import { PlaceDetail } from '../../../types/place';

type PlaceDetailHeaderProps = {
  place: PlaceDetail;
  onDismiss: () => void;
};

/**
 * Glyph per category bucket, so a park gets a tree rather than the chip's
 * label-derived fallback (which only knows cafés from everything-else, and
 * puts a fork and knife on a beach).
 *
 * Colours are literals because an icon can't read a CSS variable — the same
 * constraint THEME.md documents for every icon in the app.
 */
const CATEGORY_CHIP: Record<PlaceCategoryKey, { Icon: Icon; color: string }> = {
  attraction: { Icon: CameraIcon, color: '#A855F7' },
  food: { Icon: ForkKnifeIcon, color: '#F5A000' },
  outdoors: { Icon: TreeIcon, color: '#12C170' },
  shopping: { Icon: ShoppingBagIcon, color: '#F43F5E' },
  lodging: { Icon: BedIcon, color: '#6366F1' },
  neutral: { Icon: MapPinIcon, color: '#8E8E93' },
};

/** `coffee_shop` → `Coffee Shop`. Categories arrive as raw backend strings. */
function categoryLabel(category: string): string {
  return category
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Thumbnail, name, category/rating chips and the dismiss button — the fixed top
 * of the Place Detail sheet, above the scrolling card stack.
 */
export const PlaceDetailHeader = memo(function PlaceDetailHeader({
  place,
  onDismiss,
}: PlaceDetailHeaderProps) {
  const colorScheme = useColorScheme();
  // The dismiss glyph is bound to text-secondary in the design, not to the
  // foreground the rest of the app's icons use — it should recede, not compete
  // with the place name beside it.
  const dismissGlyph = colorScheme === 'dark' ? '#b0b0b0' : '#717171';
  const title = place.specialRole
    ? place.specialRole[0].toUpperCase() + place.specialRole.slice(1)
    : place.name;

  return (
    <View style={styles.row}>
      <View style={styles.thumbnail}>
        {place.thumbnailUrl ? (
          <Image
            source={{ uri: place.thumbnailUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <PlaceCover category={place.category} specialRole={place.specialRole} iconSize={32} />
        )}
        {/* Barely-there wash from the design — keeps a blown-out photo from
            reading brighter than the sheet it sits on. */}
        <View pointerEvents="none" style={styles.thumbnailWash} />
      </View>

      <View style={styles.copy}>
        <PlaceName place={place} title={title} />
        <View style={styles.chips}>
          {place.category ? (
            <PlaceTagChip
              label={categoryLabel(place.category)}
              size="md"
              icon={CATEGORY_CHIP[placeCategoryKey(place.category)].Icon}
              iconColor={CATEGORY_CHIP[placeCategoryKey(place.category)].color}
              style={styles.chipCap}
            />
          ) : null}
          {/* No rating anywhere in the pipeline yet — the chip is wired so it
              appears the day one is persisted, and is absent until then. */}
          {place.rating != null ? (
            <PlaceTagChip
              label={place.rating.toFixed(1)}
              size="md"
              icon={StarIcon}
              iconColor="#F5A000"
            />
          ) : null}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss place details"
        onPress={onDismiss}
        style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
      >
        {/* Bold, not the default regular — the design's glyph is a ~1.9px stroke,
            which regular renders at 1.25 and reads visibly thin at this size. */}
        <XIcon size={20} weight="bold" color={dismissGlyph} />
      </Pressable>
    </View>
  );
});

/**
 * The place name, which doubles as the rename affordance: long-press swaps it
 * for an input. Long-press rather than tap because the name sits under a
 * scrolling sheet where a stray tap is common and an accidental edit is not
 * obviously undoable.
 */
function PlaceName({ place, title }: { place: PlaceDetail; title: string }) {
  const colorScheme = useColorScheme();
  // Matches the static title's text-primary, so the name doesn't change colour
  // the moment it becomes editable.
  const nameColor = colorScheme === 'dark' ? '#e0e0e0' : '#1a1a1a';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(place.name);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(place.name);
    setEditing(false);
  }, [place.id, place.name]);

  const save = async () => {
    const next = draft.trim();
    if (!next || saving || next === place.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await updatePlaceName(place.id, next);
      setEditing(false);
    } catch (error) {
      console.warn('[PlaceDetailHeader] could not rename place:', error);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <TextInput
        accessibilityLabel="Edit place name"
        autoFocus
        selectTextOnFocus
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => { void save(); }}
        onBlur={() => { void save(); }}
        returnKeyType="done"
        editable={!saving}
        // No lineHeight: it breaks iOS vertical centring inside a TextInput.
        style={[
          styles.nameInput,
          { color: nameColor, fontSize: typography.h3.fontSize, fontWeight: typography.h3.fontWeight },
        ]}
      />
    );
  }

  return (
    <Text
      numberOfLines={2}
      onLongPress={place.specialRole ? undefined : () => setEditing(true)}
      className="text-text-primary"
      style={[typography.h3, styles.name]}
    >
      {title}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    paddingHorizontal: 16,
    // Matches MyPlaces' filterRow — both sit directly under the panel grabber,
    // so the first row lands at the same height in either panel.
    paddingTop: 4,
    // Belongs to the fixed header, not to the scrolling stack: as padding on the
    // scroll content it scrolled away with the first card and let the stack ride
    // up against the chips.
    paddingBottom: 16,
  },
  thumbnail: {
    width: 96,
    height: 96,
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: '#E5E5EA',
  },
  thumbnailWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  copy: {
    flex: 1,
    // Fixed title height + this gap + the chip row add up to the thumbnail's 96.
    gap: 16,
  },
  // Always two lines tall, whether the name fills them or not — a one-line name
  // would otherwise pull the chip row up and leave it at a different height on
  // every place.
  name: {
    height: 52,
  },
  nameInput: {
    height: 52,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#A1A1AA',
  },
  chips: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  chipCap: {
    maxWidth: 160,
  },
  close: {
    width: 44,
    height: 44,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
    // A transparency rather than a themed surface — it has to read the same
    // over a photo and over the sheet, so it isn't a background token.
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  closePressed: {
    opacity: 0.6,
  },
});
