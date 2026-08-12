import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { WaveformIcon } from 'phosphor-react-native/src/icons/Waveform';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { transcribeAudio } from '@/services/api/apiService';

type VoiceInputButtonProps = {
  onTranscript: (text: string) => void;
  onRecordingChange?: (recording: boolean) => void;
  disabled?: boolean;
  style?: ViewStyle;
  label?: string;
  onShortPress?: () => void;
  tapToToggle?: boolean;
};

/** Hold-to-talk recorder used anywhere Atlas accepts text. */
export default function VoiceInputButton({ onTranscript, onRecordingChange, disabled, style, label, onShortPress, tapToToggle = false }: VoiceInputButtonProps) {
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
    if (!permission.granted) return;
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setActive(true);
  }, [disabled, processing, recorder, recording, setActive]);

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
    } finally {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      setProcessing(false);
    }
  }, [onTranscript, recorder, recording, setActive]);

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
        if (tapToToggle) return;
        if (label && onShortPress) {
          holdTimer.current = setTimeout(() => { holdTimer.current = null; start(); }, 360);
        } else start();
      }}
      onPressOut={() => {
        if (tapToToggle) return;
        if (holdTimer.current) {
          clearTimeout(holdTimer.current);
          holdTimer.current = null;
          onShortPress?.();
        } else stop();
      }}
      onPress={() => {
        if (!tapToToggle) return;
        if (recording) void stop();
        else void start();
      }}
      style={[styles.button, recording && styles.recording, style]}
    >
      {processing ? <ActivityIndicator size="small" color="#007AFF" /> : label ? <Text style={[styles.label, recording && styles.labelRecording]}>{recording ? 'Tap to finish' : label}</Text> : <WaveformIcon size={22} weight="bold" color={recording ? '#FFFFFF' : '#202024'} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  recording: { backgroundColor: '#007AFF' },
  label: { color: '#007AFF', fontSize: 12, fontWeight: '600' },
  labelRecording: { color: '#FFFFFF' },
});
