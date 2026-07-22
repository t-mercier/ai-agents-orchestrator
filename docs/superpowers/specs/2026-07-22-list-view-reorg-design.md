# List-view reorg: category order + session drag-reorder + grouping — Design

**Date:** 2026-07-22
**Status:** Approved (brainstorming), pending implementation plan
**Scope:** List view only (Cards and Board views unchanged).

## Goal

Let the user reorganize the **List view**:
- **A.** Drag-reorder categories (persisted), and move the "Recent · unmanaged" block to any position (notably the bottom).
- **B1.** Drag-reorder sessions within their category (persisted manual order).
- **B2.** Create collapsible **groups** inside a category and drag sessions into them — to cluster related sessions (e.g. sub-tickets of a parent Jira ticket).

**Explicitly out of scope (no "C"):** moving a session to a *different* category. All reordering/grouping happens *within* a session's own category. No new backend writes to `~/.claude`; sessions' `category` (notes.md frontmatter + folder) is never modified.

## Background / current state

- Category order lives in config `order` (`config.rs`), read by `window.CSMCategories.order()` (`renderer/lib/categories.js:13`) and applied in `groupByCategory` (`renderer/ui.js:117-138`). Config is at `~/.config/ai-agents-orchestrator/config.json` — the renderer writes it freely via `window.api.setConfig` → `set_config` (`lib.rs:445`). No reorder UI exists today.
- Sessions inside a category are sorted by activity via `rankOf`/`rebuildSortRank` (`ui.js:33-40`), frozen per poll — not user-settable.
- The Kanban board (`renderer/board.js`, `renderer/lib/board-model.js`) already implements a proven **pointer-event** drag engine (not HTML5 DnD — unreliable on WKWebView) with a ghost clone + insertion line, and a localStorage model (`csm.kanban`) of per-column order + groups. We reuse the *approach*, not the board code.
- The "Recent · unmanaged" block renders above `#panel-list` (`index.html`), gated to the Running tab.
- Pins float to the top of a category (`ui.js:299`), stored in localStorage `csm.pinnedKeys`.

## Key decisions

1. **List view only.** Cards/Board views keep current behavior.
2. **Reuse the drag *approach*, not board code.** A new `renderer/lib/drag-list.js` implements the same pointer-event pattern (5px threshold, ghost, insertion line, `data-*` drop-target resolution). `board.js` is left untouched — no board-regression risk. (Chosen over extracting a shared engine, which would touch the board.)
3. **Group creation via an explicit "＋ Group" button** in the category header (discoverable), not drag-one-session-onto-another.
4. **No cross-category moves.** A drop outside the source category is a no-op (the card snaps back); nothing is written.
5. **Persistence split:** category order → config `order` (single source of truth, already read by `groupByCategory`); unmanaged position + session order + groups → localStorage (`csm.listorg`).
6. **Pins unchanged.** Pinned sessions keep floating at the top of their category; manual order + groups govern the non-pinned region. A pinned session is not placed in a group (pin wins).

## Architecture

### New module: `renderer/lib/list-org-model.js` (UMD, pure, jest-tested)

Owns the localStorage model + all mutations. No DOM.

localStorage key `csm.listorg`:
```
{
  unmanagedIndex: <int|null>,   // position of the unmanaged block among top-level blocks; null = top (default)
  categories: {
    "<categoryName>": {
      order: [ "<sessionKey>" | "g:<groupId>", ... ],  // top-level items: loose sessions + group sentinels
      groups: { "<groupId>": { name: "<string>", collapsed: <bool>, order: ["<sessionKey>", ...] } }
    }
  }
}
```

Exported operations (names indicative, finalized in the plan):
- `load()` / `save(state)` — read/write localStorage; `load()` tolerates missing/corrupt data (returns a valid empty model).
- `orderedItems(categoryName, liveSessions)` → ordered list of top-level entries (loose sessions + groups), with **activity fallback**: sessions present in `order` keep their slot; sessions absent from `order` are appended by `rankOf` (activity). Group sentinels resolve to their `{name, collapsed, members}` with members ordered likewise.
- `moveSession(categoryName, sessionKey, targetIndex)` — reorder a loose session within the category.
- `createGroup(categoryName, name)` → groupId; `renameGroup`, `deleteGroup` (members become loose sessions), `toggleCollapse`.
- `addToGroup(categoryName, groupId, sessionKey, index)` / `removeFromGroup(...)`.
- `setUnmanagedIndex(i)`.
- `prune(liveSessionKeysByCategory)` — drop member/order keys for sessions no longer present; keep empty groups (user-created) until explicitly deleted.

### New module: `renderer/lib/drag-list.js`

Generic pointer-event drag helper for the list, modeled on `board.js:422-558`: `mousedown` + 5px threshold to start, floating ghost clone, insertion-line overlay, `dropTarget(x,y)` via `elementFromPoint` reading `data-*` attributes. Exposes an `init({container, onReorder, onDropIntoGroup, onReorderCategory, onMoveUnmanaged, isCrossCategory})`-style API with callbacks; the model mutations live in `list-org-model.js`, DOM re-render in `ui.js`. Cross-category drops are rejected (callback returns without mutating → snap back).

### Rendering integration (`renderer/ui.js`)

- `renderPanelList` orders categories per config `order`, then splices the unmanaged block at `unmanagedIndex`.
- Inside each category, render via `list-org-model.orderedItems(cat, sessions)`: loose session cards + group blocks (header with inline-rename, collapse chevron, member cards, empty-state hint + delete ✕).
- Category headers gain a drag affordance; each category header a "＋ Group" button.
- **During an active drag, suppress the 5s poll re-render** of the list (guard flag), mirroring the board, so a poll can't rebuild the DOM mid-gesture. `rankOf` is already frozen per poll.

## Data flow

1. Drag a category header → `drag-list` computes new category order → `window.api.setConfig({...cfg, order})` → `reloadConfig()` → re-render.
2. Drag the unmanaged block → `setUnmanagedIndex(i)` (localStorage) → re-render.
3. Drag a session within its category (or into/out of a group) → `moveSession` / `addToGroup` / `removeFromGroup` (localStorage) → re-render. Cross-category drop → no-op.
4. "＋ Group" → `createGroup` → re-render (inline-rename focused). Collapse toggle → `toggleCollapse`. Delete group → `deleteGroup`.
5. Every poll: `prune` removes vanished session keys; groups persist.

## Error handling

- `load()` returns a valid empty model on missing/corrupt localStorage — never throws.
- `set_config` failure on category reorder → surface inline (reuse existing config-write error path) and revert the visual order on next render (config is source of truth).
- Cross-category / invalid drop → snap back, no state change.
- A drag interrupted (mouseup outside any target) → snap back.

## Testing

- **jest** on `list-org-model`: `orderedItems` activity-fallback (mix of ordered + new sessions), `moveSession`, `createGroup`/`renameGroup`/`deleteGroup` (members → loose), `addToGroup`/`removeFromGroup`, `toggleCollapse`, `setUnmanagedIndex`, `prune` (drops vanished keys, keeps empty groups), and `load()` tolerating corrupt input.
- **Manual verification** (list view, running app): reorder categories persists across restart; unmanaged drags to bottom and stays; reorder sessions; create/rename/collapse/delete a group; drag sessions in/out; cross-category drop snaps back; a poll mid-arrangement preserves layout; pins still float.

## Out of scope (YAGNI)

- Cross-category session moves + the confirmation popup (deferred "C").
- Reorg in Cards or Board views.
- Grouping across categories; nested groups.
- Any backend/`~/.claude` write (no `set_category`).
- Syncing manual order to config (session order stays local/per-machine, like board state).
