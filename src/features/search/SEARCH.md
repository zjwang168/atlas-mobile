# Search

## Overview

`SearchPanel` is the full-screen overlay opened from the search icon in `TopNav`. It is currently a UI stub — it renders a search input and a hint/empty state but does not query any data source yet; typing does not filter or fetch results.

## File Structure

```
src/features/search/
  SearchPanel.tsx   ← search input + placeholder empty state
  SEARCH.md         ← this document
```

## Props

```ts
type SearchPanelProps = {
  onClose: () => void;
};
```

## Behaviour

- Local `query` state only; no backend/service call is wired up.
- Shows a hint text when `query` is empty, and a static "no results" text otherwise — this is a placeholder, not real search.

## Integration

```tsx
{overlay.kind === 'search' && (
  <SearchPanel onClose={() => setOverlay({ kind: 'none' })} />
)}
```

Opened from `HomeScreen` via `overlay.kind === 'search'`, triggered by the search icon in `TopNav`.

## Related docs

- [HOME.md](../home/HOME.md) — owns the `search` overlay kind that renders this panel
