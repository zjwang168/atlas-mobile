# Merging `new-any-links` into `dev`

Working document for the merge. Delete it once the merge lands.

Merge base is `ef25394`, which predates both HJ's home-screen redesign and the
search/GPS/PlaceCover work — 26 commits on their side, 22 on ours, from a
common ancestor that is older than either. Merged in one shot it is 16 files
and 52 conflict hunks.

## Why staged, and why this order

Measured in a throwaway worktree, merging their branch in four stages instead
of one moves most of the pain into the first step and leaves the camera work
almost clean:

| Stage | Ends at | Content | Files | Hunks |
|---|---|---|---:|---:|
| S1 | `f4fbae3` | anylinks — TikTok / Reels / Facebook | 10 | 31 |
| S2 | `3dbc14e` | plan module v1 → v2.1.1 | 5 | 11 |
| S3 | `7c1c26c` | **camera fixes** + search bar | 1 | ~0 |
| S4 | `3b216db` | ai-chat sidekick | 0 | 0 |

The order is forced by when two symbols appear on their side:

- `atlasMapState` (centerCoordinate / zoomLevel) arrives in **S2** (`26c8fd9`).
- `cameraVerticalOffset` arrives in **S3** (`9691861`, `b90fc9a` — Jay's two
  camera-fix commits), and is touched again in S4.

So the agreed padding formula cannot be written in S1: neither symbol exists
yet. It lands in S3, which is also the first point where Jay's verification
flow means anything.

## Agreed decisions

| Decision | Applies in | Source |
|---|---|---|
| Keep dev's async-storage `^3.1.1` + `removeMany` | S1 | Jay — the downgrade was AI-generated while resolving CocoaPods, not intentional |
| `paddingBottom = settledBottomPanelHeight + atlasCameraVerticalOffset` | S3 | HJ — no longer `SNAP_HEIGHTS` |
| Every other Atlas camera change: take Jay's | S2 / S3 | Jay |
| Keep `flyTo`; `focusCoordinate` is don't-care | S1 | Jay — it has no callers on their branch |

## Two conflicts git will not report

**`localStore.ts`.** Their `ef71c5f` (inside S1) reverted `removeMany` back to
`multiRemove` and pinned async-storage to `2.2.0`. Dev has not touched that
file since the merge base, so git sees a one-sided change and **takes theirs
silently, with no conflict marker**. After S1, check by hand:

```
grep removeMany src/services/local/localStore.ts     # must be present
grep async-storage package.json                      # must be ^3.1.1
```

**`Atlas.tsx`.** Reports `UU` in S3 but contains zero conflict markers —
likely a line-ending difference. Look before treating it as a content
conflict.

---

## S1 — anylinks (10 files, 31 hunks)

```
git merge --no-ff f4fbae3
```

| File | Take | Why |
|---|---|---|
| `placeService.ts` (8 hunks) | **Both sides, not either** | Both added columns to the `places` SELECT: ours `external_place_id`/`external_source` (extracted into `PLACE_COLUMNS`), theirs `city`/`country`. Fold `city, country` into `PLACE_COLUMNS` and six of the hunks resolve at once. Keep both field pairs on `SavedPlace` and on the optimistic row. |
| `MapboxMap.tsx` | **Theirs, then re-apply dev's delta** | They rewrote it 249 → 981 lines; dev only added the compass comment, `compassEnabled={false}`, and `flyTo`. Moving dev's small delta onto their file is far cheaper than the reverse. Confirm `flyTo` survives on the handle. |
| `HomeScreen.tsx` | **Dev for anything camera or panel** | Their offset does not exist yet at this commit. `mainSheetVisible` / `mainSheetPaused` / `settledBottomPanelHeight` are HJ's native-sheet model and must not be replaced by `homePanelVisible`. |
| `App.tsx`, `HomePanel`, `HomeTabBar`, `MyPlaces`, `AllPlaces`, `PlaceCard` | Hunk by hunk | Mostly HJ's redesign against their older structure; HJ's is newer. |
| `backend/main.py` | Both | Our `/places/retrieve` photo backfill and their anylinks routes are in different places. |

**Verify — not Jay's atlas flow.** Atlas does not exist yet at this stage.

- `npx tsc --noEmit` clean
- App launches, map renders, **locate button (`flyTo`) works**
- Discover search: type → results → save shows saved / already-saved
- The two silent conflicts above are corrected

---

## S2 — plan module (5 files, 11 hunks)

```
git merge --no-ff 3dbc14e
```

`atlasMapState` arrives here. Conflicts in `HomeContext`, `ContentPanel`,
`TopNav`, `LeftNav`, `MyPlan`.

- `HomeContext` — **both**: their `atlasMapState`, our `savedPlaces` /
  `atlases` / `userLocation`.
- `TopNav` / `LeftNav` — **dev**: HJ's Saved/Discover switch and locate arrow
  are the newer design.
- `ContentPanel` — **dev**: 632 lines against their 499, and ours carries the
  stabilised `reportScrollY`.

**Verify:** `tsc` clean, and the first half of Jay's flow runs (create atlas →
edit atlas → save). Camera focus being wrong here is expected — the offset has
not arrived.

---

## S3 — camera fixes (1 file, the important stage)

```
git merge --no-ff 7c1c26c
```

`cameraVerticalOffset` arrives. **The only hand-written merge in the whole
operation**; everything else in this stage is Jay's:

```ts
paddingBottom: bottomPanelActive
  ? Math.max(0, settledBottomPanelHeight + atlasCameraVerticalOffset)
  : 0,
// deps: [atlasCameraVerticalOffset, bottomPanelActive, settledBottomPanelHeight]
```

Keep Jay's `Math.max(0, …)`; replace his `SNAP_HEIGHTS[settledPanelSnapState]`
with HJ's `settledBottomPanelHeight`. **The ref path (`setPaddingBottom`) needs
the same treatment** — changing only the memo and missing the ref is the easy
mistake here.

**Verify — Jay's full flow:**

```
create atlas → edit atlas → save
→ tap edit (top right) → re-enter edit atlas → save again
```

None of the three regressions may reappear:

1. Camera **focuses on the clusters** rather than not focusing.
2. **Zoom level is right.**
3. After switching pages the camera **stays on the current atlas's focus
   bounds** instead of retreating to the My Places GPS default.

Also re-check ours: locate button, and map padding tracking a panel drag.

---

## S4 — ai-chat (0 conflicts)

```
git merge --no-ff 3b216db
```

Measured clean. But it **touches `cameraVerticalOffset` again** (`44ac2c8`,
`08cdd56`), so **re-run the S3 camera verification** afterwards to confirm the
offset logic was not undone.

---

## After the merge

1. **Dependencies** — six new packages (`expo-audio`, `expo-media-library`,
   `expo-notifications`, `expo-sharing`, `react-native-share`,
   `react-native-view-shot`) plus several Expo bumps. Needs `npm install` and
   iOS pod work: **targeted `pod update <drifted pods>`, never delete
   `Podfile.lock`** — `ios/` is untracked, so the lock is unrecoverable, and a
   full re-resolve risks a Mapbox SDK download that cannot authenticate.
2. **SQL** — run `docs/migrations/20260808_map_first_atlas.sql`,
   `20260808_place_pin_history.sql`, and the `schema-conversations.sql` update
   against Supabase. Merging the code without migrating the database fails at
   runtime, not at build.
3. **Backend** — new service files under `backend/services/`; confirm the
   reloader picked them up.
4. **`.env`** — add `APIFY_TOKEN` and the three actor ids. No Python
   dependency needed: the Apify integration calls the REST API through
   `httpx`, which `backend/requirements.txt` already has.
