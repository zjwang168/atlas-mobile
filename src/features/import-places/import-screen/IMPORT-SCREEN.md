# ImportScreen

## Overview

A `@gorhom/bottom-sheet` that slides up from the bottom (92% snap height) over the home screen. The user types or pastes a link or freeform text, then taps send. Calls `onSubmit` with the raw input; closes itself (and calls `onClose`) when the user swipes it away.

## File Structure

```
src/features/import-places/import-screen/
  ImportScreen.tsx      ← this component
  IMPORT-SCREEN.md      ← this document
```

## Props

```ts
type ImportScreenProps = {
  onClose: () => void;              // sheet dismissed without submitting
  onSubmit: (text: string) => void; // user tapped send; text is trimmed raw input
};
```

## Behaviour

- On mount, reads the clipboard once. If it contains a URL, shows a "Paste copied link?" banner above the composer. Tapping "Paste" fills the input and hides the banner.
- The sheet snaps to 92% with pan-down-to-close enabled. `onClose` is called when the sheet index reaches -1 (fully closed).
- Keyboard behaviour is `"interactive"` — the sheet rides up with the keyboard.
- Send button is disabled when the input is empty (trimmed). Input max height is 120 dp before scrolling.
- "Add files" and "Screenshots" source cards are stubbed (no-op presses).
- The attach button ("+" icon) in the composer is stubbed.

## Integration

Opened by `HomeScreen` via `onOpenImport`. The parent mounts this as a full-screen `absoluteFill` overlay (with `pointerEvents="box-none"`) so the map remains visible behind it.

## Related docs

- [IMPORT-PLACES.md](../IMPORT-PLACES.md) — full flow and entry point
- [ANALYZING-SCREEN.md](../analyzing-screen/ANALYZING-SCREEN.md) — next step after submission
