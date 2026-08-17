import { PlaceCover } from '@/components/place-cover/PlaceCover';
import { PlaceTagChip } from '@/components/place-tag-chip/PlaceTagChip';
import { Text } from '@/components/ui/text';
import { elevation } from '@/theme/elevation';
import { typography } from '@/theme/typography';
import { NavigationArrowIcon } from 'phosphor-react-native/src/icons/NavigationArrow';
import { memo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import type { ItineraryItem } from './atlasItinerary';

type AtlasStopRowProps = {
  item: ItineraryItem;
  index: number;
  /** Draws the connector down to the next stop; false on the day's last stop. */
  hasNext: boolean;
  selected: boolean;
  onPress: () => void;
  /** Opens directions to the next stop; absent on the last stop of a day. */
  onNavigate?: () => void;
};

const THUMBNAIL = 64;

/**
 * One stop in a day: its position in the day's order, a photo, its name and
 * category. The number column carries a dashed connector so a day reads as a
 * sequence rather than as an unordered list.
 */
export const AtlasStopRow = memo(function AtlasStopRow({
  item,
  index,
  hasNext,
  selected,
  onPress,
  onNavigate,
}: AtlasStopRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.gutter}>
        {hasNext ? <View pointerEvents="none" style={styles.connector} /> : null}
        <View style={styles.number}>
          <Text style={[typography.captionMedium, styles.numberText]}>{index + 1}</Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.place.name}
        onPress={onPress}
        style={({ pressed }) => [styles.card, selected && styles.cardSelected, pressed && styles.cardPressed]}
      >
        <View style={styles.thumbnail}>
          {item.place.photo_url ? (
            <Image source={{ uri: item.place.photo_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <PlaceCover category={item.place.category} iconSize={24} />
          )}
        </View>

        <View style={styles.copy}>
          <Text numberOfLines={1} style={[typography.bodyEmphasis, styles.name]}>{item.place.name}</Text>
          <View style={styles.chips}>
            {/* Only stops that are also saved places carry a category — see
                AtlasDisplayPlace. The chip is dropped rather than faked. */}
            {item.place.category ? (
              <PlaceTagChip label={item.place.category} style={styles.chipCap} />
            ) : null}
            {item.time ? (
              <Text numberOfLines={1} style={[typography.caption, styles.time]}>{item.time}</Text>
            ) : null}
          </View>
        </View>

        {onNavigate ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Directions to the next stop after ${item.place.name}`}
            onPress={onNavigate}
            hitSlop={8}
            style={({ pressed }) => [styles.navigate, pressed && styles.cardPressed]}
          >
            <NavigationArrowIcon size={16} weight="fill" color="#12C170" />
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  gutter: { width: 24, alignSelf: 'stretch', alignItems: 'center', paddingTop: 24 },
  // Runs from the number down through the gap to the next stop's number.
  connector: {
    position: 'absolute',
    top: 44,
    bottom: -12,
    width: 0,
    borderLeftWidth: 1,
    borderLeftColor: '#D9D9D9',
    borderStyle: 'dashed',
  },
  number: {
    width: 24,
    height: 24,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  numberText: { color: '#717171' },
  card: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 8,
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 0.5,
    borderColor: '#EBEBEB',
    backgroundColor: '#FFFFFF',
    ...elevation.card,
  },
  cardSelected: { borderColor: '#12C170' },
  cardPressed: { opacity: 0.75 },
  thumbnail: {
    width: THUMBNAIL,
    height: THUMBNAIL,
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: '#E5E5EA',
  },
  copy: { flex: 1, minWidth: 0, gap: 6 },
  name: { color: '#1A1A1A' },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipCap: { maxWidth: '80%' },
  time: { color: '#717171' },
  navigate: {
    width: 32,
    height: 32,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18,193,112,0.10)',
  },
});
