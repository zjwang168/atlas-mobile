# PlaceCard Component

## Overview

A list-row card showing a place's name, description snippet, tag pills, and a pinned date. Used in `AllPlaces`.

## File

```
src/components/place-card/PlaceCard.tsx
```

## Props

```ts
type PlaceCardProps = {
  name: string;
  description: string;
  imageUrl?: string;          // shown in a 96×96 rounded thumbnail; omit for a grey placeholder
  tags?: PlaceTag[];          // up to 3 shown as outline badge pills
  date?: string;              // display string shown at the right of the tags row
  onPress?: () => void;
};
```

## Layout

```
[ Name (1 line)                           ] [ 96×96 thumbnail ]
[ Description (3 lines, fixed height 60dp)]
[ Tag pill ] [ Tag pill ] [ Tag pill ]         Date string
```

- Tags beyond index 2 are silently trimmed (`tags.slice(0, 3)`).
- The thumbnail area always reserves space; renders grey when `imageUrl` is absent.

## Types

`PlaceTag` is defined in `src/types/place.ts` — import from there:

```ts
import type { PlaceTag } from '@/types/place';
```
