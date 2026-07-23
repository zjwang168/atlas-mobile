import Ionicons from '@expo/vector-icons/Ionicons';
import { GlassView } from 'expo-glass-effect';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type AddMenuProps = {
  visible: boolean;
  onClose: () => void;
  onImportPlaces: () => void;
};

/**
 * Pop-up menu anchored to the bottom-right "+" tab. Springs open from its
 * bottom-right corner to approximate the native pull-down feel. Rendered as an
 * RN overlay so it sits above the native tab controller.
 */
export default function AddMenu({ visible, onClose, onImportPlaces }: AddMenuProps) {
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.spring(anim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 16,
        stiffness: 240,
        mass: 0.8,
      }).start();
    } else {
      Animated.timing(anim, {
        toValue: 0,
        duration: 140,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, anim]);

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Tap-outside backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* Menu card — grows from its bottom-right corner. Only `scale` is
          animated (no opacity): animating opacity on the container breaks
          GlassView's live sampling, so the glass would render transparent. */}
      <Animated.View
        style={[
          styles.card,
          {
            bottom: insets.bottom + 60,
            transform: [{ scale: anim }],
          },
        ]}
      >
        <GlassView style={StyleSheet.absoluteFill} isInteractive />
        <View style={styles.glass}>
          <Pressable style={styles.row} onPress={onImportPlaces}>
            <Ionicons name="location-outline" size={22} color="#000" />
            <Text style={styles.rowText}>Import places</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    right: 16,
    width: 190,
    borderRadius: 24,
    overflow: 'hidden',
    transformOrigin: 'right bottom',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },
  glass: {
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowText: {
    fontSize: 16,
    color: '#000',
  },
});
