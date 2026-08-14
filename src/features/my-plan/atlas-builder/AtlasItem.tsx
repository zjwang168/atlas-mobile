import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { Image, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { Text } from '@/components/ui/text';
import { styles } from './styles';
import { AtlasNoteButton } from './AtlasNoteButton';
import type { DraftPlace } from './types';

/** Fixed at the right edge behind the row — doesn't translate with the
    swipe. Scale and fade track swipe progress directly, matching
    PlaceCard.tsx's DeleteAction. */
function AtlasItemDeleteAction({ progress, onDelete }: { progress: SharedValue<number>; onDelete: () => void }) {
  const style = useAnimatedStyle(() => {
    const amount = Math.min(progress.value, 1);
    return { opacity: amount, transform: [{ scale: amount }] };
  });
  return (
    <Reanimated.View style={[styles.deleteReveal, style]}>
      <TouchableOpacity accessibilityLabel="Delete place" onPress={onDelete} style={styles.deleteRevealHit}>
        <Ionicons name="trash-outline" size={17} color="#FFF" />
      </TouchableOpacity>
    </Reanimated.View>
  );
}

export function AtlasItem({ item, index, onFocus, onRemove, onMove, onNote, onNoteRecordingChange }: { item: DraftPlace; index: number; onFocus: () => void; onRemove: () => void; onMove: (index: number, delta: number) => void; onNote: (note: string) => void; onNoteRecordingChange?: (recording: boolean) => void }) {
  const reorderGesture = useMemo(() => Gesture.Pan().activateAfterLongPress(180).runOnJS(true).onEnd((event) => {
    if (event.translationY > 28) onMove(index, 1);
    if (event.translationY < -28) onMove(index, -1);
  }), [index, onMove]);
  return <View style={styles.swipeShell}>
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={29}
      overshootRight
      overshootFriction={2}
      animationOptions={{ mass: 1, damping: 14, stiffness: 90, overshootClamping: false }}
      renderRightActions={(progress) => <AtlasItemDeleteAction progress={progress} onDelete={onRemove} />}
    >
      <View style={styles.item}>
        <View style={styles.orderBadge}><Text style={styles.orderBadgeText}>{index + 1}</Text></View>
        {item.photo_url ? <Image source={{ uri: item.photo_url }} style={styles.itemImage as import('react-native').ImageStyle} /> : <View style={[styles.itemImage, styles.imageFallback]}><Text style={styles.imageInitial}>{item.name.slice(0, 1).toUpperCase()}</Text></View>}
        <TouchableOpacity onPress={onFocus} style={styles.itemCopy}><Text numberOfLines={1} style={styles.itemName}>{item.name}</Text><Text numberOfLines={1} style={styles.itemAddress}>{item.subtitle}</Text>{item.note ? <Text numberOfLines={2} style={styles.itemNoteModern}>{item.note}</Text> : null}</TouchableOpacity>
        <View style={styles.noteActions}>
          <AtlasNoteButton placeName={item.name} initialNote={item.note} onSave={onNote} onRecordingChange={onNoteRecordingChange} />
        </View>
        <GestureDetector gesture={reorderGesture}><View style={styles.dragHandle}><Ionicons name="reorder-three-outline" size={23} color="#66737C" /></View></GestureDetector>
      </View>
    </ReanimatedSwipeable>
  </View>;
}
