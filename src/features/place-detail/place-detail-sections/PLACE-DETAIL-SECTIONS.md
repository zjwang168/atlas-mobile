# place-detail-sections

## Overview

The header and the stack of cards that compose the `PlaceDetail` overlay — each card is one slice of what we know about a place, and hides itself when it has nothing real to show.

## Behaviour

Every card shares one shell (`DetailCard`) so the stack reads as one object rather than a set of differently-drawn panels.

A card renders only when its data exists: no summary and no photo hides About, no recorded provenance hides Sources, no address and no phone hides Location. `PlaceNoteCard` is the exception — it is the one section that exists to be written to, so it renders its own empty state and stays reachable. Opening hours have no card at all: nothing populates `schedule`, and deriving a status line from an empty one reports every place as closed.

`PlaceCommunityNotesCard` always renders, currently as an empty state. Nothing produces other people's notes yet — places are still per-user rows, so there is no shared place entity to read them from. It fills in unchanged once one exists.

### Status

`PlaceSourcesCard` is expanded or collapsed, toggled by its own pill; it starts expanded, because the per-source summaries are the point of the section rather than a detail behind a disclosure.

`PlaceDetailHeader`'s name is either static or editing — long-press enters editing, and submitting or blurring saves via `updatePlaceName`. Long-press rather than tap, because the name sits inside a draggable sheet where a stray tap is easy and an accidental rename is not obviously undoable.

`PlaceNoteCard` is either static or editing — the pencil enters editing and swaps the header actions for cancel/save. Save calls `HomeContext.updateSavedPlaceNote`, which writes through the local cache immediately and syncs in the background; cancel discards the draft. Switching to a different place resets any in-progress edit. The card labels itself private, so the default is stated rather than assumed.

## API

```ts
// The shared card shell and its row rule.
export function DetailCard(props: { children: React.ReactNode; style?: StyleProp<ViewStyle> }): JSX.Element
export function CardDivider(): JSX.Element

// Thumbnail, name, category/rating chips, dismiss. Fixed above the scrolling stack.
export function PlaceDetailHeader(props: { place: PlaceDetail; onDismiss: () => void }): JSX.Element

// The AI's words about the place, plus whatever photos we hold for it.
export function PlaceAboutCard(props: {
  summary: string;
  photos: string[];   // one photo spans the card; two or more become a horizontal strip
}): JSX.Element | null

// Every post the place was parsed out of, each with that post's own summary.
export function PlaceSourcesCard(props: { sources: PlaceSource[] }): JSX.Element | null

// The user's own note — editable, and labelled private.
export function PlaceNoteCard(props: { place: PlaceDetail }): JSX.Element | null

// What other people who saved this place said about it.
export type CommunityNote = { id: string; text: string; author?: string };
export function PlaceCommunityNotesCard(props: { notes: CommunityNote[] }): JSX.Element

// Address and phone rows; each row appears only when that field has a value.
export function PlaceLocationCard(props: { place: PlaceDetail }): JSX.Element | null

// The platform badge for one source row — label, logo and brand colour.
export type SourceMeta = { label: string; Logo: Icon; color: string };
export function sourceMeta(sourceType: string | null, sourceUrl: string | null): SourceMeta
```

## Related docs

- [PLACE.md](../PLACE.md) — the overlay that composes these
- [SERVICES.md](../../../services/SERVICES.md) — `fetchPlaceSources`, `updatePlaceName`
- [PLACE-TAG-CHIP.md](../../../components/place-tag-chip/PLACE-TAG-CHIP.md) — the header's category and rating chips
- [TYPES.md](../../../types/TYPES.md) — `PlaceDetail`
