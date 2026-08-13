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
    │   └── overlays            SearchPanel / DebugPanel / CreatePlan / PlaceDetail / PlanDetail / AtlasDetail / AddPlace
    └── SaveScreen              rendered when overlay === 'save', replaces HomeScreen entirely
```

`HomeProvider` wraps `AppContent` in `App.tsx`, one level above `HomeScreen` — not inside it. `AppContent` calls `useHome()` directly to drive the import parse → save → chat-history flow, and that flow runs while `SaveScreen` (a sibling of `HomeScreen`, not a child) is on screen. If the provider only wrapped `HomeScreen`, `AppContent`'s own `useHome()` call would have no provider above it. Don't move `HomeProvider` inside `HomeScreen` without first extracting that import/save logic out of `AppContent`.

## Behaviour

- The tab bar drives a persistent 2-page pager (My Places / My Plan) rather than screen navigation — both pages stay mounted.
- `AIChatBox` appears as a sidekick layered over the pager, not as its own tab or page.
- Panels and overlays are mutually exclusive, gated by `overlay.kind` and `activeSidekick` — except `CreatePlan`, which `HomeScreen` also keeps mounted while `overlay` is `{ kind: 'addPlace', returnTo: { kind: 'createPlan' } }`, so the `addPlace` overlay can sit on top of it without unmounting the wizard (see `CREATE-PLAN.md`).
- Location is requested once when `HomeProvider` mounts. A refusal is not retried automatically — iOS will not re-prompt anyway — so `userLocation` stays at the default centre and the map's puck stays hidden until the user taps the locate button, which is the deliberate retry.
- `HomePanel` (both tabs), `PlaceDetail`, `AtlasDetail`, and `AddPlace` all use the same `ContentPanel` snap group (`home-main`), so a panel opened without an explicit snap state inherits the last settled height. The group memory is owned by `src/components/content-panel`, not `HomeContext`, and it is broadcast about a frame after a drag-release snap (not deferred to spring completion) so a panel becoming visible mid-spring doesn't briefly show a stale height. `HomeScreen` only forwards a `ContentPanel`'s `onHeightChange` into the map's camera padding for whichever one is actually the on-screen driver (active tab, `PlaceDetail` while its overlay is open, `AtlasDetail` while its overlay is open, or `AddPlace` while its overlay is open) — the other synced-but-off-screen instances still inherit state consistency, but don't fight over the camera. `AtlasDetail` and `AddPlace` both pass `minSnap="default"` since neither has a `compactContent` — without it, either could inherit `compact` from `HomePanel` (the group's most common resting state, since it's the always-visible member) with nothing sane to render there — see `CONTENT-PANEL.md` Snap Groups. `HomeScreen`'s own read of the group's settled state (used for the map's discrete padding recenter, not per-frame dragging) is deliberately delayed roughly one spring's settle time behind the group's raw value — firing that recenter mid-spring would compete with the panel's own height animation on the JS thread.

## API

`HomeContext` is split into five domain contexts (Overlay, Location, Places, Atlases, ChatHistory), each with its own `useMemo`'d value, so a consumer that reads only one domain doesn't re-render when an unrelated domain changes (e.g. a `PlaceCard` reading only `useHomeOverlay()`/`useHomePlaces()` doesn't re-render when chat history syncs). `useHome()` composes all five into one object for consumers that genuinely span multiple domains (e.g. `HomeScreen`, `AllPlaces`) — prefer the narrower hook when a component only needs one domain.

```ts
// src/features/home/HomeContext.tsx
function useHomeOverlay(): {
  overlay: Overlay; setOverlay: (o: Overlay) => void;              // active full-screen overlay
  tabBarVisible: boolean; setTabBarVisible: (v: boolean) => void;  // fades the native tab bar
  atlasMapState: AtlasMapState; setAtlasMapState: (s: AtlasMapState) => void;  // temporary map ownership for the map-first Atlas editor
  activeSidekick: 'none' | 'aiChat' | 'places'; setActiveSidekick: (s) => void;  // 'aiChat' shows AIChatBox
  importNotification: { visible: boolean; title: string; places: ParsedPlace[] } | null;
  setImportNotification: (n) => void;                               // import completion toast payload
};

function useHomeLocation(): {
  userLocation: [number, number];                                   // device position, or DEFAULT_MAP_CENTER when permission is refused or the fix fails
  locationStatus: 'undetermined' | 'granted' | 'denied';            // gates the map's location puck
  isLocationFallback: boolean;                                      // true when userLocation is the default centre, not a real fix
  refreshUserLocation: () => Promise<[number, number]>;             // re-reads position, prompting on first call; resolves to the fallback rather than rejecting
};

function useHomePlaces(): {
  parsedPlaces: ParsedPlace[]; setParsedPlaces: (p: ParsedPlace[]) => void;  // in-progress import results, drive map markers
  savedPlaces: SavedPlace[]; setSavedPlaces: (p: SavedPlace[]) => void;     // places persisted to Supabase
  refreshSavedPlaces: () => Promise<void>;                          // re-fetches savedPlaces
  deleteSavedPlace: (id: string) => Promise<void>;                  // deletes a saved place
  updateSavedPlaceNote: (id: string, note: string) => Promise<void>; // updates a saved place's note; local cache first, syncs to Supabase
  selectedPlaceCoordinate: [number, number] | null; setSelectedPlaceCoordinate: (c) => void;  // centers the map when set
  selectedPlaceId: string | null; setSelectedPlaceId: (id) => void;  // highlights the map marker; set on every place-row tap (not a toggle) — My Places rows have no selected-state styling, but the chat-history places panel highlights its own row
};

function useHomeAtlases(): {
  atlases: Atlas[];                                                 // atlases persisted to Supabase, local-cache-backed
  refreshAtlases: () => Promise<void>;                              // re-fetches atlases
  createAtlas: (title: string) => Promise<Atlas | null>;            // optimistic local create, syncs to Supabase; null on failure
  deleteAtlas: (id: string) => Promise<void>;                       // optimistic local delete, syncs to Supabase; atlas_places rows cascade; alerts on failure
  atlasPlaces: AtlasPlace[];                                        // every atlas_places row for every atlas; filter by atlas_id for one atlas
  addPlacesToAtlas: (atlasId: string, placeIds: string[]) => Promise<void>;  // optimistic local insert, syncs to Supabase; skips places already in the atlas; alerts on failure
  removePlaceFromAtlas: (joinRowId: string) => Promise<void>;       // removes by atlas_places row id (not place id); local cache first, syncs to Supabase; alerts on failure
};

function useHomeChatHistory(): {
  chatHistory: ChatHistoryItem[]; setChatHistory: (i: ChatHistoryItem[]) => void;  // cached past import/chat sessions (max 50)
  deletedChatHistory: ChatHistoryItem[];                            // soft-deleted items
  activeHistoryItem: ChatHistoryItem | null; setActiveHistoryItem: (i: ChatHistoryItem | null) => void;  // session shown by AIChatBox
  addChatHistoryItem: (item: Omit<ChatHistoryItem, 'id' | 'createdAt'>) => string;  // optimistic add, returns temp id
  replaceChatHistoryItem: (tempId: string, item: ChatHistoryItem) => void;  // swap optimistic entry once Supabase confirms
  deleteChatHistoryItem: (id: string) => void;                      // soft delete
  restoreChatHistoryItem: (id: string) => void;                     // undo soft delete
};

function useHome(): ReturnType<typeof useHomeOverlay> & ReturnType<typeof useHomeLocation>
  & ReturnType<typeof useHomePlaces> & ReturnType<typeof useHomeAtlases> & ReturnType<typeof useHomeChatHistory>;  // composes all five domains

type Overlay =
  | { kind: 'none' }
  | { kind: 'search' }
  | { kind: 'debug' }
  | { kind: 'placeDetail'; placeId: string; returnTo?: Overlay }  // returnTo is the overlay to restore on dismiss — the trigger's own overlay state at the time it opened this (e.g. PlaceCard captures useHome().overlay); omit to fall back to `{ kind: 'none' }`
  | { kind: 'planDetail'; planId: string }
  | { kind: 'atlasDetail'; atlasId: string }
  | { kind: 'addPlace'; onSelect: (places: PlaceDetail[]) => void; excludeIds?: string[]; returnTo?: Overlay }  // excludeIds hides already-selected places (e.g. AtlasDetail passes places already in the atlas); omit to allow duplicates (e.g. the plan flow). returnTo is the overlay to restore on dismiss/confirm — the caller's own overlay state (e.g. `{ kind: 'atlasDetail', atlasId }`); omit to fall back to `{ kind: 'none' }`
  | { kind: 'createPlan' };

// src/features/home/HomeTabBar.tsx
const TAB_PLACES: string;  // pager page 0
const TAB_PLAN: string;    // pager page 1
const TAB_ADD: string;     // not a pager page — triggers onAddPress instead
```

## Related docs

- [CHAT-HISTORY.md](../atlas-ai/chat-history/CHAT-HISTORY.md) — `AtlasAIHome` / `HistoryPlacesPanel`, currently unmounted
- [AI-CHAT.md](../atlas-ai/ai-chat/AI-CHAT.md) — `AIChatBox`, mounted directly by `HomeScreen`
- [ADD-PLACE.md](../add-place/ADD-PLACE.md) — `AddPlace` overlay, opened via the `addPlace` `Overlay` variant
