import { View } from 'react-native';
import LeftNav from './left-nav/LeftNav';
import RightNav from './right-nav/RightNav';

type TopNavProps = {
  onSearchPress?: () => void;
  onGlobePress?: () => void;
  onNavigatePress?: () => void;
};

export default function TopNav({ onSearchPress, onGlobePress, onNavigatePress }: TopNavProps) {
  return (
    <View
      className="absolute top-0 left-0 right-0 flex-row items-start justify-between pt-14 px-3 z-30"
      pointerEvents="box-none"
    >
      <LeftNav onPress={onSearchPress} />
      <RightNav onGlobePress={onGlobePress} onNavigatePress={onNavigatePress} />
    </View>
  );
}
