import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Input } from '@/components/ui/input';

export default function PlanLocation() {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: '#e5e5ea',
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 12,
        gap: 10,
        backgroundColor: '#fafafa',
      }}
    >
      <Ionicons name="search" size={18} color="#8e8e93" />
      <Input
        placeholder="Where are you going?"
        className="flex-1 border-0 bg-transparent p-0 text-base"
        style={{ height: 22 }}
      />
    </View>
  );
}
