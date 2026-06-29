# AnalyzingScreen

## Overview

Full-screen animated overlay shown while `parseLink()` is running. Displays an animated SVG mesh-gradient background, a swaying link-preview pill, and a cancel button. Does not drive the parse itself — the parent calls `onCancel` if the user wants to abort.

## File Structure

```
src/features/import-places/analyzing-screen/
  AnalyzingScreen.tsx     ← this component
  ANALYZING-SCREEN.md     ← this document
```

## Props

```ts
type AnalyzingScreenProps = {
  url: string;             // raw text/URL shown in the preview pill
  thumbnailUri?: string;   // optional thumbnail image for the pill
  onCancel: () => void;    // user tapped Cancel or the close button
};
```

## Behaviour

- Renders as `position: absolute` covering the full screen (not inside `ContentPanel`).
- Background is a soft mint mesh gradient built from three SVG radial-gradient blobs whose centres drift continuously via Reanimated's `withRepeat`/`withTiming`.
- The link pill sways ±4° to signal active work.
- A close button (top-right) and a "Cancel" capsule (bottom) both call `onCancel`.
- The component does not know when parsing finishes — the parent transitions to `SaveScreen` when `parseLink()` resolves.

## Integration

Mounted by the parent immediately after `ImportScreen.onSubmit`. The parent simultaneously starts `parseLink(text)` and shows this screen. On resolve, the parent unmounts this screen and shows `SaveScreen` with the result.

## Related docs

- [IMPORT-PLACES.md](../IMPORT-PLACES.md) — full flow
- [IMPORT-SCREEN.md](../import-screen/IMPORT-SCREEN.md) — previous step
- [SAVE-SCREEN.md](../save-screen/SAVE-SCREEN.md) — next step
