import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const BUTTON_SIZE = 59;
const MENU_WIDTH = 196;
const MENU_HEIGHT = 100;

type Tab = 'myPlaces' | 'travelPlan';

type BottomBarProps = {
  activeTab?: Tab;
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

export default function BottomBar({ activeTab = 'myPlaces', onTabChange, onAddPlace }: BottomBarProps) {
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

      {/* Tab pill */}
      <View style={[styles.pill, glassShadow]}>
        <BlurView intensity={30} tint="light" style={styles.pillBlur}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'myPlaces' && styles.tabActive]}
            onPress={() => onTabChange?.('myPlaces')}
          >
            <Ionicons name="location-sharp" size={24} color={activeTab === 'myPlaces' ? '#12c170' : '#000'} />
            <Text style={[styles.tabLabel, activeTab === 'myPlaces' && styles.tabLabelActive]}>My Places</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === 'travelPlan' && styles.tabActive]}
            onPress={() => onTabChange?.('travelPlan')}
          >
            <Ionicons name="map-outline" size={24} color={activeTab === 'travelPlan' ? '#12c170' : '#000'} />
            <Text style={[styles.tabLabel, activeTab === 'travelPlan' && styles.tabLabelActive]}>Plan Mode</Text>
          </TouchableOpacity>
        </BlurView>
      </View>

      {/* Backdrop — fades with the morph animation; non-interactive when menu is closed */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]} pointerEvents={menuOpen ? 'auto' : 'none'}>
        <TouchableOpacity style={StyleSheet.absoluteFill} className="bg-background/40" activeOpacity={1} onPress={() => closeMenu()} />
      </Animated.View>

      {/* Morphing button → menu */}
      <Animated.View style={[styles.morphContainer, glassShadow, { width, height, borderRadius: radius }]}>
        <BlurView intensity={30} tint="light" style={StyleSheet.absoluteFill} />

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
  pill: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    borderRadius: 32,
    overflow: 'hidden',
  },
  pillBlur: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
  },
  tab: {
    width: 96,
    borderRadius: 30,
    alignItems: 'center',
    paddingVertical: 6,
    gap: 2,
  },
  tabActive: {
    backgroundColor: '#e9fbf1',
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#000',
  },
  tabLabelActive: {
    color: '#12c170',
  },
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
