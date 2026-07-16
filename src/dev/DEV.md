# Dev Tools

## Overview

Developer-only diagnostic screens that aren't part of the product experience. Not tied to any feature — reusable across features that want a quick way to inspect backend state during development. Currently home to `DebugPanel`, a read-only inspector for the AI memory/conversation backend, opened via a long-press gesture rather than normal navigation.

## File Structure

```
src/dev/
  DebugPanel.tsx   ← memory + conversation inspector
  DEV.md           ← this document
```

## Props

```ts
type DebugPanelProps = {
  onClose: () => void;
};
```

## Behaviour

- On mount (and pull-to-refresh), fetches `fetchMemories()` and `fetchConversations()` from `@/services/api/apiService` and renders two sections: current long-term memories and recent conversations (with message/place counts and latest summary).
- Read-only — no mutation actions.

## Integration

```tsx
{overlay.kind === 'debug' && (
  <DebugPanel onClose={() => setOverlay({ kind: 'none' })} />
)}
```

Opened from `HomeScreen` via `overlay.kind === 'debug'`, triggered by a long-press on the Atlas AI chat-history header (`onLongPressDebug` in `AtlasAIHome`, see [CHAT-HISTORY.md](../features/atlas-ai/chat-history/CHAT-HISTORY.md)).

## Related docs

- [HOME.md](../features/home/HOME.md) — owns the `debug` overlay kind that renders this panel
