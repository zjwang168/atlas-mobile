import { View, Text } from 'react-native';

import { Place } from '../../types/place';

type MyPlacesProps = {
  onPlacePress?: (place: Place) => void;
  onScroll?: (y: number) => void;
  bottomInset?: number;
};

export default function MyPlaces({ onPlacePress, onScroll, bottomInset = 0 }: MyPlacesProps) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>My Places</Text>
    </View>
  );
}
