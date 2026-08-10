# ImportScreen

## Overview

A two-level `@gorhom/bottom-sheet` for importing places without entering the
Atlas AI chat.

- The first level opens as a detached floating sheet using the My Places
  panel's full-window 55% pixel height. It sits 16 px above the bottom edge and
  slightly overlaps the My Places top edge so the underlying header cannot
  leak through.
- Selecting a category expands the sheet to 92% and shows the relevant input.
- The map remains visible behind the sheet throughout the flow.

## File Structure

```
src/features/import-places/import-screen/
  ImportScreen.tsx      ← this component
  IMPORT-SCREEN.md      ← this document
```

## Props

```ts
type ImportScreenProps = {
  onClose: () => void; // sheet dismissed without submitting
  onSubmit: (text: string) => void; // user tapped send; text is trimmed raw input
  mode?: ImportMode; // existing backend route selected by the UI
};
```

## Behaviour

- The first level contains:
  - **Import from social media** — Reddit and YouTube.
  - **Image recognition** — text extraction and visual place recognition.
  - **Paste text** — notes, itineraries, and lists.
  - **Any other links** — articles, blogs, and webpages.
- Social import combines Reddit and YouTube behind one entry. A segmented
  control selects the source, while URL detection corrects the mode if the
  pasted link belongs to the other source.
- Social, text, and general-link inputs focus automatically after their
  section opens.
- The social composer remains one line. Long URLs scroll while editing and
  truncate in the clipboard suggestion.
- When the clipboard contains a URL, the social page shows a
  "Paste copied link?" suggestion.
- The image page keeps both existing image pipelines available through a
  `Read text` / `Identify location` toggle.
- Pan-down-to-close remains enabled. The back button returns from a category
  to the four-category menu.
- Keyboard behaviour is `"interactive"` so the expanded sheet follows the
  keyboard.

## Integration

Opened by `HomeScreen` via `onOpenImport`. The parent mounts this as a full-screen `absoluteFill` overlay (with `pointerEvents="box-none"`) so the map remains visible behind it.

The UI continues to emit the existing `ImportMode` values, so no backend
contract changes are required:

- `redditLinks` → `/parse_link`
- `youtubeLinks` → `/parse_youtube`
- `smartText` → `/parse_text`
- `anyLinks` → `/scan_url`
- `findTextPlaces` → `/scan_images_base64`
- `findImagePlaces` → `/find_image_places`

## Related docs

- [IMPORT-PLACES.md](../IMPORT-PLACES.md) — full flow and entry point
- [ANALYZING-SCREEN.md](../analyzing-screen/ANALYZING-SCREEN.md) — next step after submission
