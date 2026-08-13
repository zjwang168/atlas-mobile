import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Animated, TouchableOpacity, View } from 'react-native';
import { useEffect, useRef } from 'react';
import { Text } from '@/components/ui/text';
import { styles } from './styles';
import type { DraftPlace } from './types';

type AtlasCandidateCardProps = {
  place: DraftPlace | null;
  added: boolean;
  saveActionsOpen: boolean;
  savingKind: 'atlas' | 'ai' | null;
  onAdd: () => void;
  onToggleSaveActions: () => void;
  onSave: (askAI: boolean) => void;
};

export function AtlasCandidateCard({ place, added, saveActionsOpen, savingKind, onAdd, onToggleSaveActions, onSave }: AtlasCandidateCardProps) {
  const unavailable = Boolean(place?.provisional);
  const expand = useRef(new Animated.Value(saveActionsOpen ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(expand, {
      toValue: saveActionsOpen ? 1 : 0,
      damping: 19,
      stiffness: 230,
      mass: 0.72,
      useNativeDriver: false,
    }).start();
  }, [expand, saveActionsOpen]);

  const addWidth = expand.interpolate({ inputRange: [0, 1], outputRange: [92, 0] });
  const addOpacity = expand.interpolate({ inputRange: [0, 0.45, 1], outputRange: [1, 0, 0] });
  const saveWidth = expand.interpolate({ inputRange: [0, 1], outputRange: [0, 58] });
  const askWidth = expand.interpolate({ inputRange: [0, 1], outputRange: [0, 102] });
  const saveOpacity = expand.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0, 1] });
  const saveShift = expand.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });
  const finishBackground = expand.interpolate({ inputRange: [0, 1], outputRange: ['#155E46', '#E05252'] });
  const completeOpacity = expand.interpolate({ inputRange: [0, 0.45, 1], outputRange: [1, 0, 0] });
  const closeOpacity = expand.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] });
  const completeRotation = expand.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-90deg'] });
  const closeRotation = expand.interpolate({ inputRange: [0, 1], outputRange: ['90deg', '0deg'] });

  return <View style={styles.candidateSlot}>
    <View style={[styles.candidateCard, !place && styles.candidateCardEmpty]}>
      {place ? <>
        <View style={styles.candidateMarker}><Ionicons name="location" size={16} color="#FFFFFF" /></View>
        <View style={styles.candidateCopy}>
          <Text numberOfLines={1} style={styles.candidateName}>{place.name}</Text>
          <Text numberOfLines={1} style={styles.candidateAddress}>{unavailable ? 'Verifying map position...' : place.subtitle || 'Selected location'}</Text>
        </View>
        <View style={styles.candidateActions}>
          {added ? <View style={styles.candidateAdded}><Ionicons name="checkmark" size={13} color="#12C170" /><Text style={styles.candidateAddedText}>Added</Text></View> : unavailable ? <View style={styles.candidateVerifying}><ActivityIndicator size="small" color="#6D4CC4" /></View> : <Animated.View style={[styles.candidateActionClip, { width: addWidth, opacity: addOpacity }]} pointerEvents={saveActionsOpen ? 'none' : 'auto'}><TouchableOpacity accessibilityLabel={`Add ${place.name} to Atlas`} onPress={onAdd} style={styles.candidateAdd}><Ionicons name="add" size={17} color="#FFFFFF" /><Text style={styles.candidateAddText}>Add place</Text></TouchableOpacity></Animated.View>}
          <Animated.View style={[styles.candidateActionClip, { width: saveWidth, opacity: saveOpacity, transform: [{ translateX: saveShift }] }]} pointerEvents={saveActionsOpen ? 'auto' : 'none'}><TouchableOpacity accessibilityLabel="Save Atlas" disabled={savingKind !== null} onPress={() => onSave(false)} style={styles.candidateSave}>{savingKind === 'atlas' ? <ActivityIndicator size="small" color="#155E46" /> : <><Ionicons name="bookmark-outline" size={14} color="#155E46" /><Text style={styles.candidateSaveText}>Save</Text></>}</TouchableOpacity></Animated.View>
          <Animated.View style={[styles.candidateActionClip, { width: askWidth, opacity: saveOpacity, transform: [{ translateX: saveShift }] }]} pointerEvents={saveActionsOpen ? 'auto' : 'none'}><TouchableOpacity accessibilityLabel="Save Atlas and ask AI" disabled={savingKind !== null} onPress={() => onSave(true)} style={styles.candidateAsk}>{savingKind === 'ai' ? <ActivityIndicator size="small" color="#FFFFFF" /> : <><Ionicons name="sparkles" size={14} color="#FFFFFF" /><Text style={styles.candidateAskText}>Save and Ask AI</Text></>}</TouchableOpacity></Animated.View>
          <Animated.View style={[styles.candidateFinish, { backgroundColor: finishBackground }]}>
            <TouchableOpacity accessibilityLabel={saveActionsOpen ? 'Close save actions' : 'Finish editing Atlas'} disabled={savingKind !== null} onPress={onToggleSaveActions} style={styles.candidateFinishHit}>
              <Animated.View style={[styles.candidateFinishIcon, { opacity: completeOpacity, transform: [{ rotate: completeRotation }] }]}><Ionicons name="checkmark" size={18} color="#FFFFFF" /></Animated.View>
              <Animated.View style={[styles.candidateFinishIcon, { opacity: closeOpacity, transform: [{ rotate: closeRotation }] }]}><Ionicons name="close" size={18} color="#FFFFFF" /></Animated.View>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </> : <>
        <View style={styles.candidateMarkerEmpty}><Ionicons name="location-outline" size={16} color="#8A9695" /></View>
        <View style={styles.candidateCopy}><Text style={styles.candidateEmptyTitle}>Choose a place on the map</Text><Text style={styles.candidateEmptySubtitle}>Its details will appear here</Text></View>
      </>}
    </View>
  </View>;
}
