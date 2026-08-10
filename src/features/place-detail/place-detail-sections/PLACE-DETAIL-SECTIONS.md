# place-detail-sections

## Overview

Section components that compose the `PlaceDetail` overlay. Each section receives a `PlaceDetail` object and renders one logical slice of the detail view.

## File Structure

```
src/features/place-detail/place-detail-sections/
  PlaceOverviewSection.tsx    ← hero row: address, open status, action buttons, thumbnail
  PlaceInfoSection.tsx        ← tags, collections, summary, visit strategy, links, note
  PLACE-DETAIL-SECTIONS.md   ← this document
```

## PlaceOverviewSection

```ts
type PlaceOverviewSectionProps = {
  place: PlaceDetail;
};
```

Shows: place name, address, open/closed status line (derived from `place.schedule` via `getOpenStatus`), four action icon buttons (navigate, share, heart, ellipsis), and a thumbnail image. The thumbnail currently uses a static placeholder image. The address line is omitted entirely when the place has no address, so it contributes no spacing rather than rendering as a blank line.

## PlaceInfoSection

```ts
type PlaceInfoSectionProps = {
  place: PlaceDetail;
};
```

Shows: tags (horizontal scroll of `Badge`s), collections (same), summary paragraphs, visit strategy paragraphs, tappable links (opens via `Linking.openURL`), and a note. Sections with no data are omitted. The Tags, Collection, and Links section headers have an add-button; Note has an edit-button — these are currently no-ops.

## Related docs

- [PLACE.md](../PLACE.md) — parent overlay that renders these sections
- [TYPES.md](../../../types/TYPES.md) — `PlaceDetail`, `PlaceTag`, `PlaceLink` types
