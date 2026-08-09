import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { BlurView } from 'expo-blur';
import type { Icon } from 'phosphor-react-native';
import { BookmarkSimpleIcon } from 'phosphor-react-native/src/icons/BookmarkSimple';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { SparkleIcon } from 'phosphor-react-native/src/icons/Sparkle';
import { SuitcaseSimpleIcon } from 'phosphor-react-native/src/icons/SuitcaseSimple';
import { UserIcon } from 'phosphor-react-native/src/icons/User';
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
    label: 'Bookmarks',
    icon: BookmarkSimpleIcon,
  },
  {
    key: TAB_ADD,
    label: 'Add places',
    icon: PlusIcon,
    action: 'add',
  },
  {
    key: TAB_PLAN,
    label: 'Plan',
    icon: SuitcaseSimpleIcon,
  },
  {
    key: TAB_PROFILE,
    label: 'Profile',
    icon: UserIcon,
  },
];

function HomeTabBar({
  activeTab,
  onTabChange,
  onAddPress,
  onChatPress,
}: HomeTabBarProps) {
  const reducedMotion = useReducedMotion();
  const barScale = useSharedValue(1);
  const previousActiveTab = useRef(activeTab);

  useEffect(() => {
    if (reducedMotion) {
      barScale.value = 1;
      previousActiveTab.current = activeTab;
      return;
    }

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
  }, [activeTab, barScale, reducedMotion]);

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
    <View style={styles.host} pointerEvents="box-none">
      <Animated.View style={[styles.barShadow, barScaleStyle]}>
        <View style={styles.bar}>
          {LIQUID_GLASS_AVAILABLE ? (
            <GlassView
              pointerEvents="none"
              style={StyleSheet.absoluteFill}
              glassEffectStyle="regular"
              tintColor="rgba(250,250,250,0.40)"
            />
          ) : (
            <BlurView
              pointerEvents="none"
              style={StyleSheet.absoluteFill}
              tint="systemUltraThinMaterialLight"
              intensity={80}
            />
          )}
          <View pointerEvents="none" style={styles.frost} />
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
                  selected && styles.tabSelected,
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
    bottom: 24,
    alignItems: 'center',
  },
  barShadow: {
    width: 308,
    height: 52,
    borderRadius: 32,
    boxShadow: '0 8px 40px rgba(0,0,0,0.12)',
  },
  bar: {
    width: 308,
    height: 52,
    padding: 4,
    borderRadius: 32,
    borderCurve: 'continuous',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(250,250,250,0.18)',
  },
  frost: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(250,250,250,0.22)',
  },
  tab: {
    width: TAB_WIDTH,
    height: 44,
    borderRadius: 30,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabSelected: {
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  tabPressed: {
    opacity: 0.64,
    transform: [{ scale: 0.96 }],
  },
});
