# Plan Mode Feature

## Overview

Plan Mode is the second tab of the home content panel. Users paste a link (e.g. a Reddit travel post), the backend extracts locations and builds a route, and the result is displayed as a chat thread with an interactive map overlay.

## File Structure

```
src/features/plan-mode/
  PlanMode.tsx     ← root component rendered inside HomePanel
  PLAN-MODE.md     ← this document
```

## Props

```ts
type PlanModeProps = {
  parseResult: ParseResult | null;        // route data returned from the backend
  isLoading: boolean;                     // true while the backend request is in flight
  loadingMessage?: string;               // animated loading label shown during fetch
  messages: ChatMessage[];               // chat thread (system + assistant + user messages)
  onSendMessage: (text: string) => void; // user sends a follow-up message
  error: string | null;                  // error string from a failed parse request
  onScroll?: (y: number) => void;        // scroll Y reported to ContentPanel
  bottomInset?: number;                  // safe-area + bottom-bar clearance
};
```

## Data Flow

```
User pastes link in PlanMode
  → PlanMode calls parse callback (wired up to HomeScreen.parseLink)
  → HomeScreen calls POST /parse_link
  → parseResult / messages / isLoading / error flow back down as props
  → MapboxMap in HomeScreen renders the route polyline and markers
```

## Status

Skeleton. UI and link-submission entry point to be implemented.
