# Discover

## Overview

The second mode of the places bottom sheet — local events near the user plus the app's live place search, sitting beside My Places under the `TopNav` Saved/Discover switch.

## Behaviour

### Status

Two modes, decided by whether the search field has any text in it:

- **browse** — real local events from the backend's `GET /events`, distance-sorted, with a horizontal strip of signature events above the list.
- **search** — real Mapbox results from `usePlaceSearch`. The filter menus are hidden, because a suggestion carries no date and no category for them to act on, and results already arrive weighted by proximity.

The first typed character switches modes even though it is shorter than the backend accepts, because leaving the event list on screen under a half-typed query reads as a result.

Tapping a suggestion resolves and saves it, and the row settles into saved or already-in-My-Places. Results that are already saved are marked before any tap, but only when the saved copy carries the same provider id — see [SERVICES.md](../../services/SERVICES.md). A place saved from a link import has no provider id, so it will not be pre-marked; the tap still reports it correctly, because the save path dedups on more than the id.

Focusing the search field asks the host sheet for its tallest snap state. Results are unreadable at the shorter detents, and the hosts disable this list's scrolling below `tall`, so the height has to be taken at the moment the user commits to searching. It is one-way — blurring or clearing the query leaves the sheet where it is rather than dropping it out from under the user.

The sheet keeps both mode panes mounted and hides the inactive one rather than unmounting it, so `active` — not mount state — is what tells Discover whether the user can see it. Going inactive clears the query and results and starts a new billed search session, which nothing else would do for a pane that never unmounts. `active` also gates the event fetch, so a hidden pane costs no request.

### The event list

An event is either dated or recurring, and the card reads `starts_at` first and falls back to `schedule_text` — never `source` — to decide which it is. A recurring row shows the source's own words ("Saturdays, 7am to noon") because farmers markets have no published hours to turn into a time.

Of the three filters, **timeframe refetches** and the other two do not. Deciding whether a season-long festival falls on this weekend needs the curated layer's annual windows, which only the backend has; category and sort are applied on the client so they respond instantly. Farmers markets are the visible exception — they carry no date at all, so they appear under every timeframe, and narrowing to another category is the way past them.

The featured strip is shown only when the list is unfiltered, because a filtered list is a deliberate search rather than a browse. Its cards lead with the event's blurb: the strip's whole job is to say why something is worth going to, not just how near it is. Curated entries lead it regardless of distance — the backend flags both curated signature events and the park service's own "special events" as featured, but only the first kind reliably means "worth planning around", so sorting the strip on distance alone buries them.

Tapping an event opens `EventDetail` over this pane, passing Discover's own overlay as `returnTo` so dismissing comes back here rather than to the home screen.

Events cover the DMV only. An empty result away from that area is reported as coverage, not as a failure — the sources genuinely return nothing rather than erroring, and saying "no events found" would misdescribe it. A source that fails outright while others succeed shows a note above the list instead of silently shortening it.

## API

```ts
type DiscoverProps = {
  bottomInset?: number;              // default: 0 — extra list padding to clear the sheet's bottom bar
  onScroll?: (y: number) => void;    // vertical offset, for the host sheet
  verticalScrollEnabled?: boolean;   // default: true — hosts disable it at the shorter sheet detents
  active?: boolean;                  // default: true — whether this pane is the visible one; also gates the event fetch
  snapTo?: (state: SnapState, animated?: boolean) => void;  // host sheet's snap control; called on search focus
  onSearchPress?: () => void;        // not rendered; kept plumbed as the revert path to SearchPanel
};
```

`useLocalEvents.ts` owns the browse mode's data and filters:

```ts
export type EventTimeframe = 'weekend' | 'week' | 'month';

export function useLocalEvents(options: {
  coordinate: [number, number];   // [lng, lat], from HomeContext.userLocation
  active: boolean;                // no fetch while the pane is hidden
}): {
  status: 'idle' | 'loading' | 'ready' | 'error';
  events: LocalEvent[];           // filtered and sorted
  featured: LocalEvent[];         // signature subset, also present in `events`
  outOfCoverage: boolean;         // succeeded but found nothing — i.e. not in the DMV
  degradedSources: string[];      // sources that failed while others worked
  timeframe, setTimeframe;        // changing it refetches
  category, setCategory;          // client-side
  sortMode, setSortMode;          // client-side
  reload: () => void;             // pull-to-refresh
}
```

`EventCard.tsx` exports the two card shapes and the formatting the list needs:

```ts
export const EventCard             // wide row for the distance-sorted list
export const FeaturedEventCard     // tall card for the horizontal strip
export const FEATURED_CARD_WIDTH: number
export function EventCover        // category-coloured cover for an event with no photo
export function categoryStyle(category: EventCategory)  // the icon, accent, and label for a category
export function formatWhen(event: LocalEvent): string | null   // dated → day and clock; recurring → schedule_text
export function formatDistance(km: number): string
```

`EventCover` exists rather than reusing `PlaceCover` because that component buckets *place* categories by keyword, and five of the seven event categories miss its vocabulary and fall through to neutral grey.

## Related docs

- [EVENT-DETAIL.md](../event-detail/EVENT-DETAIL.md) — the panel a tapped event opens, and how an event becomes a saved place
- [EVENTS-SERVICE.md](../../../backend/services/events_service/EVENTS-SERVICE.md) — the backend behind `GET /events`, including why a returned event always has coordinates
- [SERVICES.md](../../services/SERVICES.md) — `eventsService`, and `usePlaceSearch`, which owns the search behaviour described above
- [TYPES.md](../../types/TYPES.md) — `LocalEvent` and the category set
- [SAVE-AFFORDANCE.md](../../components/save-affordance/SAVE-AFFORDANCE.md) — the trailing indicator on a suggestion card
- [PLACE-COVER.md](../../components/place-cover/PLACE-COVER.md) — the category-coloured thumbnail a *suggestion* gets; events use `EventCover` instead, for the reason above
- [SEARCH.md](../search/SEARCH.md) — `SearchPanel`, the same search as a full-screen overlay
- [HOME.md](../home/HOME.md) — passes `onSearchPress` down through `HomePanel`
