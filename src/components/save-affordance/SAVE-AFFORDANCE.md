# SaveAffordance

## Overview

The trailing save indicator on a place row that can be saved from a search result — used by `SearchPanel` and Discover so the two cannot show different states for the same thing.

## Behaviour

Four states, in precedence order: a save in flight beats everything and shows a spinner; `'saved'` is a filled green check; `'duplicate'` is an outline check, meaning the place was already in My Places and this tap created nothing; a null outcome is the unsaved add icon.

Only the indicator lives here. Whether the row is still tappable, and any accompanying text, belong to the row — the two surfaces lay those out differently.

## API

```ts
type SaveAffordanceProps = {
  outcome: PlaceSaveOutcome | null;  // null when the place is not saved; see @/types/place
  saving?: boolean;                  // default: false — a save is in flight, overrides outcome
  size?: number;                     // default: 24 — icon size; the spinner is always small
};

export function SaveAffordance(props: SaveAffordanceProps)
```

## Related docs

- [SERVICES.md](../../services/SERVICES.md) — `usePlaceSearch`, which produces the outcome this renders
- [TYPES.md](../../types/TYPES.md) — `PlaceSaveOutcome`
