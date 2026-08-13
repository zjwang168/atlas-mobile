import { Badge } from '@/components/ui/badge';
import { PlaceCover } from '@/components/place-cover/PlaceCover';
import { Text } from '@/components/ui/text';
import { useHomeOverlay, useHomePlaces } from '@/features/home/HomeContext';
import { typography } from '@/theme/typography';
import { PlaceDetail } from '@/types/place';
import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useEffect, useRef, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import ReanimatedSwipeable, { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';

type PlaceCardProps = {
  item: PlaceDetail;
  selected?: boolean;
  onPress?: (place: PlaceDetail) => void;
  onDelete: (id: string) => void;
  onDeleteInitiated?: (place: PlaceDetail) => void;
};

export const PLACE_CARD_ROW_HEIGHT = 140;
const DELETE_BUTTON_WIDTH = 72;
const DELETE_BUTTON_SIZE = 48;

/** Fixed at the right edge behind the card — doesn't translate with the
    swipe. Scale and fade track swipe progress directly (0 = untouched, 1 =
    fully open), no open/closed state. */
function DeleteAction({ progress, onDelete }: { progress: SharedValue<number>; onDelete: () => void }) {
  const style = useAnimatedStyle(() => {
    const amount = Math.min(progress.value, 1);
    return {
      opacity: amount,
      transform: [{ scale: amount }],
    };
  });
  return (
    <Reanimated.View style={[styles.deleteAction, style]}>
      <TouchableOpacity onPress={onDelete} style={styles.deleteButton}>
        <Ionicons name="trash-outline" size={20} color="#fff" />
      </TouchableOpacity>
    </Reanimated.View>
  );
}

/** Memoized so unrelated re-renders of AllPlaces (e.g. ContentPanel drag
    frames) don't force every visible row to re-render — only rows whose
    own props actually changed do. */
export const PlaceCard = memo(function PlaceCard({ item, selected = false, onPress, onDelete, onDeleteInitiated }: PlaceCardProps) {
  const swipeableRef = useRef<SwipeableMethods>(null);
  const [failedImageUri, setFailedImageUri] = useState<string | null>(null);
  const [locallySelected, setLocallySelected] = useState(false);
  const { overlay, setOverlay } = useHomeOverlay();
  const { selectedPlaceId } = useHomePlaces();
  const specialRole = item.specialRole;
  const displayName = specialRole ? specialRole[0].toUpperCase() + specialRole.slice(1) : item.name;

  useEffect(() => {
    if (selectedPlaceId !== item.id) setLocallySelected(false);
  }, [item.id, selectedPlaceId]);
  const handleDelete = () => {
    onDeleteInitiated?.(item);
    onDelete(item.id);
  };

  const handleSelect = () => {
    setLocallySelected(true);
    onPress?.(item);
  };

  const handleOpenDetail = () => {
    setLocallySelected(true);
    onPress?.(item);
    const returnTo = overlay.kind === 'placeDetail' ? { kind: 'none' as const } : overlay;
    setOverlay({ kind: 'placeDetail', placeId: item.id, returnTo });
  };

  const handleOpenGoogleMaps = () => {
    const query = encodeURIComponent([item.name, item.subtitle, item.city, item.region, item.country].filter(Boolean).join(', '));
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`).catch((error) => {
      console.warn('[PlaceCard] could not open Google Maps:', error);
    });
  };

  return (
    <View style={styles.rowContainer}>
      <View style={[styles.cardShell, (selected || locallySelected) && styles.cardShellSelected]}>
      <ReanimatedSwipeable
        ref={swipeableRef}
        friction={2}
        rightThreshold={DELETE_BUTTON_WIDTH / 2}
        overshootRight
        overshootFriction={2}
        animationOptions={{ mass: 1, damping: 14, stiffness: 90, overshootClamping: false }}
        renderRightActions={(progress) => <DeleteAction progress={progress} onDelete={handleDelete} />}
      >
        <View style={styles.cardContent}>
          <View style={styles.cardTextAction}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open details for ${displayName}`}
              hitSlop={6}
              onPress={handleOpenDetail}
              style={({ pressed }) => [styles.titleAction, pressed && styles.titleActionPressed]}
            >
              <Text
                style={[typography.h3, styles.titleLink]}
                numberOfLines={1}
              >
                {displayName}
              </Text>
              <Ionicons name="chevron-forward" size={15} color="#5F6368" />
            </Pressable>
            <TouchableOpacity onPress={handleSelect} activeOpacity={0.7} style={styles.summaryAction}>
              <Text
                numberOfLines={3}
                className="text-text-secondary"
                style={[typography.bodySmall, { height: 60 }]}
              >
                {item.summary}
              </Text>
            </TouchableOpacity>
          </View>
          {specialRole ? (
            <View style={styles.specialPlaceThumbnail}>
              <PlaceCover specialRole={specialRole} iconSize={34} />
            </View>
          ) : (
            <View style={styles.detailImageButton}>
              {item.thumbnailUrl && failedImageUri !== item.thumbnailUrl ? (
                <Image
                  source={{ uri: item.thumbnailUrl }}
                  style={styles.detailImage}
                  resizeMode="cover"
                  onError={() => setFailedImageUri(item.thumbnailUrl)}
                />
              ) : (
                <PlaceCover category={item.category} iconSize={24} />
              )}
            </View>
          )}
        </View>
      </ReanimatedSwipeable>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.name} in Google Maps`}
        onPress={handleOpenGoogleMaps}
        activeOpacity={0.72}
        style={styles.googleMapsButton}
      >
        <Ionicons name="map-outline" size={13} color="#34383A" />
        <Text style={styles.googleMapsText}>Maps</Text>
        <Ionicons name="open-outline" size={12} color="#34383A" />
      </TouchableOpacity>
      {item.tags?.length || specialRole ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tagsRow}
          contentContainerStyle={styles.tagsRowContent}
        >
          {[...(specialRole ? [{ id: specialRole, label: 'Managed in Atlas AI' }] : []), ...(item.tags ?? [])].map((tag) => (
            <Badge
              key={tag.id}
              variant="outline"
              style={{ paddingHorizontal: 12, paddingVertical: 4 }}
            >
              <Text style={typography.caption}>{tag.label}</Text>
            </Badge>
          ))}
        </ScrollView>
      ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  rowContainer: {
    height: PLACE_CARD_ROW_HEIGHT,
    paddingHorizontal: 16,
  },
  deleteAction: {
    width: DELETE_BUTTON_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    width: DELETE_BUTTON_SIZE,
    height: DELETE_BUTTON_SIZE,
    borderRadius: DELETE_BUTTON_SIZE / 2,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    flexDirection: 'row',
    gap: 24,
    alignItems: 'flex-start',
  },
  cardTextAction: {
    flex: 1,
  },
  titleAction: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginBottom: 4,
  },
  titleActionPressed: {
    opacity: 0.56,
  },
  titleLink: {
    color: '#2F3133',
    flexShrink: 1,
  },
  googleMapsButton: {
    position: 'absolute',
    right: 8,
    top: 104,
    minWidth: 82,
    height: 27,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D4D9D8',
    backgroundColor: '#EDF0EF',
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  googleMapsText: {
    color: '#34383A',
    fontSize: 11,
    fontWeight: '700',
  },
  summaryAction: {
    minHeight: 60,
  },
  detailImageButton: {
    width: 86,
    height: 86,
    borderRadius: 16,
    overflow: 'hidden',
    flexShrink: 0,
  },
  detailImage: {
    width: '100%',
    height: '100%',
  },
  specialPlaceThumbnail: {
    width: 86,
    height: 86,
    borderRadius: 16,
    flexShrink: 0,
  },
  cardShell: {
    position: 'relative',
    overflow: 'visible',
    borderRadius: 8,
    padding: 8,
    marginHorizontal: -8,
    marginVertical: -7,
  },
  cardShellSelected: {
    backgroundColor: '#E9FBF1',
    borderWidth: 1,
    borderColor: 'rgba(18,193,112,0.28)',
  },
  tagsRow: {
    marginTop: 10,
    height: 27,
  },
  tagsRowContent: {
    flexDirection: 'row',
    gap: 6,
    paddingRight: 92,
  },
});
