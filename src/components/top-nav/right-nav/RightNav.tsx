import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { TouchableOpacity, View } from 'react-native';

type RightNavProps = {
  onGlobePress?: () => void;
  onNavigatePress?: () => void;
};

export default function RightNav({ onGlobePress, onNavigatePress }: RightNavProps) {
  return (
    <View
      style={{
        borderRadius: 33,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 20,
        elevation: 6,
      }}
    >
      <BlurView
        intensity={40}
        tint="light"
        style={{
          paddingHorizontal: 10,
          paddingVertical: 12,
          gap: 20,
          alignItems: 'center',
        }}
      >
        <TouchableOpacity onPress={onGlobePress} activeOpacity={0.7}>
          <Ionicons name="earth-outline" size={24} color="#000" />
        </TouchableOpacity>
        <TouchableOpacity onPress={onNavigatePress} activeOpacity={0.7}>
          <Ionicons name="navigate-outline" size={24} color="#000" />
        </TouchableOpacity>
      </BlurView>
    </View>
  );
}
