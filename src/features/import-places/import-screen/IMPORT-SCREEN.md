# ImportScreen

## Overview

Full-screen modal where the user types or pastes a link, note, or any freeform text for Atlas to parse into places. Calls `onSubmit` with the raw input when the user taps send, or `onClose` when dismissed without submitting.

## File Structure

```
src/features/import-places/import-screen/
  ImportScreen.tsx      ← this component
  IMPORT-SCREEN.md      ← this document
```

## Props

```ts
type ImportScreenProps = {
  onClose: () => void;              // user dismissed without submitting
  onSubmit: (text: string) => void; // user submitted; text is the raw input
};
```

## Behaviour

- Send button is disabled when the input is empty (trimmed).
- Uses `KeyboardAvoidingView` so the composer stays above the keyboard on iOS.
- The input is multiline with a max height of 150 dp before scrolling.

## Integration

Opened from `BottomBar` via `onAddPlace` → `HomeScreen.onOpenImport`. The parent (`App.tsx`) mounts this screen as a full-screen overlay and passes `onSubmit` to transition to `PreviewScreen`.

## Related docs

- [IMPORT-PLACES.md](../IMPORT-PLACES.md) — full import flow and entry point
- [PREVIEW-SCREEN.md](../preview-screen/PREVIEW-SCREEN.md) — next step after submission
