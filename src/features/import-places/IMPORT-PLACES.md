# Import Places Feature

## Overview

The Import Places flow lets users paste a URL or freeform text for Atlas to parse into structured place data. It is a four-screen flow: `ImportScreen` collects the raw input, `AnalyzingScreen` shows an animated state while the parse runs, `SaveScreen` presents the extracted places on a live map for review and selection, and `PreviewScreen` is an older stub kept for reference.

## File Structure

```
src/features/import-places/
  import-screen/
    ImportScreen.tsx        ← input bottom sheet (92% snap)
    IMPORT-SCREEN.md
  analyzing-screen/
    AnalyzingScreen.tsx     ← animated full-screen parse-in-progress state
    ANALYZING-SCREEN.md
  save-screen/
    SaveScreen.tsx          ← results screen: live map + place selection panel
    SAVE-SCREEN.md
  preview-screen/
    PreviewScreen.tsx       ← older stub (hardcoded mock data); superseded by SaveScreen
    PREVIEW-SCREEN.md
  IMPORT-PLACES.md          ← this document
```

---

## Screen Flow

```
HomeTabBar "+" → AddMenu.onImportPlaces
  → HomeScreen.onOpenImport
    → ImportScreen (user pastes text / URL → onSubmit(text))
      → AnalyzingScreen (parseLink(text) running → onCancel returns to ImportScreen)
        → SaveScreen (result: ParseResult)
            → onSave(selectedIds)   → persist places → dismiss flow
            → onAddToPlan(selectedIds) → open plan flow → dismiss
            → onClose()             → dismiss flow
```

---

## Service Layer

`src/services/import/importService.ts` is active (not a stub). It exports:

```ts
export type ParsedPlace = {
  id: string;
  name: string;
  subtitle: string;
  type: string;
  latitude: number;
  longitude: number;
  imageUri?: string;
};

export type ParseResult = {
  sourceTitle: string;       // shown in the top pill on SaveScreen
  sourceThumbnail?: string;  // optional thumbnail for the pill
  centerCoordinate: [number, number]; // initial map camera center
  region?: string;
  places: ParsedPlace[];
};

export async function parseLink(input: string): Promise<ParseResult>
```

The import adapter now calls the live backend. Smart text always follows a `qwen3.5-flash -> deepseek-chat` cascade before geocoding; the `webSearch` toggle is still accepted for compatibility but no longer changes that cascade. Image scan still starts with GLM OCR, Reddit links keep the DeepSeek-based parse route, and Any Links keeps the Gemini vision path.

`src/types/import.ts` is still an empty stub; add any additional shared types there if needed.

---

## Entry Point

`ImportScreen` is opened from the "+" tab → `AddMenu` → `HomeScreen.onOpenImport`. The parent that mounts the flow manages which screen is visible and wires the callbacks between screens.

## Related docs

- [IMPORT-SCREEN.md](import-screen/IMPORT-SCREEN.md)
- [ANALYZING-SCREEN.md](analyzing-screen/ANALYZING-SCREEN.md)
- [SAVE-SCREEN.md](save-screen/SAVE-SCREEN.md)
- [SERVICES.md](../../services/SERVICES.md)
