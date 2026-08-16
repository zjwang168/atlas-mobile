import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import { ArrowSquareOutIcon } from 'phosphor-react-native/src/icons/ArrowSquareOut';
import { CaretDownIcon } from 'phosphor-react-native/src/icons/CaretDown';
import { CaretUpIcon } from 'phosphor-react-native/src/icons/CaretUp';
import { memo, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, useColorScheme, View } from 'react-native';

import type { PlaceSource } from '../../../services/place/placeService';
import { sourceMeta, type SourceMeta } from './sourceMeta';
import { DetailCard } from './DetailCard';

type PlaceSourcesCardProps = {
  sources: PlaceSource[];
};

const CARD_WIDTH = 150;
const MEDIA_HEIGHT = 92;

/**
 * Every post this place was parsed out of, each with that post's own take on it
 * — the same place described from a different angle by a different creator.
 * Hidden entirely when the place has no recorded provenance.
 */
export const PlaceSourcesCard = memo(function PlaceSourcesCard({ sources }: PlaceSourcesCardProps) {
  const [expanded, setExpanded] = useState(true);
  const colorScheme = useColorScheme();
  const foreground = colorScheme === 'dark' ? '#fafafa' : '#0a0a0a';

  // One badge per distinct platform, in the order sources arrive, so the
  // collapsed pill still says *where* the material came from.
  const platforms = useMemo(() => {
    const seen = new Map<string, SourceMeta>();
    for (const source of sources) {
      const meta = sourceMeta(source.source_type, source.source_url);
      if (!seen.has(meta.label)) seen.set(meta.label, meta);
    }
    return [...seen.values()].slice(0, 3);
  }, [sources]);

  if (sources.length === 0) return null;

  const Caret = expanded ? CaretUpIcon : CaretDownIcon;

  return (
    <DetailCard>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Hide' : 'Show'} ${sources.length} sources`}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
      >
        <View style={styles.pillLogos}>
          {platforms.map(({ label, Logo, color }) => (
            <Logo key={label} size={16} weight="fill" color={color} />
          ))}
        </View>
        <Text className="text-text-primary" style={typography.bodySmallMedium}>
          {expanded ? 'Hide sources' : 'Show sources'} · {sources.length}
        </Text>
        <Caret size={14} weight="bold" color={foreground} />
      </Pressable>

      {expanded ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
        >
          {sources.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))}
        </ScrollView>
      ) : null}
    </DetailCard>
  );
});

function SourceCard({ source }: { source: PlaceSource }) {
  const meta = sourceMeta(source.source_type, source.source_url);
  const url = source.source_url;
  const summary = source.ai_extracted_summary?.trim();

  return (
    <PressableScale
      accessibilityRole="link"
      accessibilityLabel={`Open this place's ${meta.label} source`}
      disabled={!url}
      onPress={() => { if (url) void Linking.openURL(url).catch(() => {}); }}
      scaleTo={0.97}
      style={styles.sourceCard}
    >
      {/* No thumbnail is stored for a source yet (only Facebook Reels ever
          filled one), so the media block is the platform's own colour rather
          than a grey box pretending a picture failed to load. */}
      <View style={[styles.media, { backgroundColor: `${meta.color}1A` }]}>
        <meta.Logo size={28} weight="fill" color={meta.color} />
      </View>

      <View style={styles.sourceCopy}>
        <Text
          numberOfLines={3}
          className={summary ? 'text-text-primary' : 'text-text-tertiary'}
          style={typography.bodySmall}
        >
          {summary || 'No summary from this post.'}
        </Text>

        <View style={styles.platformRow}>
          <meta.Logo size={14} weight="fill" color={meta.color} />
          <Text numberOfLines={1} className="text-text-secondary" style={styles.platformLabel}>
            {meta.label}
          </Text>
          {url ? <ArrowSquareOutIcon size={14} weight="bold" color="#8E8E93" /> : null}
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 12,
    paddingVertical: 7,
    borderRadius: 100,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  pillPressed: {
    opacity: 0.6,
  },
  pillLogos: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  strip: {
    flexDirection: 'row',
    gap: 8,
  },
  sourceCard: {
    width: CARD_WIDTH,
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  media: {
    height: MEDIA_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceCopy: {
    padding: 8,
    gap: 6,
  },
  platformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  // 13pt Medium, matching PlaceTagChip's label — the type scale has no 13 tier.
  platformLabel: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
});
