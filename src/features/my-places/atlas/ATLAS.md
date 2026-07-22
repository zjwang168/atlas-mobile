# Atlas

## Overview

The "Atlas" sub-tab in the MyPlaces panel — a scrollable row of category filter pills (with list-view and add icons pinned to its right edge) above curated atlas cards (emoji on top, title below) laid out three per row, wrapping to additional rows.

## Behaviour

### Status

- **Empty**: `mockAtlases` is empty — shows the placeholder message "Your curated atlas will appear here."
- **Populated**: a `CategoryPillsRow` (this file) — a static, horizontally scrolling row of category `Badge` pills (`CATEGORY_PILLS`, `All` shown pressed/selected with a filled primary background) with fixed `list-outline` and `add` icons pinned to the right, outside the scroll area — pinned above the card grid so it does not scroll with the rest of the content, unlike the `AtlasCard` (`AtlasCard.tsx`) grid below it, which scrolls independently in its own `ScrollView` (one card per entry in `mock-data/mockAtlases.ts`'s `mockAtlases`, wrapping three per row). Neither the pills nor the two icons are wired to any filtering/view-toggle/create behavior yet. `AtlasCard` is a small memoized component rendering `Atlas.emoji` centered in a square with `Atlas.title` below it; tapping it calls `useHome().setOverlay({ kind: 'atlasDetail', atlasId })` to open `AtlasDetail`.

The atlas cards themselves (`mockAtlases`) are a static fixture, not a service or `HomeContext`, so the tab renders without any auth/session/fetch dependency. Their place lists are not — see `ATLAS-DETAIL.md`.

No props.

## Related docs

- [atlas-detail/ATLAS-DETAIL.md](./atlas-detail/ATLAS-DETAIL.md) — overlay `AtlasCard` opens, listing every place inside one atlas
- [MY-PLACES.md](../MY-PLACES.md) — parent feature that renders this tab
