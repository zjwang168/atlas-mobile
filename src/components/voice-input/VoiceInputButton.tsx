import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import type { Icon, IconWeight } from 'phosphor-react-native';
import { MicrophoneIcon } from 'phosphor-react-native/src/icons/Microphone';
import { WaveformIcon } from 'phosphor-react-native/src/icons/Waveform';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { transcribeAudio } from '@/services/api/apiService';

type VoiceInputButtonProps = {
  onTranscript: (text: string) => void;
  onRecordingChange?: (recording: boolean) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  label?: string;
  onShortPress?: () => void;
  onError?: (message: string) => void;
  icon?: Icon;
  iconSize?: number;
  iconWeight?: IconWeight;
  iconColor?: string;
  showVoiceBadge?: boolean;
  accessibilityLabel?: string;
};

/** Hold-to-talk recorder used anywhere Atlas accepts text. */
export default function VoiceInputButton({ onTranscript, onRecordingChange, disabled, style, label, onShortPress, onError, icon: IconComponent = WaveformIcon, iconSize = 22, iconWeight = 'bold', iconColor = '#202024', showVoiceBadge = false, accessibilityLabel = 'Hold to speak' }: VoiceInputButtonProps) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const longPressStarted = useRef(false);
  const releasePending = useRef(false);
  const shortPressHandled = useRef(false);

  const openShortPress = useCallback(() => {
    if (longPressStarted.current || shortPressHandled.current) return;
    shortPressHandled.current = true;
    onShortPress?.();
  }, [onShortPress]);

  const setActive = useCallback((next: boolean) => {
    setRecording(next);
    onRecordingChange?.(next);
  }, [onRecordingChange]);

  const start = useCallback(async () => {
    if (disabled || processing || recording) return;
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      onRecordingChange?.(false);
      onError?.('Microphone access is required to transcribe your voice.');
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setActive(true);
      if (releasePending.current) {
        releasePending.current = false;
        await recorder.stop();
        setActive(false);
        setProcessing(true);
        if (recorder.uri) {
          const result = await transcribeAudio(recorder.uri);
          if (result.text.trim()) onTranscript(result.text.trim());
        }
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
        setProcessing(false);
      }
    } catch (error) {
      console.warn('[VoiceInputButton] could not start recording', error);
      onRecordingChange?.(false);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
      onError?.('We could not access a microphone. Check the Simulator audio input and try again.');
    }
  }, [disabled, onError, onRecordingChange, processing, recorder, recording, setActive]);

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
    releasePending.current = false;
  }, []);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled || processing), selected: recording }}
      disabled={disabled || processing}
      onPressIn={() => {
        releasePending.current = false;
        longPressStarted.current = false;
        shortPressHandled.current = false;
      }}
      delayLongPress={360}
      onLongPress={() => {
        longPressStarted.current = true;
        // Surface feedback at hold confirmation, before permission and audio
        // setup finish. Otherwise a quick hold can feel like it never began.
        onRecordingChange?.(true);
        void start();
      }}
      onPress={() => {
        openShortPress();
      }}
      // Atlas rows own a horizontal PanResponder. It can cancel Pressable's
      // synthesized onPress after a tiny finger drift, so keep the raw touch
      // end as a short-tap fallback.
      onTouchEnd={() => openShortPress()}
      onPressOut={() => {
        if (!longPressStarted.current) return;
        if (recording) void stop();
        else releasePending.current = true;
      }}
      style={[styles.button, style, recording && styles.recording]}
    >
      {processing ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color="#167A54" />
          {label ? <Text numberOfLines={1} style={styles.label}>Transcribing</Text> : null}
        </View>
      ) : label ? (
        <View style={styles.labelRow}>
          <WaveformIcon size={18} weight="bold" color={recording ? '#FFFFFF' : '#167A54'} />
          <Text numberOfLines={1} style={[styles.label, recording && styles.labelRecording]}>{recording ? 'Release to send' : label}</Text>
        </View>
      ) : (
        <View style={styles.iconWrap}>
          <IconComponent size={iconSize} weight={iconWeight} color={recording ? '#FFFFFF' : iconColor} />
          {showVoiceBadge ? (
            <View style={[styles.voiceBadge, recording && styles.voiceBadgeRecording]}>
              <MicrophoneIcon size={8} weight="fill" color={recording ? '#0C8149' : '#FFFFFF'} />
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  recording: { backgroundColor: '#167A54', borderColor: '#167A54' },
  iconWrap: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  voiceBadge: { position: 'absolute', right: -3, bottom: -2, width: 11, height: 11, borderRadius: 5.5, backgroundColor: '#0C8149', borderWidth: 1.5, borderColor: '#EEF6FD', alignItems: 'center', justifyContent: 'center' },
  voiceBadgeRecording: { backgroundColor: '#FFFFFF', borderColor: '#0C8149' },
  labelRow: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusRow: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 7 },
  label: { flexShrink: 1, color: '#167A54', fontSize: 13, fontWeight: '700', letterSpacing: 0 },
  labelRecording: { color: '#FFFFFF' },
});
