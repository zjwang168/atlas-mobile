import { Text } from '@/components/ui/text';
import { typography } from '@/theme/typography';
import { UsersThreeIcon } from 'phosphor-react-native/src/icons/UsersThree';
import { Fragment, memo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CardDivider, DetailCard } from './DetailCard';

/** One line of community knowledge about a place, and who it came from. */
export type CommunityNote = {
  id: string;
  text: string;
  /** Display name of whoever wrote it; absent for an anonymous contribution. */
  author?: string;
};

type PlaceCommunityNotesCardProps = {
  notes: CommunityNote[];
};

const COLLAPSED_COUNT = 3;

/**
 * What other people who saved this place have said about it — the layer that
 * turns a private archive into something worth reading.
 *
 * Nothing populates `notes` yet: places are still per-user rows, so there is no
 * "other people who saved this place" to read from. The card renders its empty
 * state rather than fabricating entries, and fills in unchanged once a shared
 * place entity exists.
 */
export const PlaceCommunityNotesCard = memo(function PlaceCommunityNotesCard({
  notes,
}: PlaceCommunityNotesCardProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? notes : notes.slice(0, COLLAPSED_COUNT);
  const hasMore = notes.length > COLLAPSED_COUNT;

  return (
    <DetailCard>
      <View style={styles.banner}>
        <UsersThreeIcon size={16} weight="fill" color="#F5A000" />
        <Text style={[typography.bodySmallEmphasis, styles.bannerLabel]}>Community Notes</Text>
      </View>

      {notes.length === 0 ? (
        <View style={styles.empty}>
          <Text className="text-text-tertiary" style={typography.bodySmallRelaxed}>
            Nobody else has saved this place yet. When they do, what their posts
            said about it shows up here.
          </Text>
        </View>
      ) : (
        <View>
          {visible.map((note, index) => (
            <Fragment key={note.id}>
              {index > 0 ? <CardDivider /> : null}
              <View style={styles.note}>
                <Text className="text-text-primary" style={typography.bodySmallRelaxed}>
                  {note.text}
                </Text>
                {note.author ? (
                  <Text className="text-text-tertiary" style={typography.caption}>
                    {note.author}
                  </Text>
                ) : null}
              </View>
            </Fragment>
          ))}

          {hasMore ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={expanded ? 'Show fewer community notes' : 'Read more community notes'}
              onPress={() => setExpanded((value) => !value)}
              style={({ pressed }) => [styles.more, pressed && styles.morePressed]}
            >
              <Text className="text-text-primary" style={typography.bodySmallMedium}>
                {expanded ? 'Show less' : 'Read more'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </DetailCard>
  );
});

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderCurve: 'continuous',
    // An amber wash rather than a themed surface — the banner is the one place
    // in the stack that reads as "not yours", so it is deliberately off-palette.
    backgroundColor: 'rgba(245,160,0,0.08)',
  },
  bannerLabel: {
    color: '#F5A000',
  },
  empty: {
    paddingHorizontal: 6,
    paddingBottom: 6,
  },
  note: {
    paddingHorizontal: 6,
    paddingVertical: 10,
    gap: 2,
  },
  more: {
    paddingHorizontal: 6,
    paddingVertical: 10,
  },
  morePressed: {
    opacity: 0.55,
  },
});
