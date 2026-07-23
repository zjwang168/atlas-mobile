# AI Chat

## Overview

`AIChatBox` is the full-screen conversation interface for a single chat/import session — it renders the message thread, lets the user talk to Atlas AI about the places in that session, and surfaces "add to this map" / "save to my places" confirmation cards when the backend proposes places. It does not manage which chat is active or own place/plan state — the caller (`HomeScreen`) supplies `places`/`conversationId`/`title` and reacts to `onPlacesCommitted`.

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
  onOpenHistory?: () => void;
  title?: string;
  visible?: boolean;
  conversationId?: string | null;
  onPlacesCommitted?: (places: ParsedPlace[], action: PendingMode) => void;
};
```

- `places` — the places currently associated with this chat session; shown as context and as the default set offered when the model asks "want me to add these?".
- `conversationId` — Supabase conversation id; when set, history is loaded via `fetchConversation`. When `null`, a new session is created lazily via `createChatSession` on first message.
- `onPlacesCommitted(places, action)` — fired when the user confirms a pending place action (`'pin_in_chat' | 'save_to_my_places' | 'both'`); caller merges `places` into the active history item / saved places.

## Behaviour

- Renders as a full-screen overlay when `visible` is true.
- Uses Phosphor icons throughout the chat chrome and native iOS Liquid Glass for the back/history controls.
- Floats the header and composer over long, smoothly masked `systemUltraThinMaterialLight` edge materials so messages remain faintly visible without a hard fade boundary.
- Gives the composer its own native Liquid Glass surface with a light white frost wash; unsupported platforms fall back to `systemMaterialLight`.
- Matches the two Figma composer states: an empty 56 pt single-row composer (28 pt side/bottom inset, 32 pt radius), and an animated content composer (12 pt side inset, 28 pt bottom inset, 24 pt radius).
- Keeps one persistent multiline `TextInput` mounted across both composer states; entering the first character changes layout without replacing the native input or dropping keyboard focus.
- Parses backend replies for a `[[CONFIRM_ADD_PLACES:{...}]]` marker (`extractPendingAction`) to render an inline place-action confirmation card instead of raw JSON.
- Presents place actions as vertically stacked neutral capsules with 16/24 semibold labels, bold 16 pt arrows, 8 pt vertical padding, and 16 pt effective horizontal padding (the Figma component's 12 pt padding plus its 4 pt internal spacer), while preserving the existing `pin_in_chat` / `save_to_my_places` handlers.
- Adds a bold 16 pt feedback row beneath every assistant response: local like/dislike selection, clipboard copy, native share, and a compact overflow action sheet.
- Matches the Figma message rhythm with SF Pro 16/24 body text, an 8 pt label-to-body gap, 12 pt gaps between content/actions/feedback, and no extra Markdown paragraph margin.
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
  onClose={() => { /* reset active chat state */ }}
  onOpenHistory={() => { /* show AtlasAIHome */ }}
  onPlacesCommitted={(newPlaces) => { /* merge into active history item */ }}
/>
```

Only `HomeScreen` mounts this component; it is keyed on the active history item id so switching chats resets local message state.

## Related docs

- [HOME.md](../../home/HOME.md) — owns the `activeSidekick`/`activeHistoryItem` state this component reads
- [AtlasAIHome.tsx](../../home/AtlasAIHome.tsx) — the chat list that opens a session into this component (not yet documented)
