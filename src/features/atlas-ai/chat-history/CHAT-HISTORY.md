# Chat History

## Overview

`AtlasAIHome` is the "Atlas AI (Chats)" tab — the paginated list of past chat/import sessions, plus a text input to start a new one directly from the list. It's one of the three pages in `HomeScreen`'s horizontal pager (alongside the Places and Plan tabs). It reads/writes `chatHistory` on `HomeContext`, so any Supabase-backed history state is shared with the rest of the app.

`HistoryPlacesPanel` is the places-list view for a single chat session — it renders on the My Places tab whenever a chat session is active but its `AIChatBox` conversation view isn't open (see Integration below).

## File Structure

```
src/features/atlas-ai/chat-history/
  AtlasAIHome.tsx          ← chat history list, pagination, inline "new chat" input
  HistoryPlacesPanel.tsx   ← places list for the active chat session (renders on the Places tab)
  CHAT-HISTORY.md          ← this document
```

## Props

```ts
type AtlasAIHomeProps = {
  visible?: boolean;
  onHeightChange?: (height: number) => void;
  onOpenChat: (item: ChatHistoryItem) => void;
  onOpenPlaces: (item: ChatHistoryItem) => void;
  onLongPressDebug: () => void;
};
```

- `onOpenChat` — user tapped a card; caller typically sets it as the active history item and opens `AIChatBox` (`src/features/atlas-ai/ai-chat/`).
- `onOpenPlaces` — user tapped the "N places" pill; caller typically switches to the Places tab centered on that item's places.
- `onLongPressDebug` — long-press on the header opens the debug overlay.

## Behaviour

- Loads the first page (`loadChatHistory({ limit: 50 })`) plus a total count (`countChatHistory`) on mount, then paginates older items via `onEndReached` (`loadOlderHistory`), tracked with `hasMore`/`loadingMore`.
- Lets the user create a new chat/import session inline: typing text and submitting calls `parseInput`, saves the result via `saveChatHistory`, and — if places were found — calls `onOpenPlaces` immediately.
- Infers a display icon/source type per card (`inferDisplaySourceType`) from `sourceType` when present, falling back to keyword heuristics on the title/URL.
- Does **not** implement delete/trash — the previous `ChatHistoryPanel.tsx` (removed as dead code; it was never mounted anywhere) had a trash/restore flow that was not carried over here. `deleteChatHistoryItem`/`restoreChatHistoryItem` still exist on `HomeContext` if that needs to be rebuilt.

## Integration

```tsx
<AtlasAIHome
  visible={panelVisible}
  onHeightChange={setBottomPanelHeight}
  onOpenChat={(item) => { /* set active history item, open AIChatBox */ }}
  onOpenPlaces={(item) => { /* switch to Places tab, center map */ }}
  onLongPressDebug={() => setOverlay({ kind: 'debug' })}
/>
```

Only `HomeScreen` mounts this component, as the first page of its tab pager.

### `HistoryPlacesPanel`

```ts
type HistoryPlacesPanelProps = {
  item: ChatHistoryItem;
  selectedPlaceId: string | null;
  onClose: () => void;
  onPlacePress: (placeId: string) => void;
  onSavePlaces: (selectedIds: string[]) => void;
  onScroll?: (y: number) => void;
  bottomInset?: number;
};
```

Mounted by `HomePanel.tsx` on the Places tab in place of the normal `MyPlaces` list, whenever `activeSidekick !== 'aiChat'` and there's an `activeHistoryItem`:

```tsx
activeTab === TAB_PLACES && activeHistoryItem && activeSidekick !== 'aiChat' ? (
  <HistoryPlacesPanel
    item={activeHistoryItem}
    selectedPlaceId={selectedPlaceId}
    onClose={() => { /* clear active history item, parsedPlaces, selection */ }}
    onPlacePress={handleHistoryPlacePress}
    onSavePlaces={handleSaveHistoryPlaces}
    onScroll={reportScrollY}
    bottomInset={bottomInset}
  />
) : ( /* MyPlaces */ )
```

It's the "places" counterpart to `AIChatBox` (`ai-chat`) for the same `activeHistoryItem` — when `AIChatBox` commits new places via `onPlacesCommitted`, the updated item is what this panel renders the next time you switch back to the Places tab.

## Related docs

- [HOME.md](../../home/HOME.md) — owns the `HomeContext` state (`chatHistory`, `activeHistoryItem`, `activeSidekick`) both components read and write
- [AI-CHAT.md](../ai-chat/AI-CHAT.md) — the chat thread component opened via `onOpenChat`, and the sibling view of `HistoryPlacesPanel`'s `activeHistoryItem`
