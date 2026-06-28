import Ionicons from '@expo/vector-icons/Ionicons';
import { GlassView } from 'expo-glass-effect';
import { useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const BUTTON_SIZE = 59;
const MENU_WIDTH = 196;
const MENU_HEIGHT = 100;

type Tab = 'myPlaces' | 'travelPlan';

type BottomBarProps = {
  onTabChange?: (tab: Tab) => void;
  onAddPlace?: () => void;
};

const glassShadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 40,
  elevation: 8,
} as const;

export default function BottomBar({ onTabChange, onAddPlace }: BottomBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  const openMenu = () => {
    setMenuOpen(true);
    Animated.spring(anim, { toValue: 1, tension: 180, friction: 22, useNativeDriver: false }).start();
  };

  const closeMenu = (after?: () => void) => {
    Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: false }).start(({ finished }) => {
      if (finished) { setMenuOpen(false); after?.(); }
    });
  };

  const width = anim.interpolate({ inputRange: [0, 1], outputRange: [BUTTON_SIZE, MENU_WIDTH] });
  const height = anim.interpolate({ inputRange: [0, 1], outputRange: [BUTTON_SIZE, MENU_HEIGHT] });
  const radius = anim.interpolate({ inputRange: [0, 1], outputRange: [BUTTON_SIZE / 2, 32] });
  const addOpacity = anim.interpolate({ inputRange: [0, 0.25, 1], outputRange: [1, 0, 0] });
  const menuOpacity = anim.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] });

  return (
    // Full-screen container, always box-none so closed-state touches fall through to the map
    <View style={[StyleSheet.absoluteFill, { zIndex: 40 }]} pointerEvents="box-none">

      {/* Backdrop — fades with the morph animation; non-interactive when menu is closed */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]} pointerEvents={menuOpen ? 'auto' : 'none'}>
        <TouchableOpacity style={StyleSheet.absoluteFill} className="bg-background/40" activeOpacity={1} onPress={() => closeMenu()} />
      </Animated.View>

      {/* Morphing button → menu */}
      <Animated.View style={[styles.morphContainer, glassShadow, { width, height, borderRadius: radius }]}>
        <GlassView style={StyleSheet.absoluteFill} />

        {/* Add icon — fades out as menu opens */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.centered, { opacity: addOpacity }]} pointerEvents="none">
          <Ionicons name="add" size={30} color="#000" />
        </Animated.View>

        {/* Menu rows — fades in */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: menuOpacity, paddingVertical: 4, paddingHorizontal: 10, justifyContent: 'center' }]}>
          <TouchableOpacity style={styles.row} onPress={() => closeMenu(onAddPlace)} activeOpacity={0.7}>
            <Ionicons name="location-outline" size={24} color="#000" />
            <Text style={styles.rowText}>Import places</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => closeMenu(() => onTabChange?.('travelPlan'))} activeOpacity={0.7}>
            <Ionicons name="chatbubble-ellipses-outline" size={24} color="#000" />
            <Text style={styles.rowText}>Chat with AI</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Tap target — only active when closed */}
        {!menuOpen && (
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={openMenu} activeOpacity={0.8} />
        )}
      </Animated.View>

    </View>
  );
}

const styles = StyleSheet.create({
  morphContainer: {
    position: 'absolute',
    bottom: 24,
    right: 28,
    overflow: 'hidden',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
  },
  rowText: {
    fontSize: 16,
    color: '#000',
  },
});
