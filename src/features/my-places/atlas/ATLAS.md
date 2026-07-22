# Atlas

## Overview

The "Atlas" sub-tab in the MyPlaces panel — a scrollable row of category filter pills (with list-view and add icons pinned to its right edge) above curated atlas cards (emoji on top, title below) laid out three per row, wrapping to additional rows.

## Behaviour

### Status

- **Empty**: `useHome().atlases` is empty — `CategoryPillsRow` (with the `add` icon) still renders, followed by the placeholder message "Your curated atlas will appear here.", so a first atlas can still be created from an empty state.
- **Populated**: a `CategoryPillsRow` (this file) — a static, horizontally scrolling row of category `Badge` pills (`CATEGORY_PILLS`, `All` shown pressed/selected with a filled primary background) with fixed `list-outline` and `add` icons pinned to the right, outside the scroll area — pinned above the card grid so it does not scroll with the rest of the content, unlike the `AtlasCard` (`AtlasCard.tsx`) grid below it, which scrolls independently in its own `ScrollView` (one card per entry in `useHome().atlases`, wrapping three per row). The `list-outline` icon isn't wired to any filtering/view-toggle behavior yet. `AtlasCard` is a small memoized component rendering `Atlas.emoji` centered in a square with `Atlas.title` below it; tapping it calls `useHome().setOverlay({ kind: 'atlasDetail', atlasId })` to open `AtlasDetail`.

The `add` icon calls React Native's `Alert.prompt` — a native iOS modal (Cancel / Create, single text field) — and calls `useHome().createAtlas(title)` when confirmed with a non-empty name. `Alert.prompt` is iOS-only; the button currently no-ops on Android.

Atlases are backed by `useHome().atlases`, sourced from `services/atlas/atlasService.ts` — an AsyncStorage cache-then-revalidate layer synced to the Supabase `atlas` table, the same architecture `savedPlaces` uses (see `SERVICES.md`, `services/local/LOCAL.md`). `createAtlas` writes an optimistic local row immediately (visible before the network round-trip), then syncs to Supabase, queued for retry if offline. Their place lists are separate — see `ATLAS-DETAIL.md`.

No props.

## Related docs

- [atlas-detail/ATLAS-DETAIL.md](./atlas-detail/ATLAS-DETAIL.md) — overlay `AtlasCard` opens, listing every place inside one atlas
- [MY-PLACES.md](../MY-PLACES.md) — parent feature that renders this tab
