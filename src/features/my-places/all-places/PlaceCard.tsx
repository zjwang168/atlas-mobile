import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { useHome } from '@/features/home/HomeContext';
import { typography } from '@/theme/typography';
import { PlaceDetail } from '@/types/place';
import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useRef } from 'react';
import { Image, ScrollView, StyleSheet, TouchableOpacity, useColorScheme, View } from 'react-native';
import ReanimatedSwipeable, { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';

type PlaceCardProps = {
  item: PlaceDetail;
  onPress?: (place: PlaceDetail) => void;
  onDelete: (id: string) => void;
};

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
export const PlaceCard = memo(function PlaceCard({ item, onPress, onDelete }: PlaceCardProps) {
  const swipeableRef = useRef<SwipeableMethods>(null);
  const { setOverlay } = useHome();
  const colorScheme = useColorScheme();
  const iconColor = colorScheme === 'dark' ? '#fafafa' : '#0a0a0a';

  const handleDelete = () => {
    swipeableRef.current?.close();
    onDelete(item.id);
  };

  const handleOpenDetail = () => {
    setOverlay({ kind: 'placeDetail', placeName: item.name });
  };

  return (
    <View style={{ paddingHorizontal: 16 }}>
      <ReanimatedSwipeable
        ref={swipeableRef}
        friction={2}
        rightThreshold={DELETE_BUTTON_WIDTH / 2}
        overshootRight
        overshootFriction={2}
        animationOptions={{ mass: 1, damping: 14, stiffness: 90, overshootClamping: false }}
        renderRightActions={(progress) => <DeleteAction progress={progress} onDelete={handleDelete} />}
      >
        <TouchableOpacity onPress={() => onPress?.(item)} activeOpacity={0.7}>
          <View style={{ flexDirection: 'row', gap: 24, alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <TouchableOpacity
                onPress={handleOpenDetail}
                activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 4 }}
              >
                <Text
                  className="text-text-primary"
                  style={[typography.h3, { flexShrink: 1 }]}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={iconColor} />
              </TouchableOpacity>
              <Text
                numberOfLines={3}
                className="text-text-secondary"
                style={[typography.bodySmall, { height: 60 }]}
              >
                {item.summary}
              </Text>
            </View>
            <View
              style={{
                width: 86,
                height: 86,
                borderRadius: 16,
                overflow: 'hidden',
                backgroundColor: '#e5e5ea',
                flexShrink: 0,
              }}
            >
              {item.thumbnailUrl ? (
                <Image
                  source={{ uri: item.thumbnailUrl }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              ) : null}
            </View>
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
  tagsRow: {
    marginTop: 12,
  },
  tagsRowContent: {
    flexDirection: 'row',
    gap: 6,
  },
});
