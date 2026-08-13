import { Modal, Pressable, ScrollView, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/ui/text';
import Ionicons from '@expo/vector-icons/Ionicons';
import { TRANSPORT_OPTIONS, type TransportMode } from './constants';
import { styles } from './styles';

export function TransportPickerModal({ visible, selected, onSelect, onRemove, onClose }: { visible: boolean; selected: TransportMode | null; onSelect: (mode: TransportMode) => void; onRemove: () => void; onClose: () => void }) {
  return <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
    <Pressable onPress={onClose} style={styles.modalBackdrop}>
      <Pressable onPress={(event) => event.stopPropagation()} style={styles.modalSheet}>
        <View style={styles.modalHeader}><TouchableOpacity onPress={onClose}><Text style={styles.modalCancel}>Cancel</Text></TouchableOpacity><Text style={styles.modalTitle}>Add transport</Text><View style={{ width: 48 }} /></View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.transportOptions}>
          {TRANSPORT_OPTIONS.map((option) => <TouchableOpacity key={option.mode} onPress={() => onSelect(option.mode)} style={[styles.transportOption, selected === option.mode && styles.transportOptionSelected]}><Ionicons name={option.icon} size={21} color={selected === option.mode ? '#12C170' : '#64748B'} /><Text style={[styles.transportOptionText, selected === option.mode && styles.transportOptionTextSelected]}>{option.label}</Text></TouchableOpacity>)}
        </ScrollView>
        {selected ? <TouchableOpacity onPress={onRemove} style={styles.modalRemoveButton}><Text style={styles.modalRemoveText}>Remove transport</Text></TouchableOpacity> : null}
      </Pressable>
    </Pressable>
  </Modal>;
}
