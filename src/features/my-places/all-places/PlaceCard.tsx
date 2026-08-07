import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { useHome } from '@/features/home/HomeContext';
import { typography } from '@/theme/typography';
import { PlaceDetail } from '@/types/place';
import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useEffect, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import ReanimatedSwipeable, { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, { FadeInUp, runOnJS, SharedValue, useAnimatedReaction, useAnimatedStyle } from 'react-native-reanimated';

type PlaceCardProps = {
  item: PlaceDetail;
  recentlyAdded?: boolean;
  selected?: boolean;
  onPress?: (place: PlaceDetail) => void;
  onDelete: (id: string) => void;
  onDeleteSwipeStart?: (place: PlaceDetail) => void;
  onDeleteSwipeProgress?: (place: PlaceDetail, progress: number) => void;
  onDeleteSwipeSettle?: (place: PlaceDetail, opened: boolean) => void;
  onDeleteInitiated?: (place: PlaceDetail) => void;
};

const DELETE_BUTTON_WIDTH = 72;
const DELETE_BUTTON_SIZE = 48;

/** Fixed at the right edge behind the card — doesn't translate with the
    swipe. Scale and fade track swipe progress directly (0 = untouched, 1 =
    fully open), no open/closed state. */
function DeleteAction({ progress, onDelete, onProgress }: { progress: SharedValue<number>; onDelete: () => void; onProgress?: (progress: number) => void }) {
  const style = useAnimatedStyle(() => {
    const amount = Math.min(progress.value, 1);
    return {
      opacity: amount,
      transform: [{ scale: amount }],
    };
  });
  useAnimatedReaction(
    () => Math.min(Math.max(progress.value, 0), 1),
    (current, previous) => {
      if (onProgress && (previous === null || Math.abs(current - previous) >= 0.02)) {
        runOnJS(onProgress)(current);
      }
    },
    [onProgress],
  );
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
export const PlaceCard = memo(function PlaceCard({ item, recentlyAdded = false, selected = false, onPress, onDelete, onDeleteSwipeStart, onDeleteSwipeProgress, onDeleteSwipeSettle, onDeleteInitiated }: PlaceCardProps) {
  const swipeableRef = useRef<SwipeableMethods>(null);
  const [failedImageUri, setFailedImageUri] = useState<string | null>(null);
  const [locallySelected, setLocallySelected] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { overlay, setOverlay, selectedPlaceId } = useHome();

  useEffect(() => {
    if (selectedPlaceId !== item.id) setLocallySelected(false);
  }, [item.id, selectedPlaceId]);
  useEffect(() => () => {
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
  }, []);

  const handleDelete = () => {
    onDeleteInitiated?.(item);
    deleteTimerRef.current = setTimeout(() => {
      onDelete(item.id);
    }, 450);
  };

  const handleOpenDetail = () => {
    setLocallySelected(true);
    onPress?.(item);
    // A detail-to-detail tap replaces the existing detail instead of nesting
    // another return target. One close always gets back to My Places.
    const returnTo = overlay.kind === 'placeDetail' ? { kind: 'none' as const } : overlay;
    setOverlay({ kind: 'placeDetail', placeId: item.id, returnTo });
  };

  return (
    <Reanimated.View
      entering={recentlyAdded ? FadeInUp.springify().damping(16).stiffness(260).mass(0.56) : undefined}
      style={{ paddingHorizontal: 16 }}
    >
      <View style={[styles.cardShell, (selected || locallySelected) && styles.cardShellSelected]}>
      <ReanimatedSwipeable
        ref={swipeableRef}
        friction={2}
        rightThreshold={DELETE_BUTTON_WIDTH / 2}
        overshootRight
        overshootFriction={2}
        animationOptions={{ mass: 1, damping: 14, stiffness: 90, overshootClamping: false }}
        onSwipeableOpenStartDrag={() => onDeleteSwipeStart?.(item)}
        onSwipeableOpen={() => onDeleteSwipeSettle?.(item, true)}
        onSwipeableClose={() => onDeleteSwipeSettle?.(item, false)}
        renderRightActions={(progress) => <DeleteAction progress={progress} onDelete={handleDelete} onProgress={(value) => onDeleteSwipeProgress?.(item, value)} />}
      >
        <TouchableOpacity onPress={handleOpenDetail} activeOpacity={0.7}>
          <View style={styles.cardContent}>
            <View style={{ flex: 1 }}>
              <Text
                className="text-text-primary"
                style={[typography.h3, { marginBottom: 4 }]}
                numberOfLines={1}
              >
                {item.name}
              </Text>
              <Text
                numberOfLines={3}
                className="text-text-secondary"
                style={[typography.bodySmall, { height: 60 }]}
              >
                {item.summary}
              </Text>
            </View>
            {item.thumbnailUrl && failedImageUri !== item.thumbnailUrl ? (
              <View
                style={{
                  width: 86,
                  height: 86,
                  borderRadius: 16,
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                <Image
                  source={{ uri: item.thumbnailUrl }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                  onError={() => setFailedImageUri(item.thumbnailUrl)}
                />
              </View>
            ) : null}
          </View>
        </TouchableOpacity>
      </ReanimatedSwipeable>
      {item.tags?.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tagsRow}
          contentContainerStyle={styles.tagsRowContent}
        >
          {item.tags.map((tag) => (
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
    </Reanimated.View>
  );
});

const styles = StyleSheet.create({
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
  cardShell: {
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
  },
  tagsRowContent: {
    flexDirection: 'row',
    gap: 6,
  },
});
