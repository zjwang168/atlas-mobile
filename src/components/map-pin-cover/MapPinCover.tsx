import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

type MapPinCoverProps = {
  pinSize?: number;
};

const ROAD_COLOR = 'rgba(0,0,0,0.06)';

/** Fallback cover for place/plan thumbnails with no photo — a stylized map
    (muted background + faint road lines) with a pin centered on it. Fills
    its parent; the caller owns sizing, corner radius, and overflow clipping.
    Absolutely positioned to fill (rather than `flex: 1`) so it renders
    correctly regardless of the parent's own `alignItems`/`justifyContent` —
    a `flex: 1` child shrinks to its content size instead of stretching when
    the parent doesn't use the (non-default) `alignItems: 'stretch'`. */
export function MapPinCover({ pinSize = 28 }: MapPinCoverProps) {
  return (
    <View
      className="bg-muted"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
    >
      <View style={{ position: 'absolute', top: '32%', left: '-20%', width: '140%', height: 1, backgroundColor: ROAD_COLOR, transform: [{ rotate: '-12deg' }] }} />
      <View style={{ position: 'absolute', top: '64%', left: '-20%', width: '140%', height: 1, backgroundColor: ROAD_COLOR, transform: [{ rotate: '8deg' }] }} />
      <View style={{ position: 'absolute', left: '28%', top: '-20%', height: '140%', width: 1, backgroundColor: ROAD_COLOR, transform: [{ rotate: '10deg' }] }} />
      <Ionicons
        name="location"
        size={pinSize}
        color="#12c170"
        style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3 }}
      />
    </View>
  );
}
