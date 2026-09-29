# Collab sessions: several agents on one task

Status: v2, 2026-09-29. Written by Claude under Timothée's mandate. v1 was reviewed by an
independent agent: a running collab would never show under Running, the renderer would
treat it as a Claude session, quitting the app would not stop its turns, the reviewer never
saw new files, Parallel's Keep kept an empty branch, and writing agents fed another model's
output had write and network access. v2 fixes those and cuts the first plan to
**cross-review**; the relay and Parallel follow in their own plans (end of this file).

*(probe)* = observed on a real run, 2026-09-29; *(docs)* = read; *(assumed)* = neither.

## What the user gets (plan 1)

**＋New → Collab**, next to the Agent choice: a *cross-review* of one task by two agents of
different models, in a git repository.

1. The **author** makes the change in the working tree.
2. The **reviewer** — read-only — reads the diff (new files included) and either lists the
   problems as `- file:line — problem` or answers `LGTM`.
3. The author fixes the listed problems; the reviewer looks again. At most two reviews.

While it runs, the session's detail panel shows the **collab thread**: one entry per turn
(who, which role, its closing summary, the files changed, the findings), the turn in
progress, and **Stop**. The thread is also written into the session's `notes.md`.

The card carries a **Collab** chip, sits under **Running** while it runs, then under
**Closed**. It has no terminal: no Resume, no Restart, no pinned skills.

## Rulings

1. **One engine, scripts per mode** (`collab::next`, built). Plan 1 exposes cross-review.
2. **Every turn is a headless run** in the repository, with flags per role, all probed:

   | | Reviewer (read-only) | Author (writes) |
   |---|---|---|
   | Claude Code | `-p --permission-mode plan` — refuses writes *(probe)* | `-p --permission-mode acceptEdits` — writes files; a shell command runs only if the user's own allow rules permit it *(probe: `auto` was unreliable, running a command once and refusing it the next time)* |
   | Codex | `exec -c sandbox_mode="read-only"` — refuses writes *(probe)* | `exec`, workspace-write sandbox, **network off** |
   | Copilot ≥ 1.0 | `-p --allow-all-tools --deny-tool write --deny-tool shell --silent` — refuses both *(probe)* | `-p --allow-all-tools --deny-tool 'shell(git push)' --deny-tool 'shell(git commit)' --silent` |

   The reviewer writes nothing, so another model's output never reaches an agent that can
   both write and read the network. *Cost if wrong:* a Claude author cannot build or run
   tests unless the user's settings allow the commands; the form says so.
3. **What one agent wrote reaches the other quoted as material**, never as instructions
   (built). From a review, only the finding lines (`- …`) go to the author, capped at 8 KiB.
4. **LGTM** only when the review's last non-empty line is `LGTM` and it lists no finding
   line. Anything else is findings.
5. **A clean git repository is required.** The form refuses a folder that is not a checkout,
   and a checkout with uncommitted changes: the review would otherwise include the user's
   own work, and the author would "fix" it. The collab's diffs are taken against the commit
   it started from (`base`, recorded in the notes).
6. **The diff includes new files** without touching the user's index: tracked changes from
   `git diff --no-ext-diff --no-textconv <base>`, and each untracked file (listed by
   `git ls-files --others --exclude-standard`) through `git diff --no-index /dev/null
   <file>`. Capped at 60 KiB with the stat always complete.
7. **Nothing is committed or pushed by the app**, and the prompts tell the agents not to.
8. **Turns: 20 minutes each, five at most** (author, review, fix, review, and the stop).
   Stop, the timeout and the app quitting end the whole process group (built, tested with a
   background child). The group of each running turn is also recorded in
   `<app config>/collab/running.json`; at the next launch, a group left by a crash is ended
   and its thread marked stopped.
9. **One collab per folder, and never beside a live session.** The form refuses a repository
   (canonical path) where a collab runs, an embedded terminal runs, or a Claude Code session's
   pidfile says it works.
10. **A collab turn is not a session.** A `claude -p` turn writes a pidfile *(probe:
    `entrypoint: sdk-cli`)*; `get_sessions` skips a pidfile whose process belongs to a running
    collab turn's group.

## Design

### Units (plan 1)

- `collab/mod.rs` — scripts and prompts *(built)*, plus `approves` per ruling 4 and
  `findings(review) -> String` per ruling 3.
- `collab/run.rs` — one turn *(built)*: login shell, process group, bounded draining, Stop.
- `collab/git.rs` — `head`, `is_repo`, `is_clean`, `changes_since` per ruling 6 (the current
  version uses intent-to-add and must change), `slug`, worktree helpers (plan 3).
- `collab/line.rs` — the headless line per agent and role (ruling 2), through
  `pty::shell_quote`, starting `cd <repo> && exec env AO_HEADLESS=1 AO_COLLAB=1`.
- `collab/engine.rs` — `CollabManager` (Tauri state): live collabs `{id, notes_path, repo,
  mode, agents, base, stop flag, pgid, thread}`; the loop on a thread; events; notes writes;
  `running.json`; `kill_all` for quit; `live_notes()` for the readers.
- Commands: `collab_start {category, name, ticket, root, repo, mode, agents, task}` (creates
  the notes like a Codex +New does), `collab_stop {id}`, `collab_list`.
- `reader.rs` — `get_sessions` appends live collabs (before any early return) and skips
  pidfiles of collab turns; `scan_historical` excludes live collabs and reports `collab:
  <mode>` for a collab session.
- `lib.rs` — `ExitRequested` also ends collab turns.
- Renderer — Collab form in ＋New; `renderer/collab.js` draws the thread from `collab-event`
  and from notes for a finished one; the chip; no Resume/Restart/terminal/pins for
  `s.collab`.

### Notes

The app writes the notes like a Codex +New, without `agent:` and with
`collab_mode: cross-review`, `collab_agents: claude,codex`, `collab_repo: <path>`,
`collab_base: <commit>`. The thread goes under `## Collab thread`, one line per turn:
`- HH:MM <Agent> (<role>): <first line of its summary>`, a review's findings indented under
it. When the collab ends, a `## Session history` line in the form the Closed tab already
reads marks it closed, with the outcome as its summary. Every write re-reads the file and
goes through `atomic_write`, under one lock per notes file.

### Events

`collab-event {id, notesPath, kind: turn_start | turn_end | done | stopped | error, agent,
role, summary, stat, findings}`.

## Error handling

- A turn fails (non-zero exit) or times out: the thread says so with its last output; the
  collab stops; the working tree stays as it is.
- The form's refusals (not a checkout, not clean, busy folder, same agent twice, Copilot < 1.0)
  are shown in the form, before anything runs.
- The app quits: turns are ended (ruling 8); the thread ends at the last finished turn and the
  history line says "stopped when the app quit".

## Testing

- Unit: scripts, `approves`, `findings`, lines per agent × role (exact argv), `changes_since`
  with new files and an untouched index, `is_clean`, busy-folder check, the pidfile filter.
- Engine with a fake CLI (a script that edits a file as author and prints LGTM as reviewer):
  a whole cross-review on a temp repository, Stop mid-turn, a failing turn, `running.json`
  recovery.
- Playwright: the form's refusals and the Copilot/Claude notes; the thread from scripted
  events; Stop; the card has no Resume/Restart.
- One real cross-review (Claude Code author, Codex reviewer) on a throw-away repository.

## Later plans

- **Plan 2 — relay** (planner → implementer → tester). Open: how a tester runs tests when
  headless Claude cannot run commands reliably (probe `--allowedTools` patterns per project).
- **Plan 3 — Parallel** (her decision: a throw-away worktree per agent). **Keep** commits the
  kept worktree's changes once on its branch — the one exception to ruling 7, stated in the
  button — then removes every worktree; the user merges the branch. Worktree folders are named
  by collab id, branches pass `is_safe_branch`, git runs with `-c core.hooksPath=/dev/null`
  and `--` before paths. The form says a worktree starts from the last commit, without
  uncommitted edits or ignored files such as `.env` and installed dependencies.
