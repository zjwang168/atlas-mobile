import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

/** Screen-level visual feedback for an active hold-to-talk recording. */
export function VoiceRecordingBorder({ active }: { active: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 850, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 850, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [active, pulse]);
  if (!active) return null;
  return <View pointerEvents="none" style={styles.layer}>
    <Animated.View style={[styles.fill, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.16] }) }]} />
    <Animated.View style={[styles.halo, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.26, 0.66] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.976, 1] }) }] }]} />
    <Animated.View style={[styles.border, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.52, 0.92] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.988, 1] }) }] }]} />
  </View>;
}

const styles = StyleSheet.create({
  // A broad edge-to-edge band leaves no dead gap between the display edge and
  // the recording feedback while preserving the continuous iPhone corners.
  layer: { ...StyleSheet.absoluteFill, zIndex: 999, elevation: 999, padding: 0, borderRadius: 52, overflow: 'hidden' },
  fill: { ...StyleSheet.absoluteFill, borderRadius: 52, backgroundColor: '#F1FBF5' },
  halo: { ...StyleSheet.absoluteFill, borderRadius: 52, borderWidth: 22, borderColor: '#E1F4E8' },
  border: { flex: 1, borderRadius: 52, borderWidth: 4, borderColor: '#C7E8D3', shadowColor: '#DDF3E5', shadowOpacity: 0.58, shadowRadius: 20, shadowOffset: { width: 0, height: 0 } },
});
