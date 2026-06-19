# ADR-014 — Delete an archived session by moving its folder to the OS Trash

**Status:** Accepted

## Context

[ADR-001](./ADR-001-vanilla-js-electron-35-macos-read-only-claude-proj.md) keeps the
app read-only on `~/.claude`; [ADR-013](./ADR-013-archive-from-dashboard-bounded-source-of-truth-write.md)
opened one narrowly-scoped, bounded write (archive). Archived sessions accumulate on
disk indefinitely — over time that's clutter the user wants to clear without dropping
to a terminal and `rm`-ing folders by hand.

This is a **destructive** action, so it needs more care than archive: deleting the
wrong folder, or a live/closed session mid-work, would be data loss.

## Decision

Add a Trash button **only on archived sessions**, behind a confirmation dialog, backed
by a single Rust command `delete_session`. Two hard guards bound it:

1. **Confined target** — the path must resolve (canonicalized) to a real `notes.md`
   *under a configured root* (`workRoot`/`personalRoot`), reusing the same
   `notes_md_under_root` guard as the archive/PR-link writes. The folder removed is
   that notes.md's parent (the session slug dir) — it can't escape a session folder.
2. **Archived-only** — the session must classify as `archived`
   (`reader::session_history_info`); running or closed work is refused. The UI only
   renders the button for `historyStatus === 'archived'`, and the backend re-checks.

**Recoverable, not permanent:** the folder is moved to the **OS Trash** (`trash`
crate → native `NSFileManager` on macOS), not hard-deleted. The confirmation says so
("move to the Trash, restore from Finder") — a safety net against a misclick, while
still decluttering the dashboard and the working tree.

## Consequences

- One click + confirm clears an archived session; it's gone from the dashboard on the
  next poll, its folder sitting in the Trash if the user changes their mind.
- A third intentional exception to ADR-001's read-only posture — but *recoverable* and
  guarded (archived-only + root-confined), so the blast radius is tiny.
- Adds one dependency (`trash`); justified vs hand-rolling native trash calls.

## Alternatives rejected

- **Hard `remove_dir_all`**: truly frees the bytes immediately, but irreversible — a
  misclick is unrecoverable. The Trash gives the same decluttering with an undo.
- **Allow deleting closed/running too**: maximizes flexibility but invites deleting
  live work; archived is the safe, intentional "I'm done with this" state.
- **Terminal-only (`rm` by hand)**: respects read-only fully but is exactly the chore
  the feature removes.
