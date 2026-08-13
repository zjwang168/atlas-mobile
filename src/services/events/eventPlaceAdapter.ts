/**
 * Turns a `LocalEvent` into something the saved-places pipeline accepts.
 *
 * An event is not a place, but it happens at one, and it carries coordinates —
 * which is the whole reason the backend drops rows it cannot place. That makes
 * the existing `savePlaces()` path reusable as-is: no new table, no new sync
 * queue, and the event immediately becomes selectable by every flow that
 * builds on saved places (Atlas, the plan picker, the map).
 *
 * The provider id is what makes this safe to press twice. Saving carries
 * `externalId`/`externalSource`, so `isSamePlace()` matches on the id alone
 * and a second save is reported as a duplicate rather than creating a twin.
 */

import type { ParsedPlace } from '@/services/import/importService';
import type { LocalEvent } from '@/types/event';

/** Stored in `places.external_source`, paired with the event's own id. */
export const EVENT_PLACE_SOURCE = 'atlas-events';

/**
 * The subtitle a saved event row shows in My Places.
 *
 * Reads the same way the event card does — when it happens, then where — so a
 * market saved from Discover doesn't turn into a bare name in the list.
 */
function subtitleFor(event: LocalEvent): string {
  const when = event.starts_at
    ? new Date(event.starts_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : event.schedule_text;
  const where = event.location_name && event.location_name !== event.title
    ? event.location_name
    : null;
  return [when, where].filter(Boolean).join(' · ');
}

export function eventToParsedPlace(event: LocalEvent): ParsedPlace {
  return {
    id: event.id,
    name: event.title,
    subtitle: subtitleFor(event),
    // `type` is the free text PlaceCover buckets on and the saved row's
    // category column. The event category is the honest answer.
    type: event.category,
    latitude: event.latitude,
    longitude: event.longitude,
    // A stock category photo is not a picture of this place, so it is not
    // carried into the saved row — a saved place with no photo renders its
    // own category cover, which is truthful; a stock festival crowd filed
    // under a farmers market is not.
    imageUri: event.image_is_stock ? undefined : (event.image_url ?? undefined),
    externalId: event.id,
    externalSource: EVENT_PLACE_SOURCE,
  };
}
