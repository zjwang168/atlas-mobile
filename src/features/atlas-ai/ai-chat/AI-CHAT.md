# AI Chat

## Overview

`AIChatBox` is the full-screen conversation interface for a single chat/import session. It renders the message thread and lets the user ask Atlas AI about the places explicitly attached to that chat. The baseline chat is intentionally a plain model conversation: it has no tools, cross-chat memory, automatic place extraction, or map mutation.

## File Structure

```
src/features/atlas-ai/ai-chat/
  AIChatBox.tsx      ← chat thread UI, message parsing, place-action confirmation flow
  AI-CHAT.md         ← this document
```

## API

```ts
type AIChatBoxProps = {
  places: ParsedPlace[];        // places explicitly attached to this chat; provided as model context
  onClose: () => void;
  onOpenHistory?: () => void;
  title?: string;
  visible?: boolean;
  conversationId?: string | null;  // Supabase conversation id; loads history via fetchConversation, or lazily creates a session on first message when null
};

```

## Behaviour

- Renders as a full-screen overlay when `visible` is true.
- Uses Phosphor icons throughout the chat chrome and native iOS Liquid Glass for the back/history controls.
- Floats the header and composer over long, smoothly masked `systemUltraThinMaterialLight` edge materials so messages remain faintly visible without a hard fade boundary.
- Gives the composer its own native Liquid Glass surface with a light white frost wash; unsupported platforms fall back to `systemMaterialLight`.
- Matches the two Figma composer states: an empty 56 pt single-row composer (28 pt side/bottom inset, 32 pt radius), and an animated content composer (12 pt side inset, 28 pt bottom inset, 24 pt radius).
- Keeps one persistent multiline `TextInput` mounted across both composer states; entering the first character changes layout without replacing the native input or dropping keyboard focus.
- Displays ordinary model text. Historical action markers are stripped from the visible transcript for compatibility, but they cannot create buttons or mutate places.
- `Home`, `Office`, and `School` are sensitive system places. The mobile client supplies only saved role coordinates for each chat request; the agent can produce a preview-only create/update/delete proposal, while the client performs the actual write only after the user confirms the card.
- A result that searches between two system places includes both role pins on the map. System-place map pins use their semantic icon and role label rather than the default blue saved-place pin.
- Adds a bold 16 pt feedback row beneath every assistant response: local like/dislike selection, clipboard copy, native share, and a compact overflow action sheet.
- Matches the Figma message rhythm with SF Pro 16/24 body text, an 8 pt label-to-body gap, 12 pt gaps between content/actions/feedback, and no extra Markdown paragraph margin.
- Talks to the backend via `chatWithAtlas`, `createChatSession`, and `fetchConversation` (`@/services/api/apiService`).

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

Only `HomeScreen` mounts this component; it is keyed on the active history item id so switching chats resets local message state. Chat history persistence remains a product feature, but it is not injected as cross-chat memory.

## Related docs

- [HOME.md](../../home/HOME.md) — owns the `activeSidekick`/`activeHistoryItem` state this component reads
- [AtlasAIHome.tsx](../../home/AtlasAIHome.tsx) — the chat list that opens a session into this component (not yet documented)
