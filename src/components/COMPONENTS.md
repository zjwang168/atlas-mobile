# Shared Components

Reusable components consumed across multiple features. Nothing in this directory should import from `src/features/`.

Each component has its own doc file — **read the doc before editing the component**:

| Component | Doc | Purpose |
|---|---|---|
| `content-panel/ContentPanel` | [CONTENT-PANEL.md](content-panel/CONTENT-PANEL.md) | Draggable bottom sheet with snap states |
| `place-cover/PlaceCover` | [PLACE-COVER.md](place-cover/PLACE-COVER.md) | Category-coloured fallback cover for thumbnails with no photo |
| `save-affordance/SaveAffordance` | [SAVE-AFFORDANCE.md](save-affordance/SAVE-AFFORDANCE.md) | Trailing save indicator on a searchable place row — add / saving / saved / already saved |
| `search-bar/SearchBar` | [SEARCH-BAR.md](search-bar/SEARCH-BAR.md) | URL input bar (currently unmounted) |
| `top-nav/TopNav` | [TOP-NAV.md](top-nav/TOP-NAV.md) | Map overlay nav — search + globe + navigate |
| `ui/*` | [UI.md](ui/UI.md) | All primitive wrappers (Button, Text, Input, Badge, Avatar, Card, AlertDialog) |
