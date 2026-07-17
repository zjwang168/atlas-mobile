# AI Chat

## Overview

`AIChatBox` is the conversational sidekick panel for a single chat/import session — it renders the message thread, lets the user talk to Atlas AI about the places in that session, and surfaces "add to map" / "save to my places" confirmation cards when the backend proposes places. It does not manage which chat is active or own place/plan state — the caller (`HomeScreen`) supplies `places`/`conversationId`/`title` and reacts to `onPlacesCommitted`.

## File Structure

```
src/features/atlas-ai/ai-chat/
  AIChatBox.tsx      ← chat thread UI, message parsing, place-action confirmation flow
  AI-CHAT.md         ← this document
```

## Props

```ts
type AIChatBoxProps = {
  places: ParsedPlace[];
  onClose: () => void;
  title?: string;
  visible?: boolean;
  conversationId?: string | null;
  onHeightChange?: (height: number) => void;
  onPlacesCommitted?: (places: ParsedPlace[], action: PendingMode) => void;
};
```

- `places` — the places currently associated with this chat session; shown as context and as the default set offered when the model asks "want me to add these?".
- `conversationId` — Supabase conversation id; when set, history is loaded via `fetchConversation`. When `null`, a new session is created lazily via `createChatSession` on first message.
- `onPlacesCommitted(places, action)` — fired when the user confirms a pending place action (`'pin_in_chat' | 'save_to_my_places' | 'both'`); caller merges `places` into the active history item / saved places.

## Behaviour

- Renders inside `ContentPanel` (`visible` controls slide state; `onHeightChange` reports height to the caller for map padding).
- Parses backend replies for a `[[CONFIRM_ADD_PLACES:{...}]]` marker (`extractPendingAction`) to render an inline place-action confirmation card instead of raw JSON.
- Has heuristic fallbacks (`looksLikeAddToMapQuestion`, `looksLikeAffirmativeReply`, `looksLikeSaveCurrentChatRequest`, `looksLikeManualAddFallback`) for turning natural-language model replies into the same confirmation flow when the backend doesn't emit a structured marker.
- Talks to the backend via `chatWithAtlas`, `createChatSession`, `fetchConversation` (`@/services/api/apiService`).

## Integration

```tsx
<AIChatBox
  key={activeHistoryItem?.id ?? 'atlas-ai-empty'}
  places={activeHistoryItem?.places ?? parsedPlaces}
  title={activeHistoryItem?.title}
  conversationId={activeHistoryItem?.id ?? null}
  visible={activeSidekick === 'aiChat' && panelVisible}
  onHeightChange={setBottomPanelHeight}
  onClose={() => { /* reset active chat state */ }}
  onPlacesCommitted={(newPlaces) => { /* merge into active history item */ }}
/>
```

Only `HomeScreen` mounts this component; it is keyed on the active history item id so switching chats resets local message state.

## Related docs

- [HOME.md](../../home/HOME.md) — owns the `activeSidekick`/`activeHistoryItem` state this component reads
- [AtlasAIHome.tsx](../../home/AtlasAIHome.tsx) — the chat list that opens a session into this component (not yet documented)
