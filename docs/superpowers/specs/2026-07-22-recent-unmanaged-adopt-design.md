# Recent · unmanaged section + Adopt — Design

**Date:** 2026-07-22
**Status:** Approved (brainstorming), pending implementation plan

## Goal

Surface recently-active **unmanaged** Claude Code sessions (present on disk under
`~/.claude` but not adopted into the dashboard) in a dedicated, collapsible
**"Recent · unmanaged"** section at the top of the Running tab, with a single
per-row **Adopt** action. Today these are only reachable by opening the Import
modal and picking/pasting; this makes them visible and adoptable in one glance
without perpetuating clutter.

## Background / current state

- `discover_sessions()` (src-tauri/src/reader.rs) already returns unmanaged
  sessions only — `{sessionId, title, cwd, mtime}` — **capped to the 30 newest by
  mtime**. It is called **only** on `openImportModal()`, never in the 5-second
  poll, so it carries zero poll cost.
- `import_session(sessionId, category, name, root, embedded)` (src-tauri/src/lib.rs)
  performs adoption: it launches `claude --resume <id>` with the `/import-session`
  skill prompt (embedded or external per the `embedded` flag), which creates
  `<root>/<category>/<slug>/notes.md` and registers the session in
  `active-sessions.json`. Adoption is therefore **resume + register in one gesture**.
- Managed vs unmanaged: managed = registered in `active-sessions.json` OR has a
  `notes.md` under a configured scanDir; unmanaged = transcript on disk, neither.

## Key decisions

1. **Adopt-only, no bare Resume.** A "resume without adopt" would leave the session
   unmanaged, so it reappears in the list on the next scan — it entertains clutter
   instead of reducing it, and it is redundant because Adopt already resumes.
2. **Adopt = open + register**, keeping the existing embedded/external terminal
   toggle (`import_session`'s `embedded` param). No "register-only" variant.
3. **Adopt reuses the existing Import modal**, pre-selected on the clicked session.
   The section is a nice, visible entry point; the proven modal remains the form.
4. **Lazy-only population (Approach A).** Section collapsed by default; header
   always present (cheap); `discoverSessions()` runs only on expand, plus a manual
   ↻ refresh in the header. **Never joins the 5-second poll → guaranteed zero poll
   cost.** It is an inbox to consult, not a live-updating list.
5. **Space-agnostic.** Unmanaged sessions belong to no space yet, so the section
   ignores the active space filter. Adopting is what assigns a space.

## Architecture

### Backend (Rust) — no new commands

Reuse `discover_sessions()` (exposed as `window.api.discoverSessions()`) and
`import_session()` (`window.api.importSession(...)`) as-is. No schema or command
changes required.

### Renderer

- **New module `renderer/unmanaged.js`** — isolated, testable. Responsibilities:
  - `buildUnmanagedModel(sessions)` — pure function mapping the discover result to
    a view model (rows, or an empty-state marker). Unit-tested.
  - `renderUnmanagedSection(container, state)` — renders the collapsible section:
    header (title "Recent · unmanaged", ↻ refresh button, collapse chevron) and,
    when expanded, the rows / loading / empty / error states.
- **Placement:** rendered as a sibling **above** the space/category groups, at the
  top of the Running tab, in **list and cards** views only (not Board).
- **Collapse state:** collapsed by default; the toggle is remembered using the same
  mechanism as category groups (collapsed-set / localStorage).
- **Row content:** `title` (fallback: basename of `cwd`) · `cwd` (dimmed) ·
  relative mtime (e.g. "2h ago", via existing formatters) · **Adopt** button.

### Adopt flow

- Clicking **Adopt** calls `openImportModal({ preselectSessionId, defaultName })`
  where `defaultName` = basename of the session's `cwd`.
- `openImportModal()` gains an optional argument: when `preselectSessionId` is set,
  the session is pre-selected in the modal's list (or the ID field pre-filled) and
  the name pre-populated; the user only picks category/space and the terminal
  toggle, then confirms. All existing modal logic (category auto-create, root
  validation, embedded/external launch) is unchanged.
- After a successful import, the section refreshes; the now-managed session no
  longer appears in `discover_sessions()`, so it leaves the list on its own.

## Data flow

1. User expands the section → renderer calls `discoverSessions()` once →
   `buildUnmanagedModel()` → `renderUnmanagedSection()` shows rows.
2. ↻ refresh → re-calls `discoverSessions()` and re-renders.
3. Adopt → `openImportModal({preselectSessionId, defaultName})` → user confirms →
   `importSession(...)` → on success, section re-runs discovery (row disappears).

## Error handling

- `discoverSessions()` rejects/throws → section shows an inline error line plus the
  ↻ retry control. The rest of the view is unaffected.
- `importSession()` failure → surfaced by the existing modal error handling.
- Empty discovery → "No unmanaged sessions" empty state.
- Never crashes or blocks the Running view; discovery stays off the poll path.

## Testing

- **Rust:** confirm/add a test that `discover_sessions()` (a) excludes managed
  sessions (registered or with a notes.md under a scanDir) and (b) caps output at
  the 30 newest by mtime.
- **Jest:** unit-test `buildUnmanagedModel()` — non-empty list → correctly shaped
  rows (title fallback to cwd basename, relative time); empty list → empty-state
  marker. Test that the Adopt handler calls `openImportModal` with the correct
  `preselectSessionId` and `defaultName`.

## Out of scope (YAGNI)

- No auto-refresh while expanded (Approach B) — revisit only if the static list
  feels stale in practice.
- No always-visible count badge (Approach C).
- No "dismiss/hide" per-session control — the 30-newest cap means stale entries
  fall off naturally.
- No Board-view integration.
- **Unrelated:** per-session context %/model in the usage bar is a separate
  chantier (global `statusline-cache.json` is not keyed by session) — tracked
  independently, not part of this spec.
