import { BlurView } from 'expo-blur';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { GlobeHemisphereWestIcon } from 'phosphor-react-native/src/icons/GlobeHemisphereWest';
import { NavigationArrowIcon } from 'phosphor-react-native/src/icons/NavigationArrow';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

const LIQUID_GLASS_AVAILABLE =
  isGlassEffectAPIAvailable() && isLiquidGlassAvailable();

type RightNavProps = {
  onGlobePress?: () => void;
  onNavigatePress?: () => void;
};

const glassShadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 20,
  elevation: 8,
} as const;

export default function RightNav({ onGlobePress, onNavigatePress }: RightNavProps) {
  return (
    <View style={{ borderRadius: 99, ...glassShadow }}>
      <View style={{ borderRadius: 99, overflow: 'hidden' }}>
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
      <View
        style={{ paddingHorizontal: 10, paddingVertical: 12, gap: 20, alignItems: 'center' }}
      >
        <TouchableOpacity onPress={onGlobePress} activeOpacity={0.7}>
          <GlobeHemisphereWestIcon size={24} weight="fill" color="#171717" />
        </TouchableOpacity>
        <TouchableOpacity onPress={onNavigatePress} activeOpacity={0.7}>
          <NavigationArrowIcon size={24} weight="regular" color="#171717" />
        </TouchableOpacity>
      </View>
      </View>
    </View>
  );
}
