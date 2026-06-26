import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { Text, TouchableOpacity, View } from 'react-native';

type Tab = 'myPlaces' | 'travelPlan';

type BottomBarProps = {
  activeTab?: Tab;
  onTabChange?: (tab: Tab) => void;
  onAddPlace?: () => void;
};

export default function BottomBar({
  activeTab = 'myPlaces',
  onTabChange,
  onAddPlace,
}: BottomBarProps) {
  return (
    <View
      className="absolute bottom-6 left-6 right-7 flex-row items-center justify-between z-40"
      pointerEvents="box-none"
    >
      {/* Tab pill */}
      <View
        className="overflow-hidden rounded-[32px]"
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.12,
          shadowRadius: 40,
          elevation: 8,
        }}
      >
        <BlurView intensity={30} tint="light" className="flex-row items-center p-1">
          <TouchableOpacity
            className={`w-24 rounded-[30px] items-center py-1.5 ${
              activeTab === 'myPlaces' ? 'bg-blue-700/10' : ''
            }`}
            style={{ gap: 2 }}
            onPress={() => onTabChange?.('myPlaces')}
          >
            <Ionicons
              name="location-sharp"
              size={24}
              color={activeTab === 'myPlaces' ? '#1d4ed8' : '#000'}
            />
            <Text
              className={`text-[11px] font-medium ${
                activeTab === 'myPlaces' ? 'text-blue-700' : 'text-black'
              }`}
            >
              My Places
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            className={`w-24 rounded-[30px] items-center py-1.5 ${
              activeTab === 'travelPlan' ? 'bg-blue-700/10' : ''
            }`}
            style={{ gap: 2 }}
            onPress={() => onTabChange?.('travelPlan')}
          >
            <Ionicons
              name="map-outline"
              size={24}
              color={activeTab === 'travelPlan' ? '#1d4ed8' : '#000'}
            />
            <Text
              className={`text-[11px] font-medium ${
                activeTab === 'travelPlan' ? 'text-blue-700' : 'text-black'
              }`}
            >
              Plan Mode
            </Text>
          </TouchableOpacity>
        </BlurView>
      </View>

      {/* Add place button */}
      <View
        className="overflow-hidden rounded-full"
        style={{
          width: 59,
          height: 59,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.12,
          shadowRadius: 40,
          elevation: 8,
        }}
      >
        <BlurView intensity={30} tint="light" className="flex-1">
          <TouchableOpacity
            className="flex-1 items-center justify-center"
            onPress={onAddPlace}
          >
            <View className="relative items-center justify-center">
              <Ionicons name="location-outline" size={26} color="#000" />
              <Text
                className="absolute text-black font-bold"
                style={{ fontSize: 10, bottom: 4, lineHeight: 10 }}
              >
                +
              </Text>
            </View>
          </TouchableOpacity>
        </BlurView>
      </View>
    </View>
  );
}
