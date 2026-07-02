# SaveScreen

## Overview

Results screen shown after a successful parse. Renders a live `MapboxMap` with the extracted places as markers, a source-link pill at the top, and a floating panel listing places with per-row checkboxes. The user can deselect places before saving or adding to a plan. This screen replaces the home screen — it is not an overlay.

## File Structure

```
src/features/import-places/save-screen/
  SaveScreen.tsx        ← this component
  SAVE-SCREEN.md        ← this document
```

## Props

```ts
type SaveScreenProps = {
  result: ParseResult;                          // from importService.parseLink()
  onClose: () => void;                          // user dismissed; return to home
  onSave: (selectedIds: string[]) => void;      // persist selected places
  onAddToPlan: (selectedIds: string[]) => void; // open plan flow with selected places
};
```

`ParseResult` / `ParsedPlace` are imported from `@/services/import/importService`.

## Behaviour

- All places start selected. Tapping a row's checkbox toggles it independently. "Deselect all" / "Select all" toggle everything.
- Tapping a place row (outside the checkbox) opens `PlaceDetail` as an overlay within this screen.
- The floating panel height is fixed at `screenHeight * 0.55` (matches `PANEL_HEIGHT.default` from `HomeContext`).
- A gradient-blur fade covers the bottom of the panel list, sitting behind the action buttons.
- Action bar: "Add to plan" uses `GlassView` (native iOS 26 Liquid Glass); "Save places" is a solid green capsule. Both pass `selectedIds` to their respective callbacks.
- The source-link pill shows `result.sourceTitle` and `result.sourceThumbnail` (if present).

## Integration

Mounted by the parent after `AnalyzingScreen` (i.e., after `parseLink()` resolves). The parent passes the `ParseResult` directly. `onClose`, `onSave`, and `onAddToPlan` are wired by the parent to control what happens next.

## Related docs

- [IMPORT-PLACES.md](../IMPORT-PLACES.md) — full flow and service types
- [ANALYZING-SCREEN.md](../analyzing-screen/ANALYZING-SCREEN.md) — previous step
- [SERVICES.md](../../../services/SERVICES.md) — importService API
