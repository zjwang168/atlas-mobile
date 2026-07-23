import { memo, useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs } from 'react-native-screens';

const ICON_PLACES = require('../../../assets/tabs/tab-places.png');
const ICON_PLACES_FILL = require('../../../assets/tabs/tab-places-fill.png');
const ICON_PLAN = require('../../../assets/tabs/tab-plan.png');
const ICON_PLAN_FILL = require('../../../assets/tabs/tab-plan-fill.png');
const ICON_ADD = require('../../../assets/tabs/tab-add.png');

export const TAB_PLACES = 'myPlaces';
export const TAB_PLAN = 'travelPlan';
export const TAB_ADD = 'add';

const TAB_BAR_HOST_HEIGHT = 64;

type HomeTabBarProps = {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onAddPress: () => void;
};

function HomeTabBar({ activeTab, onTabChange, onAddPress }: HomeTabBarProps) {
  const insets = useSafeAreaInsets();
  const [provenance, setProvenance] = useState(0);

  const handleTabSelected = useCallback((e: any) => {
    const { selectedScreenKey, provenance: p } = e.nativeEvent;
    setProvenance(p);
    if (selectedScreenKey === TAB_ADD) {
      onAddPress();
    } else {
      onTabChange(selectedScreenKey);
    }
  }, [onTabChange, onAddPress]);

  const handleTabSelectionPrevented = useCallback(() => {
    onAddPress();
  }, [onAddPress]);

  return (
    <View
      style={[styles.host, { height: TAB_BAR_HOST_HEIGHT + insets.bottom }]}
      pointerEvents="box-none"
    >
      <Tabs.Host
        navStateRequest={{ selectedScreenKey: activeTab, baseProvenance: provenance }}
        onTabSelected={handleTabSelected}
        onTabSelectionPrevented={handleTabSelectionPrevented}
        nativeContainerStyle={{ backgroundColor: 'transparent' }}
        ios={{ tabBarMinimizeBehavior: 'onScrollDown', tabBarTintColor: '#12C170' }}
      >
        <Tabs.Screen
          screenKey={TAB_PLACES}
          title="My Places"
          ios={{
            icon: { type: 'templateSource', templateSource: ICON_PLACES },
            selectedIcon: { type: 'templateSource', templateSource: ICON_PLACES_FILL },
          }}
        >
          <View style={styles.screen} pointerEvents="none" />
        </Tabs.Screen>

        <Tabs.Screen
          screenKey={TAB_PLAN}
          title="My Plan"
          ios={{
            icon: { type: 'templateSource', templateSource: ICON_PLAN },
            selectedIcon: { type: 'templateSource', templateSource: ICON_PLAN_FILL },
          }}
        >
          <View style={styles.screen} pointerEvents="none" />
        </Tabs.Screen>

        <Tabs.Screen
          screenKey={TAB_ADD}
          title="Add"
          preventNativeSelection
          ios={{ systemItem: 'search', icon: { type: 'imageSource', imageSource: ICON_ADD } }}
        >
          <View style={styles.screen} pointerEvents="none" />
        </Tabs.Screen>
      </Tabs.Host>
    </View>
  );
}

export default memo(HomeTabBar);

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  screen: {
    flex: 1,
  },
});
