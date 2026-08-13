import Ionicons from '@expo/vector-icons/Ionicons';
import { TouchableOpacity } from 'react-native';
import { Text } from '@/components/ui/text';
import { TRANSPORT_OPTIONS, type TransportMode } from './constants';
import { styles } from './styles';

export function TimeInsert({ onPress }: { onPress: () => void }) {
  return <TouchableOpacity accessibilityLabel="Add a time divider" onPress={onPress} style={styles.transportInsertButton}><Ionicons name="time-outline" size={13} color="#64748B" /><Text style={styles.dividerAddText}>Add time</Text></TouchableOpacity>;
}

export function TransportInsert({ mode, onPress }: { mode: TransportMode | null; onPress: () => void }) {
  const option = TRANSPORT_OPTIONS.find((entry) => entry.mode === mode);
  return <TouchableOpacity accessibilityLabel="Add transport" onPress={onPress} style={[styles.transportInsertButton, option && styles.transportInsertButtonSelected]}>
    <Ionicons name={option?.icon ?? 'swap-horizontal-outline'} size={13} color={option ? '#12C170' : '#64748B'} />
    {!option ? <Text style={styles.dividerAddText}>Add transport</Text> : null}
  </TouchableOpacity>;
}
