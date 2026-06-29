# PreviewScreen

## Overview

Bottom-sheet overlay that shows the places extracted from the user's submitted content. The user can delete individual places before confirming. Calls `onSave` to persist and dismiss, or `onClose` to go back to `ImportScreen`.

## File Structure

```
src/features/import-places/preview-screen/
  PreviewScreen.tsx     ← this component
  PREVIEW-SCREEN.md     ← this document
```

## Props

```ts
type PreviewScreenProps = {
  onClose: () => void;  // back to ImportScreen
  onSave: () => void;   // save the displayed places and dismiss
};
```

## Behaviour

- Displays a list of extracted places, each showing name, subtitle, and a type badge.
- Each place row has a delete button to remove it before saving.
- The save button label reflects the current place count (e.g. "Save 2 places").
- Rendered as a floating sheet over a semi-transparent backdrop (`rgba(0,0,0,0.22)`).

### Status

The extracted places list is currently hardcoded mock data (`extractedPlaces` inside the file). Wire to a real API response when the parse endpoint is ready — see `src/services/import/importService.ts`.

## Integration

Mounted by the parent (`App.tsx`) after `ImportScreen.onSubmit` fires. The parent controls which screen is visible; `PreviewScreen` receives no parsed data directly until the service layer is wired up.

## Related docs

- [IMPORT-PLACES.md](../IMPORT-PLACES.md) — full import flow and entry point
- [IMPORT-SCREEN.md](../import-screen/IMPORT-SCREEN.md) — previous step in the flow
