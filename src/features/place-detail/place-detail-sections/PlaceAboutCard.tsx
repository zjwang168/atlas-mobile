import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import { SparkleIcon } from 'phosphor-react-native/src/icons/Sparkle';
import { memo } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';

import { DetailCard } from './DetailCard';

type PlaceAboutCardProps = {
  summary: string;
  photos: string[];
};

const PHOTO_HEIGHT = 160;
const PHOTO_WIDTH = 120;

/**
 * The AI's words about the place, with whatever photos we hold for it.
 * Renders nothing when there is neither — an empty "About this place" frame
 * says less than no card at all.
 */
export const PlaceAboutCard = memo(function PlaceAboutCard({
  summary,
  photos,
}: PlaceAboutCardProps) {
  const text = summary.trim();
  if (!text && photos.length === 0) return null;

  return (
    <DetailCard>
      {text ? (
        <View style={styles.copy}>
          <View style={styles.titleRow}>
            <SparkleIcon size={20} weight="fill" color="#12C170" />
            <Text className="text-text-primary" style={typography.bodyEmphasis}>
              About this place
            </Text>
          </View>
          <Text className="text-text-secondary" style={typography.bodySmallRelaxed}>
            {text}
          </Text>
        </View>
      ) : null}

      <PhotoStrip photos={photos} />
    </DetailCard>
  );
});

/**
 * A lone photo spans the card instead of sitting in the strip's tile — one
 * 120-wide tile stranded at the left edge reads as a layout bug rather than as
 * the only picture we have. Two or more fall back to the horizontal strip.
 */
function PhotoStrip({ photos }: { photos: string[] }) {
  if (photos.length === 0) return null;

  if (photos.length === 1) {
    return (
      <Image
        source={{ uri: photos[0] }}
        style={styles.singlePhoto}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
    >
      {photos.map((uri) => (
        <Image
          key={uri}
          source={{ uri }}
          style={styles.photo}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  copy: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  strip: {
    flexDirection: 'row',
    gap: 8,
  },
  photo: {
    width: PHOTO_WIDTH,
    height: PHOTO_HEIGHT,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: '#E5E5EA',
  },
  singlePhoto: {
    width: '100%',
    height: PHOTO_HEIGHT,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: '#E5E5EA',
  },
});
