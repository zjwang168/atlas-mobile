import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LeftNav from './left-nav/LeftNav';
import RightNav from './right-nav/RightNav';

type TopNavProps = {
  onSearchPress?: () => void;
  onHistoryPress?: () => void;
  onGlobePress?: () => void;
  onNavigatePress?: () => void;
};

export default function TopNav({ onSearchPress, onHistoryPress, onGlobePress, onNavigatePress }: TopNavProps) {
  const { top } = useSafeAreaInsets();

  return (
    <View
      className="absolute left-0 right-0 flex-row items-start justify-between px-4"
      style={{ top: 0, paddingTop: top + 8 }}
      pointerEvents="box-none"
    >
      <LeftNav onSearchPress={onSearchPress} onHistoryPress={onHistoryPress} />
      <RightNav onGlobePress={onGlobePress} onNavigatePress={onNavigatePress} />
    </View>
  );
}
