# Open-actions redesign — separate WHAT (Resume/Restart) from WHERE (destination)

**Date:** 2026-06-18
**Status:** approved (brainstorm, Option A) → ready for plan

## Goal

The launch cluster today is 3 icons that conflate the action with the destination:
`⌨` (embedded — resume *or* restart), `↗` (iTerm resume), `↻` (iTerm restart). It's
unclear. Split it into two clear verbs + a remembered destination.

## Design (Option A — approved)

A **segmented destination toggle** + two verb buttons, in the detail Actions row:

```
[ ⌨ Embedded | ↗ Terminal ]   ▷ Resume   ↻ Restart    ·   [Jira][GitHub][notes][board]
```

- **Destination toggle** — `Embedded` vs `Terminal`. Persisted in
  `localStorage['csm.openIn']` (default `embedded`); shared by both verbs; state
  always visible; one click to switch. The `Terminal` side opens in the configured
  terminal app (Settings → Terminal app: System default / iTerm / Terminal).
- **Resume** (primary / accent) — `claude --resume <sid>` in the selected
  destination. Shown only when `canResume(s)` (real sid + transcript present).
- **Restart** — `/restart <slug>` from notes, in the selected destination. Shown
  when a notes slug exists.
- Reference actions (ticket / PR / notes / board) unchanged, to the right.

## Routing (verb × destination)

| | Embedded | Terminal (external) |
|---|---|---|
| **Resume** | open/reveal the embedded terminal pane (resume); if already open → reveal, no respawn | `open_in_terminal(cwd, sid)` (external `claude --resume`) |
| **Restart** | embedded pane with `restart_slug` (`/restart <slug>`) | `restore_session(slug, sid)` (external `/restart`) |

These reuse the existing wiring (`toggleEmbeddedTerminal`, `openInTerminal`,
`restoreSession`, the `restart_slug` pty path) — only the entry points change.

## Guards (unchanged)

- `canResume` gates the Resume button (hidden when the transcript is gone → only
  Restart).
- The "🚨 already running" confirm + Reveal-window pre-check still fires when Resume
  targets a session that's already live elsewhere.
- Embedded: if this session already has a live embedded terminal, Resume reveals it
  (no second process).

## Components

- `renderer/ui.js`:
  - Replace `embeddedTerminalAction(s)` + `itermPill(s)` + `restartPill(s)` in the
    actions array with `destinationToggle()` + `resumeBtn(s)` + `restartBtn(s)`.
  - `destinationToggle()` → segmented control (`data-open-dest="embedded|terminal"`),
    active segment from the stored pref.
  - `resumeBtn(s)` (when `canResume`) / `restartBtn(s)` (when slug) → carry
    `data-cwd` / `data-session` / `data-restore-slug` like today.
  - Delegated handlers: toggle click → persist pref + re-render the cluster; Resume /
    Restart click → read pref, route to embedded vs external per the table.
- `renderer/app.js`: `getOpenIn()` / `setOpenIn(v)` (localStorage `csm.openIn`),
  exposed on `window`. Same family as theme/accent prefs → folds into durable
  storage (#18).
- `renderer/style.css`: reuse the `.view-toggle` segmented pattern for the
  destination toggle; Resume = accent/primary button, Restart = neutral; both sized
  like the existing `.act` row.

## Out of scope (follow-ups, noted 2026-06-18)

- **Move embedded → iTerm** ("hand-off"): on an open embedded terminal, a `↗ Move to
  Terminal` action = resume the session in the external terminal + kill the embedded
  pty. Not a literal process move (impossible) — a resume hand-off. Fits this model.
- **Board action icon** rethink (the kanban-columns glyph isn't great).

## Testing

- Manual GUI: toggle persists across reopen; Resume/Restart each open in the selected
  destination; Resume hidden when transcript gone; already-running guard still fires;
  embedded re-reveal (no double process).
- No new pure logic to unit-test (routing is thin glue over existing commands).
