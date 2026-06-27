import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { TouchableOpacity } from 'react-native';

type LeftNavProps = {
  onPress?: () => void;
};

const glassShadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 20,
  elevation: 6,
} as const;

export default function LeftNav({ onPress }: LeftNavProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{ borderRadius: 33, overflow: 'hidden', ...glassShadow }}
    >
      <BlurView intensity={40} tint="light" style={{ padding: 10, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="search" size={24} color="#000" />
      </BlurView>
    </TouchableOpacity>
  );
}
