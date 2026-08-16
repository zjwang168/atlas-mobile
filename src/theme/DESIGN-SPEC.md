# Design Spec

## Overview

The visual rules a new screen should follow, distilled from what the app already does — read this before building a page, so a new screen doesn't invent its own radius, shadow, or type scale.

**Status: draft.** Every value below was measured from the current codebase, not proposed from scratch. Where the codebase is inconsistent, the spec names the value to converge on and lists the divergence in [Known divergences](#known-divergences) rather than pretending it's already true.

Companion docs: [THEME.md](THEME.md) is the authoritative token table (colours + type). This document is the *usage* layer — which token, when, and the values that have no token yet.

---

## Typography

Never hand-write `fontSize` / `lineHeight` / `fontWeight`. Import the token:

```ts
import { typography } from '@/theme/typography';
<Text style={typography.bodySmall}>…</Text>
// or the NativeWind utility: <Text className="bodySmall">
```

Full table lives in [THEME.md](THEME.md#typography-utilities). Picking one:

| Use | Token |
|---|---|
| Screen / sheet title | `h3` (20/26) |
| Profile name, hero title | `h2` (22/28) |
| Card title, list-row title | `subheader` (16/22) |
| Section title inside a card | `bodyEmphasis` (17/24) |
| Row label, primary body | `body` (17/24) |
| One- or two-line supporting text | `bodySmall` (15/20) |
| Multi-line prose (a place summary) | `bodySmallRelaxed` (15/22) |
| Card subtitle, metadata | `caption` (14/18) |
| Stat label, chip label | `captionMedium` (14/20) |
| Tab bar label | `labelTab` (11/14) |

### Tracking

Headings carry −1% tracking (`display` −0.28, `h2` −0.22, `h3` −0.2); everything else is 0. Both numbers are already baked into the token — **do not add a `letterSpacing` override at the call site.** If a design needs different tracking, that's a token change, not a local one.

One sanctioned exception: `AllPlaces.tsx`'s `sectionTitle` overrides `h3` to `letterSpacing: 0` for the home section headers ("Saved places", "Atlas"). Deliberate; leave it.

---

## Colour

Never hardcode a hex. Use the NativeWind token class — see [THEME.md](THEME.md#token-reference).

```tsx
<View className="bg-card border-border">
  <Text className="text-text-primary">…</Text>
```

Icons can't read CSS variables, so they take a literal — resolve it through `useColorScheme()` rather than writing a light-mode hex inline:

```ts
const colorScheme = useColorScheme();
const fg = colorScheme === 'dark' ? '#fafafa' : '#0a0a0a';
```

Common resolved values, for recognising them in existing code: `--card` `#ffffff`, `--border` `#ebebeb`, `--text-primary` `#1a1a1a`, `--text-secondary` `#717171`, `--text-tertiary` `#b0b0b0`, `--primary` `#12c170`.

---

## Layout and spacing

- **Screen gutter is 16.** Every full-width element on a page or sheet sits 16 from the edge — headers, card stacks, section labels alike. Dominant across the app (56 occurrences vs. scattered 20/12/14).
- **Gap scale: 4 / 8 / 12 / 16 / 24.** 4 binds a label to its control, 8 groups icon+text within a row, 12–16 separates cards, 24 separates major blocks.
- **Vertical rhythm inside a page**: block → 24 → block; card → 16 → card; label → 4 → the card it labels.

### Fixed headers over scrolling content

When a panel has a header that stays put while content scrolls under it, the gap below the header belongs to **the header's `paddingBottom`**, not the scroll view's `paddingTop`. Padding on scroll content scrolls away and lets the content ride up against the header. See `PlaceDetailHeader.tsx`.

---

## Cards

The standard surface card:

```ts
{
  borderRadius: 20,
  borderCurve: 'continuous',   // always — iOS squircle, not a circular arc
  borderWidth: 0.5,
  // colours via className="bg-card border-border"
  ...elevation.card,           // see Elevation below
}
```

Reference implementations: `DetailCard.tsx`, `AllPlaces.tsx`'s `atlasRow`, `EventCard.tsx`.

`borderCurve: 'continuous'` is not optional. A 20pt circular-arc corner reads visibly different next to a squircle one, and the app is all squircle.

### Radius scale

| Radius | Use |
|---|---|
| 8 | Inline chips, small tags |
| 12 | Thumbnails, photo tiles |
| 16 | Compact cards (stat tiles) |
| 20 | Standard surface card, list rows |
| 100 | Fully round — pills, circular buttons |

Use `100` for fully-round, not `999` / `9999`. Any value ≥ half the height renders identically; one spelling keeps it greppable.

### Elevation

Never write shadow values inline. Spread a token from `elevation.ts`:

```ts
import { elevation } from '@/theme/elevation';

card: { borderRadius: 20, borderCurve: 'continuous', ...elevation.card }
```

| Token | Use |
|---|---|
| `elevation.card` | Resting surfaces — list rows, detail cards, stat tiles |
| `elevation.floatingButton` | Circular controls over a map or a photo |

Those two are the ratified set. Other surfaces still carry their own local values; they get added here page by page as each is agreed on, so **don't assume an existing shadow elsewhere in the app is a standard** — if a new surface needs something the two tokens don't cover, keep the value local and raise it.

One trap when adding a level: RN's CSS `boxShadow` blur radius is roughly twice the legacy `shadowRadius`, so the two spellings are not interchangeable. Store each level in whichever form it was tuned in, and say which — `elevation.floatingButton` is deliberately in the legacy form for exactly this reason.

---

## Icons

**Phosphor is the standard.** Import the specific icon so Metro doesn't pull the whole set:

```ts
import { MapPinIcon } from 'phosphor-react-native/src/icons/MapPin';
```

- **Sizes**: 20 is the default (row leading icons, buttons). 16 for inline/secondary, 24 for nav-bar buttons, 14 for chip glyphs.
- **Weights**: `bold` for standalone UI glyphs (close, carets, nav), `fill` for state and category markers, `regular` for icons paired with a text label in a settings-style row.
- **Colour**: pass a literal resolved from `useColorScheme()`, never a bare light-mode hex.

---

## Panels and sheets

- Any sliding/draggable surface uses `ContentPanel` — never hand-roll a bottom sheet. See [CONTENT-PANEL.md](../components/content-panel/CONTENT-PANEL.md).
- Every panel renders a 28pt `PanelGrabber` at its top. Content starts **4** below it, which puts the first row ~16 below the visible grab bar. `MyPlaces.tsx`'s `filterRow` and `PlaceDetailHeader.tsx` are the two references — match them, don't re-derive.
- Cross-feature navigation is `HomeContext.setOverlay()` only. See [HOME.md](../features/home/HOME.md).
- A detail overlay that shares a `snapGroup` with the home panel must reset the group to `'default'` when dismissing back to the home screen, or a full-height detail leaves the home panel full-screen.

---

## UI primitives

Never use raw React Native primitives — the wrappers carry the tokens:

| Raw RN | Use instead |
|---|---|
| `<Text>` | `@/components/ui/text` |
| `<TextInput>` | `@/components/ui/input` |
| `<Pressable>` for a button | `@/components/ui/button` |
| Badge / chip | `@/components/ui/badge` |
| Place list row | `@/components/place-card/PlaceCard` |
| Plan grid cell | `@/components/plan-card/PlanCard` |

---

## Known divergences

Where the codebase does not yet match the spec above. Fix opportunistically when touching the file — none of these are urgent on their own.

| Divergence | Scale | Target |
|---|---|---|
| `@expo/vector-icons` `Ionicons` still renders in ~127 places across 32 files | Large | Phosphor equivalents |
| Radius values 9, 14, 17, 18, 21, 22, 28 in circulation alongside the scale | ~60 sites | Nearest scale step |
| Fully-round written as `999` (16 sites) and `100` (13 sites) | Medium | `100` |
| ~13 one-off `boxShadow` values + 7 one-off legacy shadow prop sets | Medium | An `elevation` token, once that surface's level is agreed |
| Hardcoded hex `COLOR` maps instead of token classes (e.g. `ProfileSettings.tsx`, `ImportScreen.tsx`, `AllPlaces.tsx`) | Several features | Token classes |
| `paddingHorizontal` 20 / 12 / 14 where 16 is meant | ~47 sites | 16 |

---

## Related docs

- [THEME.md](THEME.md) — the authoritative colour and type token tables
- [UI.md](../components/ui/UI.md) — the primitive components these rules assume
- [CONTENT-PANEL.md](../components/content-panel/CONTENT-PANEL.md) — the sheet every panel is built on
- [HOME.md](../features/home/HOME.md) — the overlay system
