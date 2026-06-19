# Kanban Task Board — Design

**Status:** Approved (brainstorm 2026-06-14)
**Goal:** A personal task-progress board layered over the dashboard — organise sessions *and* standalone notes into user-defined stages (To do, In progress, …), independent of the technical Running/Closed/Archived lifecycle.

## Context

The dashboard is a read-only viewer of `~/.claude` sessions with a Running/Closed/Archived lifecycle, config-driven categories, and localStorage UI prefs (pins, theme, accent). The only source-of-truth writes are `config.json` (`set_config`) and the ADR-013 archive write.

The user wants a personal workflow axis — "where am I on my workload" — orthogonal to the technical lifecycle, covering both existing sessions and free-text reminders that have no session.

## Scope (V1)

- A **global** Kanban board as a **3rd view mode** (List · Cards · **Board**).
- **User-configurable columns** (Settings sub-section + inline rename + hover-add).
- **Items**: explicitly-placed sessions + standalone notes.
- **Drag-and-drop** of cards between columns.
- **Storage**: localStorage only (durable file = explicit follow-up, out of scope).

## Architecture & components

### View mode

The titlebar view toggle gains a **Board** option → `viewMode ∈ {list, cards, board}`.
- In **board** mode the board renders full-width; the per-tab UI (Running/Closed/Archived tabs, category filter, sidebar list / cards grid, detail panel) is hidden. The board is **global** — independent of the active tab.
- Switching back to List/Cards restores the tabbed view unchanged.

Because the board is global, it must resolve placed sessions across **all** states. On entering board mode (and on the 5s poll while in it), fetch running + closed + archived sessions once and index them by `sessionKey` for card rendering.

### Data model — localStorage key `csm.kanban`

```json
{
  "columns":    [ { "id": "c1", "name": "To do", "color": "#5ac8fa" } ],
  "placements": { "<sessionKey>": "c1" },
  "notes":      [ { "id": "n1", "text": "Relire le doc", "columnId": "c1" } ]
}
```

- `columns` is ordered. `placements` maps a session's `sessionKey` (notesPath || sessionId || name — the existing stable key) to a `columnId`. `notes` are standalone items.
- Seeded on first use with the default columns below.
- `placements`/`notes` reference `columnId`; deleting a column reassigns its items to `columns[0]`.

**Default columns** (Jira-style, fully editable after): `To do · In progress · To review · Waiting for review · Waiting for info · Done`.

### Columns configuration

- **Settings → new "Kanban" sub-section**: list of columns with rename, reorder, add, remove, optional colour. Persists to localStorage live (mirrors the Appearance section — not tied to the config Save button).
- **Inline on the board**: click a column title → it becomes editable (blur/Enter to save); hovering to the right of the last column reveals a **＋** to add a column.

### Placing sessions on the board

- Explicit add: from the **detail panel** action toolbar (and a hover affordance on list/grid cards), a **"board" action** (bookmark/board icon) → assigns the session to a column (defaults to `columns[0]`). Sets `placements[sessionKey]`.
- Remove from board: a **✕** on the board card deletes `placements[sessionKey]`. This **never touches the session** itself.

### Standalone notes

- **＋ add** at the bottom of each column → inline text input → creates `{ id, text, columnId }`.
- Click a note to edit its text; ✕ to delete.

### Drag-and-drop

- HTML5 DnD: cards are `draggable`; columns are drop targets (`dragover`/`drop`). On drop, update the dragged item's `columnId` (placement or note) and persist.
- **Intra-column ordering is out of scope for V1** — cards render in a stable order (sessions by activity desc, notes by creation). Cross-column move is the V1 capability.

### Rendering

- New `renderer/board.js` owns `renderBoard()` (keeps `ui.js` focused). It reads `csm.kanban` + the combined session index and renders columns → cards.
- **Session card** reuses the existing card visual (status dot + name + category). **Note card** is visually distinct (dashed border + "note" tag).
- A placed session not found in the combined index (notes.md deleted / gone) renders an **"unavailable"** card with a remove button.

### Storage details

- All board state in `localStorage['csm.kanban']` (JSON). Every mutation (place, move, note CRUD, column CRUD) rewrites it. No backend, no Rust changes.
- Consistent with existing prefs (pins, theme, accent) which are already localStorage + managed live in Settings.

## Edge cases

- Delete a column that has items → reassign its items to `columns[0]` (never orphan).
- Empty `columns` (e.g. user deleted all) → re-seed defaults.
- Placed session whose data is gone → "unavailable" card + remove.
- Empty board / empty column → friendly empty state.
- A session can be placed once (single column); placing again moves it.

## Out of scope (V1)

- Durable / file-backed storage — localStorage only (durable prefs file is **follow-up #18**).
- Intra-column manual ordering, multiple boards, swimlanes, WIP limits.
- Generic ticket tracker (Azure DevOps) — **follow-up #16**.
- Copilot / non-Claude-Code backend — **follow-up #17**.

## Testing

- The kanban model is a small pure module (`board-model.js` or functions in `board.js`): add/remove/rename/reorder column (with item reassignment on delete), place/unplace session, note CRUD, column→items resolution. These are **unit-testable in plain JS** (node) and should be.
- DnD, rendering, Settings sub-section, and the place-from-detail affordance are verified manually via `cargo tauri dev`.
