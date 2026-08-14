import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Animated, TouchableOpacity, View } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { Text } from '@/components/ui/text';
import { TypewriterHint } from './AtlasEmptySkeleton';
import { styles } from './styles';
import type { DraftPlace } from './types';

type AtlasCandidateCardProps = {
  place: DraftPlace | null;
  added: boolean;
  saveActionsOpen: boolean;
  savingKind: 'atlas' | 'ai' | null;
  finishDisabled: boolean;
  promptFirstAdd: boolean;
  showFinishHint: boolean;
  onAdd: () => void;
  onToggleSaveActions: () => void;
  onSave: (askAI: boolean) => void;
};

export function AtlasCandidateCard({ place, added, saveActionsOpen, savingKind, finishDisabled, promptFirstAdd, showFinishHint, onAdd, onToggleSaveActions, onSave }: AtlasCandidateCardProps) {
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
  const finishBackground = finishDisabled
    ? '#E3E9E6'
    : expand.interpolate({ inputRange: [0, 1], outputRange: ['#12C170', '#E05252'] });
  const finishIconColor = finishDisabled ? '#9AA6A0' : '#FFFFFF';
  const finishUnavailable = finishDisabled || savingKind !== null;
  const completeOpacity = expand.interpolate({ inputRange: [0, 0.45, 1], outputRange: [1, 0, 0] });
  const closeOpacity = expand.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] });
  const completeRotation = expand.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-90deg'] });
  const closeRotation = expand.interpolate({ inputRange: [0, 1], outputRange: ['90deg', '0deg'] });
  const addGlow = useRef(new Animated.Value(0)).current;
  const finishHintOpacity = useRef(new Animated.Value(0)).current;
  const [finishHintVisible, setFinishHintVisible] = useState(showFinishHint);
  const showFirstAddPrompt = promptFirstAdd && Boolean(place) && !added && !unavailable && !saveActionsOpen;
  const showCancelHint = Boolean(place) && !added && !unavailable && !saveActionsOpen;
  useEffect(() => {
    addGlow.stopAnimation();
    if (!showFirstAddPrompt) {
      addGlow.setValue(0);
      return;
    }
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(addGlow, { toValue: 1, duration: 1500, useNativeDriver: true }),
      Animated.timing(addGlow, { toValue: 0, duration: 1700, useNativeDriver: true }),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, [addGlow, showFirstAddPrompt]);
  useEffect(() => {
    if (showFinishHint) {
      setFinishHintVisible(true);
      Animated.timing(finishHintOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      return;
    }
    Animated.timing(finishHintOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setFinishHintVisible(false);
    });
  }, [finishHintOpacity, showFinishHint]);
  const glowStyle = {
    opacity: addGlow.interpolate({ inputRange: [0, 1], outputRange: [0.04, 0.22] }),
    transform: [{ scale: addGlow.interpolate({ inputRange: [0, 1], outputRange: [0.99, 1.1] }) }],
  };

  return <View style={styles.candidateSlot}>
    {place ? <>
      {description ? <Text numberOfLines={1} style={styles.candidateDescription}>{description}</Text> : null}
      <View style={styles.candidateActions}>
        {showFirstAddPrompt ? <Animated.View pointerEvents="none" style={[styles.candidateAddGlow, glowStyle]} /> : null}
        <Animated.View style={[styles.candidateActionClip, styles.candidateAddClip, { width: addWidth, opacity: addOpacity }]} pointerEvents={saveActionsOpen ? 'none' : 'auto'}>
          <TouchableOpacity accessibilityLabel={added ? `${place.name} is already in Atlas` : `Add ${place.name} to Atlas`} disabled={added || unavailable} onPress={onAdd} style={[styles.candidateAdd, (added || unavailable) && styles.candidateAddDisabled]}>
            <Text numberOfLines={1} style={styles.candidateAddText}>{place.name}</Text>
            {unavailable ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="add" size={21} color="#FFFFFF" />}
          </TouchableOpacity>
        </Animated.View>
        <Animated.View style={[styles.candidateActionClip, styles.candidateSaveClip, { width: saveWidth, opacity: saveOpacity, transform: [{ translateX: saveShift }] }]} pointerEvents={saveActionsOpen ? 'auto' : 'none'}><TouchableOpacity accessibilityLabel="Save Atlas" disabled={savingKind !== null} onPress={() => onSave(false)} style={styles.candidateSave}>{savingKind === 'atlas' ? <ActivityIndicator size="small" color="#155E46" /> : <><Ionicons name="bookmark-outline" size={14} color="#155E46" /><Text style={styles.candidateSaveText}>Save</Text></>}</TouchableOpacity></Animated.View>
        <Animated.View style={[styles.candidateActionClip, styles.candidateAskClip, { width: askWidth, opacity: saveOpacity, transform: [{ translateX: saveShift }] }]} pointerEvents={saveActionsOpen ? 'auto' : 'none'}><TouchableOpacity accessibilityLabel="Save Atlas and ask AI" disabled={savingKind !== null} onPress={() => onSave(true)} style={styles.candidateAsk}>{savingKind === 'ai' ? <ActivityIndicator size="small" color="#FFFFFF" /> : <><Ionicons name="sparkles" size={15} color="#FFFFFF" /><Text style={styles.candidateAskText}>Save and Ask AI</Text></>}</TouchableOpacity></Animated.View>
        <Animated.View style={[styles.candidateFinish, { backgroundColor: finishBackground }]}>
          <TouchableOpacity accessibilityLabel={finishDisabled ? 'Add a place before saving Atlas' : saveActionsOpen ? 'Close save actions' : 'Finish editing Atlas'} disabled={finishUnavailable} onPress={onToggleSaveActions} style={styles.candidateFinishHit}>
            <Animated.View style={[styles.candidateFinishIcon, { opacity: completeOpacity, transform: [{ rotate: completeRotation }] }]}><Ionicons name="checkmark" size={20} color={finishIconColor} /></Animated.View>
            <Animated.View style={[styles.candidateFinishIcon, { opacity: closeOpacity, transform: [{ rotate: closeRotation }] }]}><Ionicons name="close" size={20} color={finishIconColor} /></Animated.View>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </> : <>
      
      <View style={styles.candidateActions}>
        <Animated.View style={[styles.candidateActionClip, styles.candidateAddClip, { width: addWidth, opacity: addOpacity }]} pointerEvents={saveActionsOpen ? 'none' : 'auto'}>
          <View style={[styles.candidateAdd, styles.candidateAddEmpty]}><View style={styles.candidateAddEmptyCopy}><TypewriterHint text="Select a place to add" textStyle={styles.candidateAddEmptyCharacter} /></View><Ionicons name="location-outline" size={19} color="#899590" /></View>
        </Animated.View>
        <Animated.View style={[styles.candidateActionClip, styles.candidateSaveClip, { width: saveWidth, opacity: saveOpacity, transform: [{ translateX: saveShift }] }]} pointerEvents={saveActionsOpen ? 'auto' : 'none'}><TouchableOpacity accessibilityLabel="Save Atlas" disabled={savingKind !== null} onPress={() => onSave(false)} style={styles.candidateSave}>{savingKind === 'atlas' ? <ActivityIndicator size="small" color="#155E46" /> : <><Ionicons name="bookmark-outline" size={14} color="#155E46" /><Text style={styles.candidateSaveText}>Save</Text></>}</TouchableOpacity></Animated.View>
        <Animated.View style={[styles.candidateActionClip, styles.candidateAskClip, { width: askWidth, opacity: saveOpacity, transform: [{ translateX: saveShift }] }]} pointerEvents={saveActionsOpen ? 'auto' : 'none'}><TouchableOpacity accessibilityLabel="Save Atlas and ask AI" disabled={savingKind !== null} onPress={() => onSave(true)} style={styles.candidateAsk}>{savingKind === 'ai' ? <ActivityIndicator size="small" color="#FFFFFF" /> : <><Ionicons name="sparkles" size={15} color="#FFFFFF" /><Text style={styles.candidateAskText}>Save and Ask AI</Text></>}</TouchableOpacity></Animated.View>
        <Animated.View style={[styles.candidateFinish, { backgroundColor: finishBackground }]}>
          <TouchableOpacity accessibilityLabel={finishDisabled ? 'Add a place before saving Atlas' : saveActionsOpen ? 'Close save actions' : 'Finish editing Atlas'} disabled={finishUnavailable} onPress={onToggleSaveActions} style={styles.candidateFinishHit}>
            <Animated.View style={[styles.candidateFinishIcon, { opacity: completeOpacity, transform: [{ rotate: completeRotation }] }]}><Ionicons name="checkmark" size={20} color={finishIconColor} /></Animated.View>
            <Animated.View style={[styles.candidateFinishIcon, { opacity: closeOpacity, transform: [{ rotate: closeRotation }] }]}><Ionicons name="close" size={20} color={finishIconColor} /></Animated.View>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </>}
    <View pointerEvents="none" style={styles.candidateCancelHintSlot}>
      {finishHintVisible ? <Animated.View style={{ opacity: finishHintOpacity }}><Text style={styles.candidateCancelHint}>Click check to finish creating</Text></Animated.View> : <Text style={[styles.candidateCancelHint, !showCancelHint && styles.candidateCancelHintHidden]}>Tap anywhere to cancel</Text>}
    </View>
  </View>;
}
