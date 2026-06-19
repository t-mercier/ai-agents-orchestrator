# ADR-013 — Archive from the dashboard: one bounded source-of-truth write

**Status:** Accepted

## Context

[ADR-001](./ADR-001-vanilla-js-electron-35-macos-read-only-claude-proj.md) and
[ADR-012](./ADR-012-new-session-via-launcher-not-writer.md) established that the app
is a **viewer + PTY terminal**, never a writer of the session source-of-truth; all
state changes go through Claude Code skills launched as a *launcher* (`/start`,
`/restart`).

Users wanted to archive a session directly from the list/cards — a one-click action.
The launcher pattern (open a terminal running `claude /archive <slug>`) is heavy and
clunky for a single metadata change, and the result wouldn't be instant.

Archiving is a small, well-bounded operation: stamp an `ARCHIVED` line into the
session's `notes.md` Session history, and drop its entry from
`~/.claude/active-sessions.json`. The dashboard already classifies a session as
archived from any history line containing `ARCHIVED`.

## Decision

The Archive button writes **directly** via a single Rust command, `archive_session`,
with a confirmation dialog first. This is a deliberate, **narrowly-scoped** derogation
from ADR-001's read-only posture — the app's only source-of-truth write.

Guards keep it safe and bounded:
- The target must be a real `notes.md` file (canonicalized, `is_file`, basename
  check) **under a configured root** (`workRoot`/`personalRoot`) — writes can't
  escape session folders.
- Both writes are **atomic** (tmp + rename), so a crash never leaves a half-written
  registry or notes file.
- The notes mutation (`stamp_archived`) is a pure, **unit-tested** function that
  mirrors what the `/archive` skill writes; the contract with the reader is just "a
  Session-history line containing `ARCHIVED`", so drift risk is minimal.
- Offered only on **closed** sessions (not running — close first; not already
  archived).

## Consequences

- One click + confirm archives a session instantly; it moves to Archived on the next
  poll. No terminal window, no skill spin-up.
- The app is no longer strictly read-only on `~/.claude`. The write is intentionally
  the *only* exception, bounded by the guards above, and mirrors an existing skill —
  it does not make the app a general configurator (ADR-009 still holds for MCP/secrets).
- Un-archiving stays in the lifecycle skills: `/restart` strips the `ARCHIVED` marker
  to revive a session.

## Alternatives rejected

- **Launcher (`claude /archive <slug>` in a terminal)**: respects ADR-001 with zero
  duplication, but opens a terminal for a one-click action — poor UX for a metadata
  change. Kept available via the skill for terminal users.
- **No in-app archive**: users must drop to a terminal for a routine tidy-up action.
