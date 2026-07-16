# Chat History

## Overview

`AtlasAIHome` is the paginated list of past chat/import sessions, plus a text input to start a new one directly from the list. It reads/writes `chatHistory` on `HomeContext`, so any Supabase-backed history state is shared with the rest of the app. It is currently opened as a temporary overlay from `ImportScreen`'s header (see Integration) rather than mounted as a `HomeScreen` pager tab.

`HistoryPlacesPanel` is the places-list view for a single chat session. It is not currently mounted anywhere — see Integration for where it belongs once reinstated.

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
  onClose?: () => void;  // shows a close button in the header when provided
};
```

- `onOpenChat` — user tapped a card; caller typically sets it as the active history item and opens `AIChatBox` (`src/features/atlas-ai/ai-chat/`).
- `onOpenPlaces` — user tapped the "N places" pill; caller typically switches to the Places tab centered on that item's places.
- `onLongPressDebug` — long-press on the header opens the debug overlay.
- `onClose` — user tapped the close button; caller hides `AtlasAIHome` (e.g. `setVisible(false)`/unmount). `ContentPanel` itself has no swipe-to-dismiss gesture, only snap points, so without this the component has no way to disappear once shown.

## Behaviour

- Loads the first page (`loadChatHistory({ limit: 50 })`) plus a total count (`countChatHistory`) on mount, then paginates older items via `onEndReached` (`loadOlderHistory`), tracked with `hasMore`/`loadingMore`.
- Lets the user create a new chat/import session inline: typing text and submitting calls `parseInput`, saves the result via `saveChatHistory`, and — if places were found — calls `onOpenPlaces` immediately.
- Infers a display icon/source type per card (`inferDisplaySourceType`) from `sourceType` when present, falling back to keyword heuristics on the title/URL.
- Does **not** implement delete/trash — the previous `ChatHistoryPanel.tsx` (removed as dead code; it was never mounted anywhere) had a trash/restore flow that was not carried over here. `deleteChatHistoryItem`/`restoreChatHistoryItem` still exist on `HomeContext` if that needs to be rebuilt.

## Integration

`App.tsx`'s `AppContent` mounts `AtlasAIHome` conditionally on a local `showChatHistory` boolean, toggled on by `ImportScreen`'s `onOpenChatHistory` (see `IMPORT-SCREEN.md`):

```tsx
{showChatHistory && (
  <AtlasAIHome
    visible={showChatHistory}
    onClose={() => setShowChatHistory(false)}
    onOpenChat={(item) => { setActiveHistoryItem(item); setActiveSidekick('aiChat'); setShowChatHistory(false); setOverlay('none'); }}
    onOpenPlaces={(item) => { setActiveHistoryItem(item); setParsedPlaces(item.places); setShowChatHistory(false); setOverlay('none'); }}
    onLongPressDebug={() => setHomeOverlay({ kind: 'debug' })}
  />
)}
```

Both handlers close the Import sheet and this overlay, dropping the user back onto `HomeScreen` with `activeHistoryItem` set to the tapped session. `onOpenChat` additionally opens `AIChatBox` (`activeSidekick: 'aiChat'`); `onOpenPlaces` leaves `activeSidekick` alone and just seeds `parsedPlaces` so the map re-centers on that session's places.

This is a temporary entry point — `AtlasAIHome` was previously mounted as a `HomeScreen` pager tab (see git history) and may move back there.

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

Not currently mounted. Its natural home is back in `HomePanel.tsx` on the Places tab, in place of the normal `MyPlaces` list, whenever `activeSidekick !== 'aiChat'` and there's an `activeHistoryItem` — i.e. exactly the state `onOpenPlaces` above puts the app into:

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

It's the "places" counterpart to `AIChatBox` (`ai-chat`) for the same `activeHistoryItem` — when `AIChatBox` commits new places via `onPlacesCommitted`, the updated item is what this panel would render the next time you switch back to the Places tab. Until it's reinstated, tapping "N places" in `AtlasAIHome` sets `activeHistoryItem`/`parsedPlaces` (so the map updates) but the Places tab still shows the plain `MyPlaces` list rather than this session's places.

## Related docs

- [HOME.md](../../home/HOME.md) — owns the `HomeContext` state (`chatHistory`, `activeHistoryItem`, `activeSidekick`) both components read and write
- [AI-CHAT.md](../ai-chat/AI-CHAT.md) — the chat thread component opened via `onOpenChat`, and the sibling view of `HistoryPlacesPanel`'s `activeHistoryItem`
- [IMPORT-SCREEN.md](../../import-places/import-screen/IMPORT-SCREEN.md) — current entry point via the header's chat-history button
