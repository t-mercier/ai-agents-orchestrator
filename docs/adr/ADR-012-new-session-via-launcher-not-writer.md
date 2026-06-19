# ADR-012 — Start new sessions as a launcher, never by writing state

**Status:** Accepted

## Context

The dashboard is a read-only projection of `~/.claude` ([ADR-001](./ADR-001-vanilla-js-electron-35-macos-read-only-claude-proj.md)): it must never write the session source-of-truth. Users asked for an in-app "backoffice" to start a new session (name + category + ticket) without dropping to a terminal.

"Starting a session" means creating the workspace folder + `notes.md`, registering it in `~/.claude/active-sessions.json`, and a git sync — exactly what Claude Code's `/start` skill already does. Replicating that in the app would (a) make the app a *writer* of the source-of-truth, breaking ADR-001, and (b) duplicate non-trivial skill logic that would drift.

## Decision

The "＋ New" backoffice is a **launcher, not a writer**. It collects validated inputs, then opens a new iTerm tab running `claude --model 'opus[1m]' "/start <CATEGORY> [<TICKET>] <name>"`. **Claude Code's `/start` skill performs all writes** — the app touches nothing under `~/.claude`.

Inputs are validated in the main process before building the command: category ∈ the known set; name stripped to `[A-Za-z0-9 _-]` (≤60 chars); ticket kept only if it matches a project-key pattern (e.g. `ABC-123`). The command is delivered to `osascript` via `on run argv` (no AppleScript/shell interpolation) and shell-quoted ([ADR-005](./ADR-005-ipc-surface-locked-8-fixed-channels-all-inputs-val.md)).

## Consequences

- ADR-001 holds: the app remains read-only with respect to the source-of-truth. The only "mutation" is asking Claude to run a skill the user could run by hand.
- No duplication of `/start` logic; the skill stays the single implementation.
- The new session appears in the dashboard on the next 5s poll once `/start` registers it.
- This is the first feature that *triggers* a state change. It deliberately stays on the launcher side of the configurator boundary the panel scoped to v1.1 ([ADR-009](./ADR-009-v1-0-scope-defer-onboarding-settings-pages-mcp-edi.md)) — it does not edit config or store secrets.

## Alternatives rejected

- **App writes the workspace itself** (folder + notes.md + active-sessions.json + git sync): breaks ADR-001, duplicates and will drift from the `/start` skill, and risks corrupting the session registry.
- **Embedded-terminal launch**: viable, but boot-timing of `claude` before sending `/start` is more fragile than passing the slash command as the initial prompt argument; and the session would be tied to the app process lifetime.
