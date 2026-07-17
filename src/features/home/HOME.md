# Home Feature

## Overview

The home screen layers a full-screen map, a native tab bar, a two-page draggable content pager (My Places / My Plan), and full-screen overlays, all coordinated through `HomeContext`.

```
App.tsx (HomeProvider)
└── AppContent                 also reads useHome() directly for the import→save→chat flow
    ├── HomeScreen              rendered when overlay === 'none'
    │   ├── MapboxMap           full-screen map background
    │   ├── TopBlurFade / TopNav
    │   ├── pager               horizontal Animated pager, 2 pages
    │   │   ├── HomePanel (My Places)
    │   │   └── HomePanel (My Plan)
    │   ├── AIChatBox           Atlas AI conversation sidekick — not a tab, see Behaviour
    │   ├── HomeTabBar          native iOS tab bar: My Places / My Plan / Add
    │   └── overlays            SearchPanel / DebugPanel / CreatePlan / PlaceDetail / PlanDetail / AddPlaceToPlan
    └── SaveScreen              rendered when overlay === 'save', replaces HomeScreen entirely
```

`HomeProvider` wraps `AppContent` in `App.tsx`, one level above `HomeScreen` — not inside it. `AppContent` calls `useHome()` directly to drive the import parse → save → chat-history flow, and that flow runs while `SaveScreen` (a sibling of `HomeScreen`, not a child) is on screen. If the provider only wrapped `HomeScreen`, `AppContent`'s own `useHome()` call would have no provider above it. Don't move `HomeProvider` inside `HomeScreen` without first extracting that import/save logic out of `AppContent`.

## Behaviour

- The tab bar drives a persistent 2-page pager (My Places / My Plan) rather than screen navigation — both pages stay mounted.
- `AIChatBox` appears as a sidekick layered over the pager, not as its own tab or page.
- Panels and overlays are mutually exclusive, gated by `overlay.kind` and `activeSidekick`.

## API

```ts
// src/features/home/HomeContext.tsx
function useHome(): {
  overlay: Overlay; setOverlay: (o: Overlay) => void;              // active full-screen overlay
  tabBarVisible: boolean; setTabBarVisible: (v: boolean) => void;  // fades the native tab bar
  parsedPlaces: ParsedPlace[]; setParsedPlaces: (p: ParsedPlace[]) => void;  // in-progress import results, drive map markers
  savedPlaces: SavedPlace[]; setSavedPlaces: (p: SavedPlace[]) => void;     // places persisted to Supabase
  refreshSavedPlaces: () => Promise<void>;                          // re-fetches savedPlaces
  deleteSavedPlace: (id: string) => Promise<void>;                  // deletes a saved place
  updateSavedPlaceNote: (id: string, note: string) => Promise<void>; // updates a saved place's note; local cache first, syncs to Supabase
  chatHistory: ChatHistoryItem[]; setChatHistory: (i: ChatHistoryItem[]) => void;  // cached past import/chat sessions (max 50)
  deletedChatHistory: ChatHistoryItem[];                            // soft-deleted items
  activeHistoryItem: ChatHistoryItem | null; setActiveHistoryItem: (i: ChatHistoryItem | null) => void;  // session shown by AIChatBox
  addChatHistoryItem: (item: Omit<ChatHistoryItem, 'id' | 'createdAt'>) => string;  // optimistic add, returns temp id
  replaceChatHistoryItem: (tempId: string, item: ChatHistoryItem) => void;  // swap optimistic entry once Supabase confirms
  deleteChatHistoryItem: (id: string) => void;                      // soft delete
  restoreChatHistoryItem: (id: string) => void;                     // undo soft delete
  selectedPlaceCoordinate: [number, number] | null; setSelectedPlaceCoordinate: (c) => void;  // centers the map when set
  selectedPlaceId: string | null; setSelectedPlaceId: (id) => void;  // highlights the map marker; set on every place-row tap (not a toggle) — My Places rows have no selected-state styling, but the chat-history places panel highlights its own row
  importNotification: { visible: boolean; title: string; places: ParsedPlace[] } | null;
  setImportNotification: (n) => void;                               // import completion toast payload
  activeSidekick: 'none' | 'aiChat' | 'places'; setActiveSidekick: (s) => void;  // 'aiChat' shows AIChatBox
  userLocation: [number, number];                                   // default map center (Seattle) until GPS is wired up
};

type Overlay =
  | { kind: 'none' }
  | { kind: 'search' }
  | { kind: 'debug' }
  | { kind: 'placeDetail'; placeId: string }
  | { kind: 'planDetail'; planId: string }
  | { kind: 'addPlaceToPlan'; onSelect: (places: PlannedPlace[]) => void }
  | { kind: 'createPlan' };

// src/features/home/HomeTabBar.tsx
const TAB_PLACES: string;  // pager page 0
const TAB_PLAN: string;    // pager page 1
const TAB_ADD: string;     // not a pager page — triggers onAddPress instead
```

## Related docs

- [CHAT-HISTORY.md](../atlas-ai/chat-history/CHAT-HISTORY.md) — `AtlasAIHome` / `HistoryPlacesPanel`, currently unmounted
- [AI-CHAT.md](../atlas-ai/ai-chat/AI-CHAT.md) — `AIChatBox`, mounted directly by `HomeScreen`
