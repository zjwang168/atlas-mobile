# Shared Components

Reusable components consumed across multiple features. Nothing in this directory should import from `src/features/`.

Each component has its own doc file — **read the doc before editing the component**:

| Component | Doc | Purpose |
|---|---|---|
| `content-panel/ContentPanel` | [CONTENT-PANEL.md](content-panel/CONTENT-PANEL.md) | Draggable bottom sheet with snap states |
| `place-card/PlaceCard` | [PLACE-CARD.md](place-card/PLACE-CARD.md) | List row card for a saved place |
| `plan-card/PlanCard` + `usePlanDelete` | [PLAN-CARD.md](plan-card/PLAN-CARD.md) | Grid card for a travel plan |
| `search-bar/SearchBar` | [SEARCH-BAR.md](search-bar/SEARCH-BAR.md) | URL input bar (currently unmounted) |
| `top-nav/TopNav` | [TOP-NAV.md](top-nav/TOP-NAV.md) | Map overlay nav — search + globe + navigate |
| `ui/*` | [UI.md](ui/UI.md) | All primitive wrappers (Button, Text, Input, Badge, Avatar, Card, AlertDialog) |
