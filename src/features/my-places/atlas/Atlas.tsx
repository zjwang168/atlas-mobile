import { View } from 'react-native';
import { Text } from '@/components/ui/text';

export default function Atlas() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
      <Text style={{ fontSize: 17, color: '#808080', textAlign: 'center' }}>
        Your curated atlas will appear here.
      </Text>
    </View>
  );
}
