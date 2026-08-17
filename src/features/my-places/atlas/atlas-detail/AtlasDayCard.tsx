import { PlaceCover } from '@/components/place-cover/PlaceCover';
import { Text } from '@/components/ui/text';
import { elevation } from '@/theme/elevation';
import { typography } from '@/theme/typography';
import { memo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { dayMetaLine, type DayGroup } from './atlasItinerary';

type AtlasDayCardProps = {
  group: DayGroup;
  onPress: () => void;
};

const STRIP_THUMBNAIL = 56;

/**
 * One day, summarised for the Overview tab: its badge and city, how far and how
 * many stops, and a strip of the day's photos. Tapping it opens that day's tab.
 */
export const AtlasDayCard = memo(function AtlasDayCard({ group, onPress }: AtlasDayCardProps) {
  const meta = dayMetaLine(group);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${group.label}, ${meta}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.headerRow}>
        {group.day !== null ? (
          <View style={styles.badge}>
            <Text style={[typography.captionMedium, styles.badgeText]}>{group.label}</Text>
          </View>
        ) : null}
        {/* Same one-line treatment as the day tab's own header. */}
        <Text numberOfLines={1} style={[typography.subheader, styles.meta]}>{meta}</Text>
      </View>

      {group.items.length ? (
        <View style={styles.strip}>
          {group.items.slice(0, 4).map((item) => (
            <View key={item.rowId} style={styles.thumbnail}>
              {item.place.photo_url ? (
                <Image source={{ uri: item.place.photo_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <PlaceCover category={item.place.category} iconSize={20} />
              )}
            </View>
          ))}
          {group.items.length > 4 ? (
            <View style={[styles.thumbnail, styles.thumbnailMore]}>
              <Text style={[typography.captionMedium, styles.moreText]}>+{group.items.length - 4}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 0.5,
    borderColor: '#EBEBEB',
    backgroundColor: '#FFFFFF',
    padding: 12,
    gap: 12,
    ...elevation.card,
  },
  cardPressed: { opacity: 0.75 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    minHeight: 26,
    paddingHorizontal: 10,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#12C170',
  },
  badgeText: { color: '#FFFFFF' },
  meta: { flex: 1, minWidth: 0, color: '#717171' },
  strip: { flexDirection: 'row', gap: 8 },
  thumbnail: {
    width: STRIP_THUMBNAIL,
    height: STRIP_THUMBNAIL,
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: '#E5E5EA',
  },
  thumbnailMore: { alignItems: 'center', justifyContent: 'center' },
  moreText: { color: '#717171' },
});
