import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import { MapTrifoldIcon } from 'phosphor-react-native/src/icons/MapTrifold';
import { ShareNetworkIcon } from 'phosphor-react-native/src/icons/ShareNetwork';
import { memo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

type AtlasDetailHeaderProps = {
  title: string;
  /** "5 days · 8 places" — see tripSummary in atlasItinerary.ts. */
  summary: string;
  coverUri: string | null;
  onShare?: () => void;
};

/**
 * Cover, title and trip summary — the fixed top of the Atlas sheet, matching
 * PlaceDetailHeader's geometry so the two detail panels read as one family.
 * The Atlas has no cover of its own, so the first stop's photo stands in.
 */
export const AtlasDetailHeader = memo(function AtlasDetailHeader({
  title,
  summary,
  coverUri,
  onShare,
}: AtlasDetailHeaderProps) {
  return (
    <View style={styles.row}>
      <View style={styles.cover}>
        {coverUri ? (
          <Image source={{ uri: coverUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={styles.coverFallback}>
            <MapTrifoldIcon size={32} weight="regular" color="#A7A7A7" />
          </View>
        )}
        {/* Barely-there wash — keeps a blown-out photo from reading brighter
            than the sheet it sits on. Same treatment as PlaceDetailHeader. */}
        <View pointerEvents="none" style={styles.coverWash} />
      </View>

      <View style={styles.copy}>
        <Text numberOfLines={2} style={[typography.h3, styles.title]}>{title}</Text>
        <Text numberOfLines={1} style={[typography.bodySmall, styles.summary]}>{summary}</Text>
      </View>

      {onShare ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share this Atlas"
          onPress={onShare}
          style={({ pressed }) => [styles.share, pressed && styles.sharePressed]}
        >
          <ShareNetworkIcon size={20} weight="bold" color="#717171" />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
  },
  cover: {
    width: 96,
    height: 96,
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: '#E5E5EA',
  },
  coverFallback: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  coverWash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.02)' },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { color: '#1A1A1A' },
  summary: { color: '#717171' },
  share: {
    width: 44,
    height: 44,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  sharePressed: { opacity: 0.6 },
});
