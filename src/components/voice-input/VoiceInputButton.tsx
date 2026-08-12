import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { WaveformIcon } from 'phosphor-react-native/src/icons/Waveform';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { transcribeAudio } from '@/services/api/apiService';

type VoiceInputButtonProps = {
  onTranscript: (text: string) => void;
  onRecordingChange?: (recording: boolean) => void;
  disabled?: boolean;
  style?: ViewStyle;
  label?: string;
  onShortPress?: () => void;
  onError?: (message: string) => void;
};

/** Hold-to-talk recorder used anywhere Atlas accepts text. */
export default function VoiceInputButton({ onTranscript, onRecordingChange, disabled, style, label, onShortPress, onError }: VoiceInputButtonProps) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setActive = useCallback((next: boolean) => {
    setRecording(next);
    onRecordingChange?.(next);
  }, [onRecordingChange]);

  const start = useCallback(async () => {
    if (disabled || processing || recording) return;
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      onError?.('Microphone access is required to transcribe your voice.');
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setActive(true);
    } catch (error) {
      console.warn('[VoiceInputButton] could not start recording', error);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      onError?.('We could not access a microphone. Check the Simulator audio input and try again.');
    }
  }, [disabled, onError, processing, recorder, recording, setActive]);

  const stop = useCallback(async () => {
    if (!recording) return;
    setActive(false);
    setProcessing(true);
    try {
      await recorder.stop();
      if (recorder.uri) {
        const result = await transcribeAudio(recorder.uri);
        if (result.text.trim()) onTranscript(result.text.trim());
      }
    } catch (error) {
      console.warn('[VoiceInputButton] transcription failed', error);
      onError?.('We could not transcribe that recording. Please try again.');
    } finally {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      setProcessing(false);
    }
  }, [onError, onTranscript, recorder, recording, setActive]);

  useEffect(() => () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Hold to speak"
      accessibilityState={{ disabled: Boolean(disabled || processing), selected: recording }}
      disabled={disabled || processing}
      onPressIn={() => {
        if (label && onShortPress) {
          holdTimer.current = setTimeout(() => { holdTimer.current = null; start(); }, 360);
        } else start();
      }}
      onPressOut={() => {
        if (holdTimer.current) {
          clearTimeout(holdTimer.current);
          holdTimer.current = null;
          onShortPress?.();
        } else stop();
      }}
      style={[styles.button, style, recording && styles.recording]}
    >
      {processing ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color="#0C8149" />
          {label ? <Text style={styles.label}>Transcribing</Text> : null}
        </View>
      ) : label ? (
        <View style={styles.labelRow}>
          <WaveformIcon size={18} weight="bold" color={recording ? '#FFFFFF' : '#0C8149'} />
          <Text style={[styles.label, recording && styles.labelRecording]}>{recording ? 'Release to send' : label}</Text>
        </View>
      ) : <WaveformIcon size={22} weight="bold" color={recording ? '#FFFFFF' : '#202024'} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  recording: { backgroundColor: '#0C8149', borderColor: '#0C8149' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  label: { color: '#0C8149', fontSize: 13, fontWeight: '700', letterSpacing: 0 },
  labelRecording: { color: '#FFFFFF' },
});
