import { Text, TouchableOpacity, View } from 'react-native';

type BottomBarProps = {
  onOpenImport: () => void;
};

export default function BottomBar({ onOpenImport }: BottomBarProps) {
  return (
    <View className="absolute left-5.5 right-5.5 bottom-7 flex-row items-center gap-3 z-40">
      <TouchableOpacity className="w-14.5 h-14.5 rounded-full bg-white/96 items-center justify-center">
        <Text className="text-[30px] text-black">⌕</Text>
      </TouchableOpacity>

      <View className="flex-1 h-13 rounded-[26px] bg-white/96 justify-center px-4.5">
        <Text className="text-base text-prose-muted">
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
  );
}
