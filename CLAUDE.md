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
HomeScreen (HomeProvider)
├── MapboxMap                  full-screen map background
├── TopNav                     absolute overlay — search + globe/navigate
├── HomePanel (ContentPanel)   draggable bottom sheet; hidden when any overlay is active
│   ├── MyPlaces tab           place list + Atlas sub-tabs
│   └── MyPlan tab             plan grid + inline CreatePlan wizard
├── PlaceDetail (ContentPanel) overlay: place info, triggered via HomeContext
├── PlanDetail (ContentPanel)  overlay: plan schedule, triggered via HomeContext
├── AddPlaceToPlan (ContentPanel) overlay: place picker, triggered via HomeContext
└── HomeTabBar                 native iOS tab bar (My Places / My Plan / Add)
```

Cross-feature communication is exclusively through `HomeContext.setOverlay()`. Features do not import each other.

---

# Finding Docs

Every feature, component, and service layer has a co-located `.md` file. Discover them:

```bash
find src -name "*.md" | sort
```

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

**Update the doc whenever the public API changes.** Public API means: props, exported functions/hooks, integration contracts (how callers wire this up), and behavior visible to consumers.

Internal implementation details — local variables, private helpers, internal control flow — belong in code comments, not docs.

## What requires a doc update

| Change | What to update |
|---|---|
| Props added, removed, or renamed | **Props** section of the component/feature doc |
| New exported function or hook | Add to the doc's API section |
| New overlay kind in `HomeContext` | `Overlay` type block + usage examples in `HOME.md` |
| New feature directory created | Create `FEATURE-NAME.md` using the template below |
| New subdirectory created inside a feature | Create `<SUBDIR-NAME>.md` in that directory using the template below |
| New component directory created | Create `COMPONENT-NAME.md` using the template below |
| Service stub activated (file goes from empty to real) | Replace stub notice in `SERVICES.md` with the real API |
| New shared type added to `src/types/` | Add to `TYPES.md` |
| New design token | Add to `THEME.md` and `UI.md` token tables |
| File moved, renamed, or deleted | Update **File Structure** sections in any doc that referenced it |
| Behaviour change visible to callers | Update the **Behaviour** or **Modes** section |

## What does NOT require a doc update

- Renaming or refactoring internal implementation (no public API change)
- Adding code comments
- Bug fixes that preserve existing behaviour and props

## Update rules

- **Edit in place** — update the existing section. Never append a "Changes" or "Updated" paragraph.
- **No changelog prose** — docs describe current state, not history. History belongs in git commits.
- **Accuracy over completeness** — if uncertain about a detail, omit it rather than guess.

---

# Doc Template

Use this structure when creating a new doc. Omit sections that don't apply.

```markdown
# <Feature or Component Name>

## Overview

One paragraph: what this does and when to use it. Mention what it does NOT do if that's non-obvious.

## File Structure

\`\`\`
src/features/<name>/
  MainFile.tsx        ← one-line description
  sub/Helper.tsx      ← one-line description
  <NAME>.md           ← this document
\`\`\`

## Props

\`\`\`ts
type XxxProps = {
  requiredProp: string;
  optionalProp?: boolean;  // default: false — what it does
  callback: (result: SomeType) => void;
};
\`\`\`

## Exports / API  (for non-component modules)

\`\`\`ts
export function doSomething(input: Input): Output
export type SomeType = { ... }
\`\`\`

## Behaviour  (for stateful components)

Describe modes, states, or non-obvious interactions visible to callers.

## Integration

How callers wire this up. Include a minimal code example if the wiring is non-trivial.

## Related docs

- [OTHER.md](../other/OTHER.md) — why it's related
```
