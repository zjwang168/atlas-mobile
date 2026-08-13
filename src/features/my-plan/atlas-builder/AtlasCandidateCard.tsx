import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { styles } from './styles';
import type { DraftPlace } from './types';

export function AtlasCandidateCard({ place, added, onAdd }: { place: DraftPlace | null; added: boolean; onAdd: () => void }) {
  const unavailable = Boolean(place?.provisional);
  return <View style={styles.candidateSlot}>
    <View style={[styles.candidateCard, !place && styles.candidateCardEmpty]}>
      {place ? <>
        <View style={styles.candidateMarker}><Ionicons name="location" size={16} color="#FFFFFF" /></View>
        <View style={styles.candidateCopy}>
          <Text numberOfLines={1} style={styles.candidateName}>{place.name}</Text>
          <Text numberOfLines={1} style={styles.candidateAddress}>{unavailable ? 'Verifying map position...' : place.subtitle || 'Selected location'}</Text>
        </View>
        {added ? <View style={styles.candidateAdded}><Ionicons name="checkmark" size={13} color="#12C170" /><Text style={styles.candidateAddedText}>Added</Text></View> : unavailable ? <View style={styles.candidateVerifying}><ActivityIndicator size="small" color="#6D4CC4" /></View> : <TouchableOpacity accessibilityLabel={`Add ${place.name} to Atlas`} onPress={onAdd} style={styles.candidateAdd}><Ionicons name="add" size={21} color="#FFFFFF" /></TouchableOpacity>}
      </> : <>
        <View style={styles.candidateMarkerEmpty}><Ionicons name="location-outline" size={16} color="#8A9695" /></View>
        <View style={styles.candidateCopy}><Text style={styles.candidateEmptyTitle}>Choose a place on the map</Text><Text style={styles.candidateEmptySubtitle}>Its details will appear here</Text></View>
      </>}
    </View>
  </View>;
}
