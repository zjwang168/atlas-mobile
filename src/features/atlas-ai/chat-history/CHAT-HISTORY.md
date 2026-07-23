# Chat History

## Overview

`AtlasAIHome` is the paginated list of past chat/import sessions. It reads/writes `chatHistory` on `HomeContext`, so any Supabase-backed history state is shared with the rest of the app. It opens from the chat header as a native bottom sheet rather than as a `HomeScreen` pager tab.

`HistoryPlacesPanel` is the places-list view for a single chat session. It is not currently mounted anywhere — see Integration for where it belongs once reinstated.

## File Structure

```
src/features/atlas-ai/chat-history/
  AtlasAIHome.tsx          ← native history sheet, grouped list, pagination
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

- `onOpenChat` — user tapped a history row; caller sets it as the active history item and opens `AIChatBox` (`src/features/atlas-ai/ai-chat/`).
- `onOpenPlaces` — retained for caller compatibility; the current list displays the place count as row metadata and opens the chat when the row is tapped.
- `onLongPressDebug` — long-press on the header opens the debug overlay.
- `onClose` — called by the close button or native swipe-to-dismiss gesture.

## Behaviour

- Uses `@expo/ui`'s native `BottomSheet`: one full-height `100%` detent so the sheet stays attached to the left, right, and bottom screen edges, with the system grabber/corner treatment, swipe-to-dismiss, and dimmed backdrop.
- Keeps the title in an absolute transparent overlay. The section list scrolls underneath it, with the same thin top material fade used by the main chat interface; the native downward swipe is the sheet's close interaction.
- Groups sessions by `updatedAt`/`createdAt` month and renders simple rows rather than cards or count pills.
- Uses a Phosphor `ChatCircle` icon, a one-line title, and the pluralized place count as secondary text.
- Paginates older items via `onEndReached` (`loadOlderHistory`), tracked with `hasMore`/`loadingMore`.
- Uses the same bottom material treatment as the chat screen: `systemUltraThinMaterialLight`, intensity `10`, and scrim `1`.
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

The current row interaction uses `onOpenChat`, which closes the sheet and opens `AIChatBox` with the tapped history item. `onOpenPlaces` remains in the component API for compatibility with the surrounding app but is not presented as a separate control in this design.

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
