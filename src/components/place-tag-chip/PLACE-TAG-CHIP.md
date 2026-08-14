# PlaceTagChip

## Overview

The small grey pill that labels a place's category or rating — used on saved-place rows and on Discover's suggestion cards.

## Behaviour

When the caller passes no `icon`, the glyph and its colour are derived from the label text (a label mentioning cafe or coffee gets the coffee bean, everything else the fork and knife). Callers that know the real category should pass `icon`/`iconColor` rather than rely on that fallback.

The chip sizes itself to its label and does not clamp its own width — a row showing several chips should cap them itself via `style`.

## API

```ts
type PlaceTagChipProps = {
  label: string;                  // chip text, truncated to one line
  icon?: Icon;                    // phosphor icon; default: derived from label
  iconColor?: string;             // default: derived from label
  style?: StyleProp<ViewStyle>;   // per-call layout, e.g. a maxWidth cap
};
```

## Related docs

- [ALL-PLACES.md](../../features/my-places/all-places/ALL-PLACES.md) — saved-place rows render two of these
- [DISCOVER.md](../../features/discover/DISCOVER.md) — suggestion cards use the same chip
