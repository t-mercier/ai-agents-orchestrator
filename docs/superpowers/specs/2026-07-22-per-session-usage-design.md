# Per-session context % + model in the usage bar — Design

**Date:** 2026-07-22
**Status:** Approved (brainstorming), pending implementation plan

## Goal

The footer usage bar's **context %** and **model** must reflect the **selected session**, not "whichever Claude session last rendered its statusline". The 5-hour and 7-day rate-limit windows are account-global and stay global. Switching the selected session updates context % + model.

## Background / current state

- The usage bar is fed by `~/.claude/statusline-cache.json`, currently a **flat global object**: `{ model, fiveHourPct, sevenDayPct, contextPct, updatedAt, fiveHourResetsAt, sevenDayResetsAt }`.
- The bundled wrapper `scripts/ao-statusline.sh` (embedded in the binary via `include_str!`, installed to `~/.claude/ao-statusline.sh` on launch) captures the statusLine stdin JSON and writes that flat cache, merging with the previous value so a render missing a field doesn't blank it.
- `get_usage()` (`src-tauri/src/lib.rs`) reads the flat file, no argument. `refreshUsage()` (`renderer/app.js`) calls `getUsage()` with no argument and renders `{model, fiveHourPct, sevenDayPct, contextPct, ...}`, on boot + every 5-second poll.
- Because there is ONE cache, context % + model always show the last session that rendered its statusline — not the selected one. This is the bug.
- Claude Code passes `session_id` in the statusLine stdin JSON (alongside `model`, `rate_limits`, `context_window`, `cwd`, …). A session's `sessionId` is available on each session object in the renderer; `selectedKey` = `notesPath || sessionId || name`.

## Key decisions

1. **Selected session drives context % + model.** Since card selection already follows clicking into the embedded terminal, this covers "the session I'm in". When nothing is selected — or the selected session has no statusline data (external terminal, paused, not yet rendered) — the bar keeps 5h/7d (global) and **hides context % + model**.
2. **5h/7d stay account-global.** Any session's render updates the shared global rate-limit entry.
3. **Cache becomes a keyed map** (approach A): `{ global, sessions: { <session_id>: {...} } }`. (Rejected: per-session files — more files + cleanup, no gain; a flat cache + `sessionId` field — retains only one session, doesn't fix the bug.)
4. **Graceful degradation & backward compat.** If `session_id` is absent from the input, the wrapper still writes `global`. `get_usage` tolerates the OLD flat shape (reads its rate limits as global, its model/context as an anonymous fallback) so an un-migrated cache never breaks the bar.

## Architecture

### Cache: `~/.claude/statusline-cache.json`
```
{
  "global":   { "fiveHourPct", "sevenDayPct", "fiveHourResetsAt", "sevenDayResetsAt", "updatedAt" },
  "sessions": { "<session_id>": { "model", "contextPct", "updatedAt" } }
}
```

### Wrapper: `scripts/ao-statusline.sh`
- Parse `session_id` from the input JSON.
- Merge-write `global` (rate limits + resets), preserving prior values when a render omits them (keep the existing merge-preserve logic, now scoped to `global`).
- If `session_id` present: merge-write `sessions[session_id]` with `model` + `contextPct` (preserve prior per-session values).
- On first run against an OLD flat cache, read it as the seed (its rate limits → `global`) so nothing is lost.
- Still delegate to the user's real statusline command unchanged.

### Backend: `src-tauri/src/lib.rs`
- `get_usage(session_id: Option<String>) -> Value` (Tauri command; `session_id` optional).
- Returns a flat object for the renderer: `{ fiveHourPct, sevenDayPct, fiveHourResetsAt, sevenDayResetsAt, updatedAt, model, contextPct }` where the rate-limit fields come from `global` and `model`/`contextPct` come from `sessions[session_id]` (or `null` when absent / no id).
- Tolerates the legacy flat shape: if the file has no `global`/`sessions` keys, treat the whole object as `global` and its `model`/`contextPct` as the fallback returned only when no `session_id` is requested.
- Never errors — returns `Null`/partial on missing/unreadable/invalid input.
- Split the parse/merge into a pure helper (e.g. `usage_view(cache: &Value, session_id: Option<&str>) -> Value`) so it's unit-testable without the filesystem.

### Renderer: `renderer/app.js`
- `refreshUsage()` resolves the selected session's `sessionId` (from `selectedKey` → the session object, or the open terminal session) and calls `window.api.getUsage(sessionId)`.
- Renders 5h/7d always; renders context % + model only when present in the response (hidden otherwise).
- Called on boot, on every 5s poll (as today), **and on selection change** so switching sessions updates the bar immediately.

## Data flow

1. Each running `claude` renders its statusline → wrapper writes `global` (rate limits) + `sessions[its session_id]` (model+context).
2. `refreshUsage()` → `getUsage(selectedSessionId)` → backend merges `global` + `sessions[selectedSessionId]` → bar shows that session's context+model + global 5h/7d.
3. User selects another session (click card / click into its terminal) → `refreshUsage()` re-runs with the new id → context+model update.

## Error handling

- Missing/corrupt cache → `get_usage` returns an empty/partial object; bar shows what it can (or nothing), never crashes.
- No `session_id` for the selected session (external/paused) → context+model hidden, 5h/7d still shown.
- Legacy flat cache (pre-migration, or a stale one) → read as `global`; bar works, per-session context appears once sessions re-render under the new wrapper.

## Testing

- **jest** on the backend parse/merge helper is not applicable (it's Rust); instead **Rust unit tests** on `usage_view`: new keyed shape (global + a session id → merged), missing session id → model/contextPct null, legacy flat shape → rate limits surface as global, corrupt/empty → safe empty.
- **Manual**: open two sessions on different models (e.g. Fable vs Opus) with different context %, select each → the bar's model + context % switch accordingly; 5h/7d stay constant.

## Out of scope (YAGNI)

- Cross-machine sync of the cache.
- Historical/among-tabs context (context only matters for live/selected sessions).
- Showing per-session rate limits (they are account-global by nature).
- Pruning old `sessions` entries — the map is tiny; revisit only if it grows unbounded in practice.
