import { BlurView } from 'expo-blur';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

const LIQUID_GLASS_AVAILABLE =
  isGlassEffectAPIAvailable() && isLiquidGlassAvailable();

type LeftNavProps = {
  onSearchPress?: () => void;
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

export default function LeftNav({ onSearchPress }: LeftNavProps) {
  return (
    <View className="flex-col items-center gap-2">
      <TouchableOpacity
        onPress={onSearchPress}
        activeOpacity={0.8}
        style={buttonStyle}
      >
        {LIQUID_GLASS_AVAILABLE ? (
          <GlassView
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            glassEffectStyle="regular"
          tintColor="rgba(255,255,255,0.1)"
          />
        ) : (
          <BlurView
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            intensity={40}
            tint="light"
          />
        )}
        <View style={blurStyle}>
          <MagnifyingGlassIcon size={24} weight="regular" color="#171717" />
        </View>
      </TouchableOpacity>
    </View>
  );
}
