import { Text } from '@/components/ui/text';
import { memo } from 'react';
import { View } from 'react-native';
import AllPlaces from './all-places/AllPlaces';
import Atlas from './atlas/Atlas';
import type { Place } from '@/types/place';

export type PlacesView = 'allPlaces' | 'atlas';

type MyPlacesProps = {
  onPlacePress?: (place: Place) => void;
  onScroll?: (y: number) => void;
  bottomInset?: number;
  activeView?: PlacesView;
  verticalScrollEnabled?: boolean;
  /** Renders a condensed label only — used when the panel is compact. */
  compact?: boolean;
};

function MyPlaces({
  onPlacePress,
  onScroll,
  bottomInset = 0,
  activeView = 'allPlaces',
  verticalScrollEnabled = true,
  compact = false,
}: MyPlacesProps) {
  if (compact) {
    return (
      <View
        style={{
          minHeight: 40,
          justifyContent: 'center',
          paddingHorizontal: 20,
          paddingVertical: 8,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '600', color: '#09090B' }}>
          {activeView === 'atlas' ? 'Atlas' : 'Places'}
        </Text>
      </View>
    );
  }

  // The Places / Atlas switch now lives over the map, matching the full-page
  // Figma composition. Both bodies remain mounted so switching is instant and
  // does not reset their scroll/data state.
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, display: activeView === 'allPlaces' ? 'flex' : 'none' }}>
        <AllPlaces
          onScroll={onScroll}
          onPlacePress={onPlacePress}
          bottomInset={bottomInset}
          verticalScrollEnabled={verticalScrollEnabled}
        />
      </View>
      <View style={{ flex: 1, display: activeView === 'atlas' ? 'flex' : 'none' }}>
        <Atlas verticalScrollEnabled={verticalScrollEnabled} />
      </View>
    </View>
  );
}

export default memo(MyPlaces);
