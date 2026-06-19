# Session lifecycle: distinguish "stale" from "closed" — Design

**Date:** 2026-06-16
**Status:** approved (brainstorm) → ready for plan

## Goal

Stop treating a session whose terminal was just killed (no `/close`) the same as a
properly wrapped-up one. Closing a terminal (End-session ✕ in the embedded pane, or
quitting the external terminal/tab) does **not** run the `/close` skill, yet today
the session lands in the **Closed** tab identical to a real wrap-up. Re-base the tabs
on the **state of the work**, not the state of the process.

## Model (decided)

Tab membership is driven by the *work* lifecycle, not "pid alive":

- **active** — pid alive (terminal up). Current status dot (busy / idle / waiting).
- **stale** — pid dead **and not wrapped up**: open work whose terminal is gone.
- **closed** — pid dead **and wrapped up** via `/close`.
- **archived** — has an `ARCHIVED` history line (unchanged).

Tabs:
- **Running** = active **+** stale (everything not yet wrapped up), one mixed list.
- **Closed** = only truly `/close`d sessions. ← becomes honest.
- **Archived** = unchanged.

Reclassification is 100% derived from existing data — **no migration, no writes**.
Sessions re-bucket themselves on the next 5 s poll.

## Detecting "wrapped up" (no skill change)

The two skills already leave distinguishable history lines:
- `/save` → `- <date> (in progress) | session=… | …`  (carries `(in progress)`)
- `/close` → `- <date> HH:MM → HH:MM | session=… | …`  (a time range, no `(in progress)`)

So, from `## Session history`:
- an `ARCHIVED` line → **archived**
- ≥1 entry **and** the last entry does **not** contain `(in progress)` → **closed**
- ≥1 entry whose last contains `(in progress)`, **or** no entries → **stale**

This reuses the existing `(in progress)` convention; no change to `/close` or `/save`.

**Known limitation:** a session `/close`d, then re-opened via `/restart` and killed
again without a fresh `/save`/`/close`, keeps its prior `/close` line as the last
entry → shows as **closed** (not stale). Acceptable: it was wrapped up at least once,
and while re-running it shows as active anyway.

## Components

### `src-tauri/src/reader.rs`
- `session_history_info` returns one of `archived` | `closed` | `stale` (replacing the
  old `open`; `closed` now requires the last entry to be a non-`(in progress)` line).
  Pure fn → unit-tested with a table (closed / saved-then-killed / never-saved /
  archived / multiple-saves-then-close).
- Historical scan: the **Closed** tab keeps only `hist_status == "closed"`; **stale**
  sessions are surfaced for the Running tab. `get_historical_sessions(filter)` accepts
  `"closed" | "archived" | "stale"` and each emitted session carries its `state`.
- Running sessions (`get_sessions`, alive pids) carry `state: "active"`.

### `renderer/app.js`
- The **Running** tab fetches `getSessions()` (active) **∪** `getHistoricalSessions('stale')`,
  concatenated into one list (existing sort applies). Stale entries are read-only
  historical records (no live pid) — resume is disabled, Restart + Archive enabled.
- The board index already unions running + closed + archived; add stale so board cards
  reflect the right state too.

### `renderer/ui.js` + `renderer/style.css`
- A session card/row renders a **greyed status dot** + a small **`stale`** badge when
  `state === 'stale'` (inline — no extra tab or sub-group, per the "everything under
  my eyes" preference).
- Stale cards expose **Archive** (clear it → Archived) and **Restart** (reopen → can be
  `/close`d properly). Resume (embedded/external) is hidden for stale (no live pid /
  possibly no transcript — reuse the existing `resumable`/`canResume` gating).

## Data flow

```
get_sessions()            → state=active (alive pid)        ┐
get_historical_sessions   → stale  (dead, last entry in-progress / none)  ├─ Running tab
                          → closed (dead, wrapped up)        → Closed tab
                          → archived (ARCHIVED line)         → Archived tab
session_history_info(notes.md text) decides closed vs stale vs archived
```

## Error handling / edge cases

- Notes with a malformed/empty history section → `stale` (safest: surfaces it as open
  work rather than hiding it in Closed).
- A stale session with no recorded `sessionId` or a deleted transcript → Restart only
  (already handled by `resumable`/`canResume`).
- Dedup: a session must never appear in both Running (stale) and Closed — guaranteed by
  the single `hist_status` classification.

## Testing

- Rust unit tests on `session_history_info` (the pure classifier): closed line →
  closed; `(in progress)` last line → stale; no entries → stale; ARCHIVED → archived;
  save-then-close (multi-line) → closed.
- GUI: kill an embedded terminal via End-session → session shows in **Running** as
  **stale** (grey dot + badge), not in Closed; `/close` a session → moves to Closed;
  Archive on a stale card → Archived.

## Fallback (if the inline badge proves unclear)

Start with stale shown **inline** in the Running list (grey dot + `stale` badge), no
sub-grouping. If that's not good enough in practice, promote stale to its own
**top-level tab** (Running · **Stale** · Closed · Archived) — NOT a sub-group inside
Running. Decided 2026-06-16.

## Out of scope (YAGNI)

- Auto-pruning / auto-archiving stale sessions after N days (revisit if Running gets
  noisy).
- A "Close from the dashboard" write (stamping a `/close` entry from the app). Restart
  + `/close`, or Archive, cover it. Could be a later bounded write if wanted.
- Changing `/close` or `/save` line formats.
