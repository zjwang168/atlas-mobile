# PlaceTagChip

## Overview

The small grey pill that labels a place's category or rating — used on saved-place rows and on Discover's suggestion cards.

## Behaviour

When the caller passes no `icon`, the glyph and its colour are derived from the label text (a label mentioning cafe or coffee gets the coffee bean, everything else the fork and knife). Callers that know the real category should pass `icon`/`iconColor` rather than rely on that fallback — the derivation only distinguishes cafés from everything else, so a park gets a fork and knife.

The chip sizes itself to its label and does not clamp its own width — a row showing several chips should cap them itself via `style`.

### Status

Two sizes. `sm` is the list size, sized to sit in a dense saved-place row; `md` is the detail size, one step up in label and pill height for a chip that carries a screen's header rather than a row.

## API

```ts
type PlaceTagChipProps = {
  label: string;                  // chip text, truncated to one line
  icon?: Icon;                    // phosphor icon; default: derived from label
  iconColor?: string;             // default: derived from label
  size?: 'sm' | 'md';             // default: 'sm' — see Status
  style?: StyleProp<ViewStyle>;   // per-call layout, e.g. a maxWidth cap
};
```

## Related docs

- [ALL-PLACES.md](../../features/my-places/all-places/ALL-PLACES.md) — saved-place rows render two of these
- [DISCOVER.md](../../features/discover/DISCOVER.md) — suggestion cards use the same chip
- [PLACE-DETAIL-SECTIONS.md](../../features/place-detail/place-detail-sections/PLACE-DETAIL-SECTIONS.md) — the detail header's category and rating chips, at `md`
