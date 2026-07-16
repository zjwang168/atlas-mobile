@AGENTS.md

# Documentation-First Protocol

**Before reading or editing any `.tsx` / `.ts` file, read the `.md` doc in the same directory first.**

## Task order

1. Read the `.md` doc for the feature or component you are touching.
2. Follow any cross-references it lists.
3. Then read the source files.
4. After making changes, update the doc before finishing — see **Documentation Maintenance** below.

---

# Architecture Overview

```
App.tsx (HomeProvider — wraps AppContent, not just HomeScreen; see HOME.md)
└── HomeScreen
    ├── MapboxMap                  full-screen map background
    ├── TopNav                     absolute overlay — search + globe/navigate
    ├── pager (2 pages, each a HomePanel/ContentPanel)
    │   ├── My Places tab
    │   └── My Plan tab            plan grid + inline CreatePlan wizard
    ├── AIChatBox (ContentPanel)   Atlas AI sidekick — not a tab, see HOME.md
    ├── PlaceDetail (ContentPanel) overlay: place info, triggered via HomeContext
    ├── PlanDetail (ContentPanel)  overlay: plan schedule, triggered via HomeContext
    ├── AddPlaceToPlan (ContentPanel) overlay: place picker, triggered via HomeContext
    └── HomeTabBar                 native iOS tab bar (My Places / My Plan / Add)
```

Cross-feature communication is exclusively through `HomeContext.setOverlay()`. Features do not import each other. See `HOME.md` for the full breakdown.

---

# Finding Docs

Every feature, component, and service layer has a co-located `.md` file. Discover them:

```bash
find src -name "*.md" | sort
```

**`App.tsx` lives at the repo root, outside `src/`, so the command above never surfaces it — but it's the composition root:** it owns provider placement (`HomeProvider`), the top-level screen switch (Home / Import / Analyzing / Save), and the import→save→chat wiring. When tracing where a context/provider lives or who else consumes a piece of shared state, check `App.tsx` directly, not just feature docs.

Key entry points if you need a starting point:

- Feature docs: `src/features/<name>/<NAME>.md`
- Subfeature docs: `src/features/<name>/<sub>/<SUB>.md` — every named subdirectory inside a feature has its own doc
- Component docs: `src/components/<name>/<NAME>.md`
- UI primitives: `src/components/ui/UI.md`
- Types: `src/types/TYPES.md`
- Services: `src/services/SERVICES.md`
- Theme tokens: `src/theme/THEME.md`
- Home / overlay system: `src/features/home/HOME.md` — read first for any cross-feature work

**Stale — do not use:** `src/features/my-plan/PLAN-MODE.md` (superseded by `MY-PLAN.md`)

---

# Reuse Rules

## Overlays and panels

- New overlay: add a variant to the `Overlay` union in `HomeContext.tsx`, render it inside `HomeScreenContent`, and document it in `HOME.md`.
- Any overlay or slideable panel: wrap in `ContentPanel` (see `CONTENT-PANEL.md`). Never build a custom bottom sheet.

## UI primitives

Never use raw React Native primitives — always use the wrappers in `src/components/ui/`:

| Raw RN | Use instead |
|---|---|
| `<Text>` | `@/components/ui/text` |
| `<TextInput>` | `@/components/ui/input` |
| `<Pressable>` / `<TouchableOpacity>` for buttons | `@/components/ui/button` |
| Badge/chip | `@/components/ui/badge` |
| User avatar | `@/components/ui/avatar` |

## Design tokens

Never hardcode hex colors. Use NativeWind token classes — see `src/theme/THEME.md` for the full table. Common ones: `text-foreground`, `text-text-primary`, `text-text-secondary`, `text-text-tertiary`, `bg-background`, `bg-muted`, `bg-primary`, `border-border`, `bg-handle`.

For icon colors (CSS variables don't work): use `useColorScheme()` and pick `'#fafafa'` (dark) / `'#0a0a0a'` (light).

## Types

Import from `src/types/` — never re-declare inline:

- `Place` / `PlaceDetail` / `PlaceTag` / `PlaceLink` → `@/types/place`
- `ParseResult` / `ChatMessage` / `GeocodedLocation` → `@/types/route`
- `SavedPlan` / `PlanDateSlot` → `@/features/my-plan/create-plan/savePlan`
- `PlannedPlace` / `SlotKey` / `PlacesState` / `VisitSlot` → `@/features/my-plan/create-plan/plan-place/types`

## Services

Never call `fetch()` inside a feature — use a service in `src/services/`. See `SERVICES.md`.

## Lists and cards

- Place list rows → `<PlaceCard>` (`@/components/place-card/PlaceCard`)
- Plan grid cells → `<PlanCard>` (`@/components/plan-card/PlanCard`)

## Adding places to a plan slot

```ts
const { setOverlay } = useHome();
setOverlay({ kind: 'addPlaceToPlan', onSelect: (places) => { /* insert */ } });
```

Never render `<AddPlaceToPlan>` directly — only `HomeScreen` owns that instance.

---

# Documentation Maintenance

**Update the doc whenever the public API changes.** Public API means: props, exported functions/hooks, and behavior visible to consumers. Integration/wiring details belong in **Behaviour** (or inline comments in the **API** code block) — there's no separate Integration section.

Internal implementation details — local variables, private helpers, internal control flow — belong in code comments, not docs.

## What requires a doc update

| Change | What to update |
|---|---|
| Props added, removed, or renamed | **API** section of the component/feature doc |
| New exported function or hook | Add to the doc's **API** section |
| New overlay kind in `HomeContext` | `Overlay` type block in `HOME.md` |
| New feature directory created | Create `FEATURE-NAME.md` using the template below |
| New subdirectory created inside a feature | Create `<SUBDIR-NAME>.md` in that directory using the template below |
| New component directory created | Create `COMPONENT-NAME.md` using the template below |
| Service stub activated (file goes from empty to real) | Replace stub notice in `SERVICES.md` with the real API |
| New shared type added to `src/types/` | Add to `TYPES.md` |
| New design token | Add to `THEME.md` and `UI.md` token tables |
| File moved, renamed, or deleted | Update any doc whose **API** or **Related docs** referenced it |
| Behaviour change visible to callers | Update the **Behaviour** section |

## What does NOT require a doc update

- Renaming or refactoring internal implementation (no public API change)
- Adding code comments
- Bug fixes that preserve existing behaviour and props

## Update rules

- **Edit in place** — update the existing section. Never append a "Changes" or "Updated" paragraph.
- **No changelog prose** — docs describe current state, not history. History belongs in git commits.
- **Accuracy over completeness** — if uncertain about a detail, omit it rather than guess.
- **Conform to the Doc Template as you touch a doc** — the template below isn't just for new docs. Any time you update an existing doc, bring the section(s) you're touching in line with it: collapse verbose Overview paragraphs to one sentence, fold Props/Exports/Integration content into a single **API** block with inline one-sentence comments, and delete any "Usage Examples" section you encounter (fold a genuinely load-bearing example into **Behaviour** or **API** instead). Don't do a wholesale rewrite of unrelated sections in the same doc just to reformat them — conform incrementally as you pass through.

---

# Doc Template

Use this structure when creating a new doc. Keep every doc short — overview, behaviour, and API only. Omit sections that don't apply.

```markdown
# <Feature or Component Name>

## Overview

One sentence: what this does and when to use it.

## Behaviour

High-level only: the runtime modes/states *this* component or hook can be in, and the one or two non-obvious rules a caller needs to know to trigger or observe them. Not a walkthrough of every interaction, and not commentary on other components (what exists, what's wired up, what's dead) — that belongs in the Overview's component tree or a note beside it. Skip this section for stateless components.

Describe what the component **does now**, observed from the current code — not what it *should* do, *used to* do, or a spec/standard it's meant to conform to. If current behaviour looks wrong, that's a bug to fix or flag, not something to document as the target state.

## API

\`\`\`ts
type XxxProps = {
  requiredProp: string;      // one-sentence description
  optionalProp?: boolean;    // default: false — one-sentence description
  callback: (result: SomeType) => void;  // one-sentence description
};

export function doSomething(input: Input): Output  // one-sentence description
export type SomeType = { ... }                      // one-sentence description
```

## Related docs

- [OTHER.md](../other/OTHER.md) — why it's related
```
