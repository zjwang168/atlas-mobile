import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { TouchableOpacity, View } from 'react-native';

type LeftNavProps = {
  onSearchPress?: () => void;
  showScanButton?: boolean;
};

const glassShadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 20,
  elevation: 6,
} as const;

const buttonStyle = {
  borderRadius: 33,
  overflow: 'hidden' as const,
  ...glassShadow,
};

const blurStyle = {
  padding: 10,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

export default function LeftNav({ onSearchPress, showScanButton = false }: LeftNavProps) {
  return (
    <View className="flex-col items-center gap-2">
      {/* 搜索按钮 */}
      <TouchableOpacity
        onPress={onSearchPress}
        activeOpacity={0.8}
        style={buttonStyle}
      >
        <BlurView intensity={40} tint="light" style={blurStyle}>
          <Ionicons name="search" size={24} color="#000" />
        </BlurView>
      </TouchableOpacity>
      {showScanButton ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Scan a QR code"
          onPress={() => {}}
          activeOpacity={0.8}
          style={buttonStyle}
        >
          <BlurView intensity={40} tint="light" style={blurStyle}>
            <Ionicons name="scan-outline" size={23} color="#000" />
          </BlurView>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
