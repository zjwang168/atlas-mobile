import { memo } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LeftNav from './left-nav/LeftNav';
import RightNav from './right-nav/RightNav';

type TopNavProps = {
  onSearchPress?: () => void;
  hideSearchButton?: boolean;
  showScanButton?: boolean;
  onGlobePress?: () => void;
  onNavigatePress?: () => void;
};

function TopNav({ onSearchPress, hideSearchButton = false, showScanButton = false, onGlobePress, onNavigatePress }: TopNavProps) {
  const { top } = useSafeAreaInsets();

  return (
      <View
      className="absolute left-0 right-0 flex-row items-start justify-between px-4"
      style={{ top: 0, paddingTop: top + 8 }}
      pointerEvents="box-none"
    >
      {hideSearchButton ? <View /> : <LeftNav onSearchPress={onSearchPress} showScanButton={showScanButton} />}
      <RightNav onGlobePress={onGlobePress} onNavigatePress={onNavigatePress} />
    </View>
  );
}

export default memo(TopNav);
