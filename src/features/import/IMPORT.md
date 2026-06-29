# Import Feature

## Overview

The Import flow lets users paste arbitrary text (links, notes, etc.) for Atlas to parse into structured place data. It is a two-screen flow: `ImportScreen` collects the raw input, `PreviewScreen` shows the extracted places for review before saving.

## File Structure

```
src/features/import/
  ImportScreen.tsx    ← input entry point (full-screen modal)
  PreviewScreen.tsx   ← extracted-places review sheet
  IMPORT.md           ← this document
```

---

## `ImportScreen`

Full-screen input modal. The user types or pastes a link / freeform note, then taps the send button to submit.

### Props

```ts
type ImportScreenProps = {
  onClose: () => void;              // user dismissed without submitting
  onSubmit: (text: string) => void; // user submitted; text is the raw input
};
```

### Behaviour

- Send button is disabled when the input is empty (trimmed).
- Uses `KeyboardAvoidingView` so the composer stays above the keyboard on iOS.
- The input is multiline with a max height of 150 dp before scrolling.

---

## `PreviewScreen`

Bottom sheet overlay showing the places extracted from the submitted content. The user can delete individual places before saving.

### Props

```ts
type PreviewScreenProps = {
  onClose: () => void;  // back to ImportScreen
  onSave: () => void;   // save the displayed places
};
```

### Status

The extracted places list is currently hardcoded mock data (`extractedPlaces` inside the file). Wire to a real API response when the parse endpoint is ready.

---

## Service Layer (stubs)

When wiring real import logic, use these placeholder files — **do not create new service files**:

| File | Purpose |
|---|---|
| `src/services/import/importService.ts` | Import parsing + place extraction service |
| `src/types/import.ts` | Type definitions for import payloads and responses |

Both are empty stubs. Add types to `import.ts` first, then implement `importService.ts` against those types.

---

## Screen Flow

```
BottomBar.onAddPlace
  → HomeScreen.onOpenImport
    → ImportScreen (user enters text)
      → onSubmit(text) triggers parse
        → PreviewScreen (user reviews extracted places)
          → onSave() → save to place store → dismiss
          → onClose() → back to ImportScreen
```

---

## Entry Point

`ImportScreen` is opened from `BottomBar` via the `onAddPlace` callback, which bubbles up to `HomeScreen.onOpenImport`. The navigation between `ImportScreen` → `PreviewScreen` is managed by the parent that mounts both screens (currently `app/(tabs)/index.tsx`).
