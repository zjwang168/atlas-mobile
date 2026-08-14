import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

const WAVE_BARS = Array.from({ length: 46 }, (_, index) => index);

/** Touch-through bottom voice field inspired by Doubao's hold-to-talk state. */
export function VoiceRecordingBorder({ active }: { active: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 760, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 760, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [active, pulse]);

  if (!active) return null;
  return <View pointerEvents="none" style={styles.layer}>
    <LinearGradient colors={['rgba(7,17,45,0)', 'rgba(21,92,184,0.13)', 'rgba(45,143,240,0.62)']} locations={[0, 0.38, 1]} style={styles.field} />
    <Animated.View style={[styles.glow, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.48, 0.78] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.08] }) }] }]} />
    <View style={styles.waveRow}>
      {WAVE_BARS.map((index) => {
        const distance = Math.abs(index - (WAVE_BARS.length - 1) / 2) / (WAVE_BARS.length / 2);
        const idleScale = 0.3 + (1 - distance) * 0.32;
        const peakScale = 0.55 + (1 - distance) * 0.45;
        const inverted = index % 3 === 0;
        return <Animated.View key={index} style={[styles.waveBar, {
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.42 + (1 - distance) * 0.28, 0.78 + (1 - distance) * 0.22] }),
          transform: [{ scaleY: pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: inverted ? [peakScale, idleScale, peakScale] : [idleScale, peakScale, idleScale] }) }],
        }]} />;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, zIndex: 999, elevation: 999, overflow: 'hidden' },
  field: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 330 },
  glow: { position: 'absolute', alignSelf: 'center', bottom: -155, width: 620, height: 360, borderRadius: 310, backgroundColor: '#75C5FF', shadowColor: '#64B9FF', shadowOpacity: 0.72, shadowRadius: 42, shadowOffset: { width: 0, height: 0 } },
  waveRow: { position: 'absolute', left: 0, right: 0, bottom: 82, height: 52, paddingHorizontal: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  waveBar: { width: 4, height: 48, borderRadius: 2, backgroundColor: '#FFFFFF' },
});
