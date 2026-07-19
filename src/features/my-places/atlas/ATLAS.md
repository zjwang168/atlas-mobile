# Atlas

## Overview

The "Atlas" sub-tab in the MyPlaces panel — shows each curated atlas as a header (its title) above a horizontal scroll row of its places (square thumbnail on top, name below).

## Behaviour

### Status

- **Empty**: `mockAtlases` is empty — shows the placeholder message "Your curated atlas will appear here."
- **Populated**: one section per entry in `mock-data/mockAtlases.ts`'s `mockAtlases`, each a title (`Atlas.title`) followed by a horizontally scrolling row of this directory's own `AtlasPlaceCard` (`AtlasPlaceCard.tsx`) — a small memoized component rendering a square thumbnail with the place name below it.

Data is sourced entirely from `mock-data/mockAtlases.ts` (`mockAtlases`, `mockAtlasPlaces`) — static fixtures, not a service or `HomeContext`, so the tab renders without any auth/session/fetch dependency. `mockAtlasPlaces` embeds `name`/`thumbnailUrl` directly (a real fetch would resolve these via a join against `places`); each row's `atlasId` is matched against `Atlas.id` to group it under the right section.

No props.

## Related docs

- [MY-PLACES.md](../MY-PLACES.md) — parent feature that renders this tab
