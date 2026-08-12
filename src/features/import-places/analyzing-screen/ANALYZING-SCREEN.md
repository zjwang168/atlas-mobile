# AnalyzingScreen

## Overview

Full-screen overlay shown while an import is running. It presents a live, user-facing analysis record derived from the backend progress endpoint. It does not expose raw model output, extraction JSON, token counts, or internal pipeline labels.

## File Structure

```
src/features/import-places/analyzing-screen/
  AnalyzingScreen.tsx     ← this component
  ANALYZING-SCREEN.md     ← this document
```

## Props

```ts
type AnalyzingScreenProps = {
  url: string;                 // raw text/URL shown in the preview pill
  mode?: AnalyzingMode;        // link, text, OCR, video, or image-location flow
  progressEvents?: ParseProgressEvent[]; // live timeline entries from the backend
  onDismiss: () => void;       // user tapped the top-right close button
  onCancel: () => void;        // user tapped the bottom Cancel control
};
```

## Behaviour

- Renders as `position: absolute` covering the full screen (not inside `ContentPanel`).
- Converts real backend events into concise, natural-language steps such as reading a transcript, recognizing image text, finding place references, and verifying map matches. The newest step is always first and expanded; the previous eleven events remain as compact history beneath it.
- Filters raw LLM tokens and structured extraction content. The screen communicates observable work, not hidden reasoning.
- OCR and image-location requests use the same progress polling contract as link, text, Reddit, and YouTube imports.
- The extraction pipeline emits its inferred region immediately after entity extraction, before map matching. The screen then requests up to three representative Wikipedia images for that city or area; they cross-fade without blocking the import and show the region name over the photo.
- Fetches progress once after the parse response returns so the final "Preparing your results" stage is visible.
- The top-right close button hides the analysis and lets it continue in the background. The bottom Cancel control cancels the associated backend request.
- When the user hides analysis, an activity island remains at the top of the app and can reopen the same live analysis screen. If it finishes without being reopened, a success island displays for ten seconds, then offers Chat History. A backgrounded app uses a local system notification that reopens `SaveScreen`.
- The component does not know when parsing finishes — the parent transitions to `SaveScreen` when `parseLink()` resolves.

## Integration

Mounted by the parent immediately after `ImportScreen.onSubmit`. The parent simultaneously starts `parseLink(text)` and shows this screen. On resolve, the parent unmounts this screen and shows `SaveScreen` with the result.

## Related docs

- [IMPORT-PLACES.md](../IMPORT-PLACES.md) — full flow
- [IMPORT-SCREEN.md](../import-screen/IMPORT-SCREEN.md) — previous step
- [SAVE-SCREEN.md](../save-screen/SAVE-SCREEN.md) — next step
