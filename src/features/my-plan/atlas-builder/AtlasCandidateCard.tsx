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
  const description = unavailable ? 'Verifying map position...' : place?.subtitle;
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

  const addWidth = expand.interpolate({ inputRange: [0, 1], outputRange: [230, 0] });
  const addOpacity = expand.interpolate({ inputRange: [0, 0.45, 1], outputRange: [1, 0, 0] });
  const saveWidth = expand.interpolate({ inputRange: [0, 1], outputRange: [0, 64] });
  const askWidth = expand.interpolate({ inputRange: [0, 1], outputRange: [0, 158] });
  const saveOpacity = expand.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0, 1] });
  const saveShift = expand.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });
  const finishBackground = expand.interpolate({ inputRange: [0, 1], outputRange: ['#12C170', '#E05252'] });
  const completeOpacity = expand.interpolate({ inputRange: [0, 0.45, 1], outputRange: [1, 0, 0] });
  const closeOpacity = expand.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] });
  const completeRotation = expand.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-90deg'] });
  const closeRotation = expand.interpolate({ inputRange: [0, 1], outputRange: ['90deg', '0deg'] });

  return <View style={styles.candidateSlot}>
    {place ? <>
      {description ? <Text numberOfLines={1} style={styles.candidateDescription}>{description}</Text> : null}
      <View style={styles.candidateActions}>
        <Animated.View style={[styles.candidateActionClip, styles.candidateAddClip, { width: addWidth, opacity: addOpacity }]} pointerEvents={saveActionsOpen ? 'none' : 'auto'}>
          <TouchableOpacity accessibilityLabel={added ? `${place.name} is already in Atlas` : `Add ${place.name} to Atlas`} disabled={added || unavailable} onPress={onAdd} style={[styles.candidateAdd, (added || unavailable) && styles.candidateAddDisabled]}>
            <Text numberOfLines={1} style={styles.candidateAddText}>{place.name}</Text>
            {unavailable ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="add" size={21} color="#FFFFFF" />}
          </TouchableOpacity>
        </Animated.View>
        <Animated.View style={[styles.candidateActionClip, styles.candidateSaveClip, { width: saveWidth, opacity: saveOpacity, transform: [{ translateX: saveShift }] }]} pointerEvents={saveActionsOpen ? 'auto' : 'none'}><TouchableOpacity accessibilityLabel="Save Atlas" disabled={savingKind !== null} onPress={() => onSave(false)} style={styles.candidateSave}>{savingKind === 'atlas' ? <ActivityIndicator size="small" color="#155E46" /> : <><Ionicons name="bookmark-outline" size={14} color="#155E46" /><Text style={styles.candidateSaveText}>Save</Text></>}</TouchableOpacity></Animated.View>
        <Animated.View style={[styles.candidateActionClip, styles.candidateAskClip, { width: askWidth, opacity: saveOpacity, transform: [{ translateX: saveShift }] }]} pointerEvents={saveActionsOpen ? 'auto' : 'none'}><TouchableOpacity accessibilityLabel="Save Atlas and ask AI" disabled={savingKind !== null} onPress={() => onSave(true)} style={styles.candidateAsk}>{savingKind === 'ai' ? <ActivityIndicator size="small" color="#FFFFFF" /> : <><Ionicons name="sparkles" size={15} color="#FFFFFF" /><Text style={styles.candidateAskText}>Save and Ask AI</Text></>}</TouchableOpacity></Animated.View>
        <Animated.View style={[styles.candidateFinish, { backgroundColor: finishBackground }]}>
          <TouchableOpacity accessibilityLabel={saveActionsOpen ? 'Close save actions' : 'Finish editing Atlas'} disabled={savingKind !== null} onPress={onToggleSaveActions} style={styles.candidateFinishHit}>
            <Animated.View style={[styles.candidateFinishIcon, { opacity: completeOpacity, transform: [{ rotate: completeRotation }] }]}><Ionicons name="checkmark" size={20} color="#FFFFFF" /></Animated.View>
            <Animated.View style={[styles.candidateFinishIcon, { opacity: closeOpacity, transform: [{ rotate: closeRotation }] }]}><Ionicons name="close" size={20} color="#FFFFFF" /></Animated.View>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </> : <Text style={styles.candidateEmptyTitle}>Choose a place on the map to add it to this atlas</Text>}
  </View>;
}
