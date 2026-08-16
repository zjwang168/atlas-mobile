import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import TopBlurFade from '@/components/ui/top-blur-fade';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import ContentPanel from '../../components/content-panel/ContentPanel';
import { toPlaceDetail } from '../../services/place/placeService';
import { PlaceDetail as PlaceDetailType } from '../../types/place';
import { useHomePlaces } from '../home/HomeContext';
import { PlaceAboutCard } from './place-detail-sections/PlaceAboutCard';
import {
  PlaceCommunityNotesCard,
  type CommunityNote,
} from './place-detail-sections/PlaceCommunityNotesCard';
import { PlaceDetailHeader } from './place-detail-sections/PlaceDetailHeader';
import { PlaceLocationCard } from './place-detail-sections/PlaceLocationCard';
import { PlaceNoteCard } from './place-detail-sections/PlaceNoteCard';
import { PlaceSourcesCard } from './place-detail-sections/PlaceSourcesCard';
import { usePlaceSources } from './utils/usePlaceSources';

type PlaceDetailProps = {
  placeId: string | null;
  onDismiss: () => void;
  onEdit: (place: PlaceDetailType) => void;
  snapGroup?: string;
  onHeightChange?: (height: number) => void;
};

/** Height of the white scrim that fades the card stack out at the sheet's bottom edge. */
const BOTTOM_FADE_HEIGHT = 68;

/** Nothing produces other people's notes yet — see PlaceCommunityNotesCard. */
const NO_COMMUNITY_NOTES: CommunityNote[] = [];

export default function PlaceDetail({
  placeId,
  onDismiss,
  onEdit: _onEdit,
  snapGroup,
  onHeightChange,
}: PlaceDetailProps) {
  const { savedPlaces } = useHomePlaces();
  const [place, setPlace] = useState<PlaceDetailType | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const sources = usePlaceSources(placeId);

  useEffect(() => {
    if (placeId) {
      setNotFound(false);
      const row = savedPlaces.find((p) => p.id === placeId);
      if (row) {
        setPlace(toPlaceDetail(row));
      } else {
        setPlace(null);
        setNotFound(true);
      }
      setIsVisible(true);
    } else {
      setNotFound(false);
      setIsVisible(false);
    }
  }, [placeId, savedPlaces]);

  // Only ever one photo today (Wikipedia's, matched on the place name), but the
  // About card takes a list so extra photos need no change here.
  const photos = useMemo(
    () => (place?.thumbnailUrl ? [place.thumbnailUrl] : []),
    [place?.thumbnailUrl],
  );

  return (
    <ContentPanel
      snapGroup={snapGroup}
      visible={isVisible}
      onHidden={() => setPlace(null)}
      zIndex={40}
      onHeightChange={onHeightChange}
    >
      {({ reportScrollY, bottomInset }) => {
        if (!place) {
          if (notFound) {
            return (
              <View className="flex-1 items-center justify-center px-8">
                <MagnifyingGlassIcon size={48} color="#999" />
                <Text className="mt-4 text-lg font-medium text-foreground">Place not found</Text>
                <Text className="mt-2 text-center text-sm text-text-tertiary">
                  We couldn&apos;t find details for this place. It may have been removed.
                </Text>
                <Button className="mt-6" variant="outline" onPress={onDismiss}>
                  <Text>Go back</Text>
                </Button>
              </View>
            );
          }
          return null;
        }

        return (
          <>
            <PlaceDetailHeader place={place} onDismiss={onDismiss} />

            <ScrollView
              bounces
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              onScroll={(e) => reportScrollY(e.nativeEvent.contentOffset.y)}
              contentContainerStyle={[
                styles.stack,
                { paddingBottom: bottomInset + BOTTOM_FADE_HEIGHT },
              ]}
            >
              <PlaceAboutCard summary={place.summary} photos={photos} />
              <PlaceSourcesCard sources={sources} />
              <PlaceNoteCard place={place} />
              <PlaceCommunityNotesCard notes={NO_COMMUNITY_NOTES} />
              <PlaceLocationCard place={place} />
            </ScrollView>

            <TopBlurFade edge="bottom" height={BOTTOM_FADE_HEIGHT} scrim={0.9} intensity={20} />
          </>
        );
      }}
    </ContentPanel>
  );
}

const styles = StyleSheet.create({
  stack: {
    paddingHorizontal: 16,
    // No paddingTop — the gap below the header is the header's own
    // paddingBottom, so it stays put instead of scrolling away with the stack.
    gap: 12,
  },
});
