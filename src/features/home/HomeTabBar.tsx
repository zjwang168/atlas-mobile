import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { BlurView } from 'expo-blur';
import type { Icon } from 'phosphor-react-native';
import { MapPinLineIcon } from 'phosphor-react-native/src/icons/MapPinLine';
import { ChatTeardropIcon } from 'phosphor-react-native/src/icons/ChatTeardrop';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { SparkleIcon } from 'phosphor-react-native/src/icons/Sparkle';
import { SuitcaseSimpleIcon } from 'phosphor-react-native/src/icons/SuitcaseSimple';
import { memo, useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

export const TAB_PLACES = 'myPlaces';
export const TAB_PLAN = 'travelPlan';
export const TAB_ADD = 'add';
export const TAB_PROFILE = 'profile';
export const TAB_CHAT = 'chat';

const COLOR = {
  active: '#12C170',
  icon: '#171717',
} as const;

const LIQUID_GLASS_AVAILABLE =
  isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
const TAB_WIDTH = 60;

type HomeTabBarProps = {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onAddPress: () => void;
  onChatPress: () => void;
  bottomOffset?: number;
};

type TabItem = {
  key: string;
  label: string;
  icon: Icon;
  action?: 'add' | 'chat';
};

const TAB_ITEMS: TabItem[] = [
  {
    key: TAB_CHAT,
    label: 'AI',
    icon: SparkleIcon,
    action: 'chat',
  },
  {
    key: TAB_PLACES,
    label: 'My Places',
    icon: MapPinLineIcon,
  },
  {
    key: TAB_PLAN,
    label: 'My Plan',
    icon: SuitcaseSimpleIcon,
  },
  {
    key: TAB_CHAT,
    label: 'Chat',
    icon: ChatTeardropIcon,
    action: 'chat',
  },
  {
    key: TAB_ADD,
    label: 'Add',
    icon: PlusIcon,
    action: 'add',
  },
];

function HomeTabBar({
  activeTab,
  onTabChange,
  onAddPress,
  onChatPress,
  bottomOffset = 16,
}: HomeTabBarProps) {
  const reducedMotion = useReducedMotion();
  const activeIndex = Math.max(
    0,
    TAB_ITEMS.findIndex((item) => item.key === activeTab),
  );
  const selectorX = useSharedValue(activeIndex * TAB_WIDTH);
  const barScale = useSharedValue(1);
  const previousActiveTab = useRef(activeTab);

  useEffect(() => {
    const nextX = activeIndex * TAB_WIDTH;

    if (reducedMotion) {
      selectorX.value = nextX;
      barScale.value = 1;
      previousActiveTab.current = activeTab;
      return;
    }

    selectorX.value = withSpring(nextX, {
      damping: 18,
      stiffness: 220,
      mass: 0.68,
    });

    if (previousActiveTab.current !== activeTab) {
      barScale.value = withSequence(
        withTiming(1.028, {
          duration: 90,
          easing: Easing.out(Easing.quad),
        }),
        withSpring(1, {
          damping: 15,
          stiffness: 250,
          mass: 0.58,
        }),
      );
    }

    previousActiveTab.current = activeTab;
  }, [activeIndex, activeTab, barScale, reducedMotion, selectorX]);

  const selectorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: selectorX.value }],
  }));

  const barScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: barScale.value }],
  }));

  const handlePress = useCallback((item: TabItem) => {
    if (item.action === 'add') {
      onAddPress();
      return;
    }
    if (item.action === 'chat') {
      onChatPress();
      return;
    }
    onTabChange(item.key);
  }, [onAddPress, onChatPress, onTabChange]);

  return (
    <View style={[styles.host, { bottom: bottomOffset }]} pointerEvents="box-none">
      <Animated.View
        style={[styles.barShadow, barScaleStyle]}
      >
        <View style={styles.bar}>
          {LIQUID_GLASS_AVAILABLE ? (
            <GlassView
              pointerEvents="none"
              style={StyleSheet.absoluteFill}
              glassEffectStyle="regular"
              tintColor="rgba(255,255,255,0.2)"
            />
          ) : (
            <BlurView
              pointerEvents="none"
              style={StyleSheet.absoluteFill}
              tint="systemUltraThinMaterialLight"
              intensity={80}
            />
          )}
          <Animated.View
            pointerEvents="none"
            style={[styles.selector, selectorStyle]}
          >
            <BlurView
              style={StyleSheet.absoluteFill}
              tint="systemUltraThinMaterialLight"
              intensity={40}
            />
          </Animated.View>

          {TAB_ITEMS.map((item) => {
            const selected = !item.action && item.key === activeTab;
            const IconComponent = item.icon;

            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ selected }}
                onPress={() => handlePress(item)}
                style={({ pressed }) => [
                  styles.tab,
                  pressed && styles.tabPressed,
                ]}
              >
                <IconComponent
                  size={24}
                  weight={selected ? 'fill' : 'regular'}
                  color={selected ? COLOR.active : COLOR.icon}
                />
              </Pressable>
            );
          })}
        </View>
      </Animated.View>
    </View>
  );
}

export default memo(HomeTabBar);

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 52,
    alignItems: 'center',
    zIndex: 30,
  },
  barShadow: {
    width: 248,
    height: 52,
    borderRadius: 32,
    boxShadow: '0 8px 40px rgba(0,0,0,0.20)',
  },
  bar: {
    width: 248,
    height: 52,
    padding: 4,
    borderRadius: 32,
    borderCurve: 'continuous',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  tab: {
    width: TAB_WIDTH,
    height: 44,
    borderRadius: 30,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selector: {
    position: 'absolute',
    left: 4,
    top: 4,
    width: TAB_WIDTH,
    height: 44,
    borderRadius: 30,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  tabPressed: {
    opacity: 0.64,
    transform: [{ scale: 0.96 }],
  },
});
