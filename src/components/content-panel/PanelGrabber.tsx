import { useMemo } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

type PanelGrabberProps = {
  accessibilityLabel?: string;
  onDragEnd: (translationY: number) => void;
};

const DRAG_THRESHOLD = 28;

/** The only vertical-drag affordance inside a panel page. */
export default function PanelGrabber({
  accessibilityLabel = 'Resize panel',
  onDragEnd,
}: PanelGrabberProps) {
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => (
      Math.abs(gesture.dy) > Math.abs(gesture.dx)
    ),
    onPanResponderRelease: (_, gesture) => {
      if (Math.abs(gesture.dy) < DRAG_THRESHOLD) return;
      onDragEnd(gesture.dy);
    },
    onPanResponderTerminate: (_, gesture) => {
      if (Math.abs(gesture.dy) < DRAG_THRESHOLD) return;
      onDragEnd(gesture.dy);
    },
  }), [onDragEnd]);

  return (
    <View
      {...panResponder.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      style={styles.touchArea}
    >
      <View pointerEvents="none" style={styles.bar} />
    </View>
  );
}

const styles = StyleSheet.create({
  touchArea: {
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(60,60,67,0.25)',
  },
});
