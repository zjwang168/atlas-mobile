import BottomSheet, {
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';

import { useMemo } from 'react';

import {
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import MapView, { Marker } from 'react-native-maps';

import { mockPlaces } from '../../data/mockPlaces';

type HomeScreenProps = {
  onOpenImport: () => void;
};

export default function HomeScreen({
  onOpenImport,
}: HomeScreenProps) {
  const snapPoints = useMemo(
    () => ['18%', '42%', '82%'],
    []
  );

  return (
    <View className="flex-1">
      <MapView
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        initialRegion={{
          latitude: 47.6062,
          longitude: -122.3321,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }}
      >
        {mockPlaces.map((place) => (
          <Marker
            key={place.id}
            coordinate={{
              latitude: place.latitude,
              longitude: place.longitude,
            }}
            title={place.name}
            description={place.subtitle}
          />
        ))}
      </MapView>

      <TouchableOpacity className="absolute top-[70px] right-6 w-14 h-14 rounded-full bg-white/95 items-center justify-center shadow-sm z-10">
        <Text className="text-[26px]">🐶</Text>
      </TouchableOpacity>

      <BottomSheet
        index={1}
        snapPoints={snapPoints}
        enablePanDownToClose={false}
        backgroundStyle={{
          backgroundColor: 'rgba(244,244,245,0.95)',
          borderTopLeftRadius: 34,
          borderTopRightRadius: 34,
        }}
        handleIndicatorStyle={{
          width: 44,
          height: 5,
          borderRadius: 999,
          backgroundColor: '#d4d4d8',
        }}
      >
        <BottomSheetScrollView
          contentContainerStyle={{
            paddingHorizontal: 22,
            paddingTop: 12,
            paddingBottom: 130,
          }}
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-lg font-bold text-zinc-400 mb-3.5">
            Recent
          </Text>

          {mockPlaces.map((place) => (
            <View
              key={place.id}
              className="py-4 border-b border-zinc-200"
            >
              <Text className="text-xl font-bold text-black">
                {place.name}
              </Text>

              <Text className="mt-1.25 text-base text-zinc-400">
                {place.subtitle}
              </Text>
            </View>
          ))}

          <View className="h-25" />
        </BottomSheetScrollView>
      </BottomSheet>

      <View className="absolute left-5.5 right-5.5 bottom-7 flex-row items-center gap-3 z-20">
        <TouchableOpacity className="w-14.5 h-14.5 rounded-full bg-white/96 items-center justify-center">
          <Text className="text-[30px] text-black">⌕</Text>
        </TouchableOpacity>

        <View className="flex-1 h-13 rounded-[26px] bg-white/96 justify-center px-4.5">
          <Text className="text-base text-zinc-400">
            Ask, search, or make...
          </Text>
        </View>

        <TouchableOpacity
          className="w-14.5 h-14.5 rounded-full bg-white/96 items-center justify-center"
          onPress={onOpenImport}
        >
          <Text className="text-[34px] leading-[36px] text-black">＋</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
