# Event Detail

## Overview

A panel for one local event from Discover — what it is, when and where, what it costs — and the one place an event can be turned into a saved place or put on a plan.

## Behaviour

The overlay carries the whole `LocalEvent` rather than an id, because an event is not persisted anywhere until the user saves it, so there is nothing to look one up from. That is the difference from `PlaceDetail`, which takes a `placeId`.

### Saving

An event is not a place, but it happens at one and it always has coordinates — which is exactly why the backend drops rows it cannot place. That makes the existing `savePlaces()` path reusable with no new table and no new sync queue, and the moment an event is saved it becomes selectable by everything built on saved places: the Atlas picker, the plan picker, the map.

Saving writes a provider id (`external_place_id`, with `external_source` set to the events source), which is what makes the button safe to press twice: `isSamePlace()` matches on that id alone, so a second save reports a duplicate instead of creating a twin. The panel also reads the same id back out of `savedPlaces` when it opens, so an event saved on a previous visit shows as already saved rather than offering to save it again.

**Add to plan implies save.** A plan holds saved places, so picking a plan saves the event first if it isn't saved yet, then attaches it as a flexible (unscheduled) place and opens that plan. Requiring the user to press Save first would make one intention into two actions.

A stock category photo is deliberately *not* carried into the saved place. A saved place with no photo renders its own category cover, which is truthful; a generic festival crowd filed under a farmers market is not.

### Status

The save button reports one of: idle, saving, saved, already-in-My-Places, or failed. "Already in My Places" is reached either by saving now or by the event having been saved before.

### Imagery

The hero uses whatever `image_url` the backend resolved through its chain (the event's own photo, then its park's, then category stock — see [EVENTS-SERVICE.md](../../../backend/services/events_service/EVENTS-SERVICE.md)). Only a real photograph is credited; a stock image is left uncaptioned, because naming a photographer under a picture that is not of this event would misdescribe it. If the image fails to load, the panel falls back to the coloured category cover rather than leaving a gap.

## API

```ts
type EventDetailProps = {
  event: LocalEvent | null;      // null hides the panel; the host keeps it mounted either way
  onDismiss: () => void;         // wired by HomeScreen to the overlay's `returnTo`; dismissing all the way back to the home screen also resets the shared snap group to `default`, so a panel dragged to full height doesn't leave the home panel full-screen
  snapGroup?: string;            // joins the shared `home-main` snap group
  onHeightChange?: (height: number) => void;  // forwarded to the map's camera padding
};

export function EventDetail(props: EventDetailProps)
```

Opened by adding the overlay, which any feature can do:

```ts
const { overlay, setOverlay } = useHomeOverlay();
setOverlay({ kind: 'eventDetail', event, returnTo: overlay });
```

## Related docs

- [DISCOVER.md](../discover/DISCOVER.md) — the list this opens from; `EventCard` also exports the cover and the when-formatter this panel reuses
- [EVENTS-SERVICE.md](../../../backend/services/events_service/EVENTS-SERVICE.md) — where the event and its image come from
- [SERVICES.md](../../services/SERVICES.md) — `eventPlaceAdapter`, and `savePlaces()`'s duplicate contract
- [HOME.md](../home/HOME.md) — the `Overlay` union and how `HomeScreen` mounts this
