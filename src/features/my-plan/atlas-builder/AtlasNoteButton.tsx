import Ionicons from '@expo/vector-icons/Ionicons';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, TouchableOpacity, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { transcribeAtlasNoteAudio } from '@/services/api/apiService';

import { styles } from './styles';

type AtlasNoteButtonProps = {
  placeName: string;
  initialNote?: string | null;
  onSave: (note: string) => void;
};

/** A self-contained note editor: tap for text, press and hold to dictate. */
export function AtlasNoteButton({ placeName, initialNote, onSave }: AtlasNoteButtonProps) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [visible, setVisible] = useState(false);
  const [note, setNote] = useState('');
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const longPressStartedRef = useRef(false);
  const releasedBeforeStartRef = useRef(false);

  const openEditor = useCallback(() => {
    setNote(initialNote ?? '');
    setError(null);
    setVisible(true);
  }, [initialNote]);

  const resetAudioMode = useCallback(() => setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined), []);

  const transcribeRecording = useCallback(async () => {
    setRecording(false);
    setTranscribing(true);
    setVisible(true);
    try {
      await recorder.stop();
      if (!recorder.uri) throw new Error('No recording was created');
      const result = await transcribeAtlasNoteAudio(recorder.uri);
      const transcript = result.text.trim();
      if (!transcript) {
        setError('No speech was detected. Try again or type your note.');
        return;
      }
      setNote((current) => current.trim() ? `${current.trim()} ${transcript}` : transcript);
    } catch (cause) {
      console.warn('[AtlasNote] transcription failed', cause);
      setError('Voice input was not available. You can type your note instead.');
    } finally {
      await resetAudioMode();
      setTranscribing(false);
    }
  }, [recorder, resetAudioMode]);

  const stopAndTranscribe = useCallback(() => {
    if (!recording) return;
    void transcribeRecording();
  }, [recording, transcribeRecording]);

  const startRecording = useCallback(async () => {
    setNote(initialNote ?? '');
    setError(null);
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setVisible(true);
      setError('Microphone access is required for voice notes.');
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      if (releasedBeforeStartRef.current) {
        releasedBeforeStartRef.current = false;
        void transcribeRecording();
      }
    } catch (cause) {
      console.warn('[AtlasNote] recorder could not start', cause);
      await resetAudioMode();
      setVisible(true);
      setError('Voice input was not available. You can type your note instead.');
    }
  }, [initialNote, recorder, resetAudioMode, transcribeRecording]);

  const cancel = useCallback(() => {
    if (recording) void recorder.stop().catch(() => undefined);
    void resetAudioMode();
    setRecording(false);
    setTranscribing(false);
    setVisible(false);
  }, [recorder, recording, resetAudioMode]);

  useEffect(() => () => {
    void resetAudioMode();
  }, [resetAudioMode]);

  return <>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Add note for ${placeName}. Long press for voice input.`}
      accessibilityHint="Tap to type a note. Long press to record a voice note."
      disabled={transcribing}
      delayLongPress={350}
      onPressIn={() => {
        longPressStartedRef.current = false;
        releasedBeforeStartRef.current = false;
      }}
      onLongPress={() => {
        longPressStartedRef.current = true;
        void startRecording();
      }}
      onPress={() => {
        if (!longPressStartedRef.current) openEditor();
      }}
      onPressOut={() => {
        if (!longPressStartedRef.current) return;
        if (recording) void stopAndTranscribe();
        else releasedBeforeStartRef.current = true;
      }}
      style={({ pressed }) => [styles.noteButton, pressed && styles.noteButtonPressed, recording && styles.noteButtonRecording]}
    >
      {transcribing ? <ActivityIndicator size="small" color="#176C59" /> : <Ionicons name={recording ? 'mic' : 'book-outline'} size={18} color={recording ? '#FFFFFF' : '#176C59'} />}
    </Pressable>

    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent onRequestClose={cancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.noteModalBackdrop}>
        <Pressable style={styles.noteModalDismiss} onPress={cancel} />
        <View accessibilityViewIsModal style={styles.noteModal}>
          <View style={styles.noteModalHeader}>
            <View style={styles.noteModalIcon}><Ionicons name="book-outline" size={20} color="#176C59" /></View>
            <View style={styles.noteModalTitleWrap}><Text numberOfLines={1} style={styles.noteModalTitle}>Note for {placeName}</Text></View>
            <TouchableOpacity accessibilityLabel="Close note editor" onPress={cancel} style={styles.noteModalClose}><Ionicons name="close" size={18} color="#52615B" /></TouchableOpacity>
          </View>
          <TextInput
            autoFocus={!recording}
            multiline
            value={note}
            onChangeText={setNote}
            placeholder="Add a note"
            placeholderTextColor="#95A09A"
            style={styles.noteInput}
            textAlignVertical="top"
          />
          <View style={styles.noteVoiceHintRow}>
            <Ionicons name={recording ? 'mic' : 'information-circle-outline'} size={13} color={recording ? '#C65C35' : '#697A73'} />
            <Text style={[styles.noteVoiceHint, recording && styles.noteVoiceHintRecording]}>{recording ? 'Listening... release the notebook button to transcribe.' : transcribing ? 'Turning your voice into text...' : 'Long-press the notebook to use voice input.'}</Text>
          </View>
          {error ? <Text style={styles.noteError}>{error}</Text> : null}
          <View style={styles.noteModalActions}>
            <TouchableOpacity accessibilityLabel="Cancel note" disabled={recording || transcribing} onPress={cancel} style={styles.noteCancel}><Text style={styles.noteCancelText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity accessibilityLabel="Save note" disabled={recording || transcribing} onPress={() => { onSave(note.trim()); setVisible(false); }} style={[styles.noteSave, (recording || transcribing) && styles.noteSaveDisabled]}><Text style={styles.noteSaveText}>Save</Text></TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </>;
}
