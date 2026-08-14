# VoiceInputButton

## Overview

Hold-to-talk button that records audio, transcribes it, and hands the text back — used anywhere Atlas accepts text input.

## Behaviour

### Status

- Idle: renders `icon` at `iconSize`.
- Recording: long-press starts the recorder and swaps the glyph for a waveform; releasing stops it.
- Processing: transcription is in flight, a spinner replaces the glyph.

A short press never records — it calls `onShortPress`, so the same button can double as a plain navigation control. Releasing before the recorder has finished starting is handled: the recording is stopped and transcribed once it comes up, rather than being dropped.

Microphone permission is requested on first record; denial surfaces through `onError` instead of throwing.

## API

```ts
type VoiceInputButtonProps = {
  onTranscript: (text: string) => void;      // receives the transcribed text
  onRecordingChange?: (recording: boolean) => void;  // fires on every recording start/stop
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  label?: string;                            // optional text rendered beside the glyph
  onShortPress?: () => void;                 // tap (not hold) — omit to make the button record-only
  onError?: (message: string) => void;       // permission and transcription failures
  icon?: Icon;                               // default: WaveformIcon — phosphor icon for the idle state
  iconSize?: number;                         // default: 22 — idle glyph size
  showVoiceBadge?: boolean;                  // default: false — small mic badge over the glyph
  accessibilityLabel?: string;               // default: 'Hold to speak'
};
```

## Related docs

- [SERVICES.md](../../services/SERVICES.md) — `transcribeAudio` lives there
