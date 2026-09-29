# Collab sessions: several agents on one task

Status: draft, 2026-09-29. Written by Claude under Timothée's mandate; reviewed by an
independent agent before the plan. Nothing is pushed or released.

Builds on `2026-09-28-multi-agent-parity-design.md` (Codex and Copilot beside Claude Code,
`agents::command`). *(probe)* = observed on a real run; *(docs)* = read; *(assumed)* =
neither, with the test that settles it.

## What the user gets

A **collab session** is a session where the app hands one task from agent to agent. The
user picks it in **＋New → Collab**, with a mode, the agents, a repository folder and the task.

1. **Cross-review** — an *author* agent makes the change; a *reviewer* agent of another
   model reads the diff and lists findings; the author fixes them. Up to two review rounds,
   or fewer when the reviewer answers that nothing blocks.
2. **Collab** — a relay of roles: a *planner* writes the plan, an *implementer* makes the
   change, a *tester* writes and runs tests and reports. Each role gets what the previous
   ones produced.
3. **Parallel** — the same task goes to two or three agents at once, each in its own
   throw-away git worktree on its own branch. The user compares the results and keeps one.

While it runs, the session's detail panel shows the **collab thread**: one entry per turn —
who, which role, what it produced (its closing summary, the diff stat, the findings) — the
turn in progress with a spinner, and a **Stop** button. The thread is also written into the
session's `notes.md`, so a collab that ends (or an app that restarts) keeps its history, and
the next conversation in that folder can read it.

## Rulings

Decisions taken for her, each with its cost if wrong.

1. **One engine, three scripts.** A collab is a list of turns `{agent, role, prompt}` run
   one after another, except Parallel, whose turns run at once. Cross-review and Collab are
   the same engine with different scripts. *Cost if wrong:* none; a mode is data.
2. **Every turn is a headless run** of the agent CLI in the repository folder, with the
   agent's existing headless line from `agents::command`: Claude Code
   `-p --permission-mode acceptEdits`, Codex `exec` in its workspace-write sandbox with the
   network on, Copilot `-p --allow-all-tools --silent`. The app never adds a flag that lifts
   a sandbox further. *Cost if wrong:* a Claude turn that needs a shell command the user has
   not allowed cannot run it; the turn says so in its summary.
3. **Copilot runs with every tool allowed** in a collab turn: it has no mode between asking
   and allowing all *(docs; `--allow-tool` is per tool)*. The Collab form says it under the
   agent choice: "Copilot runs every tool without asking in a collab."
4. **A collab needs a git repository.** The review works on `git diff`; Parallel needs
   branches. The form refuses a folder that is not a checkout. *Cost if wrong:* no collab on
   a plain folder.
5. **Nothing is committed or pushed by the app.** Cross-review and Collab leave their change
   in the working tree; each prompt tells the agents not to commit or push. Parallel leaves
   one branch per agent. *Cost if wrong:* an agent that commits anyway leaves a commit; the
   thread shows the diff against the starting commit either way.
6. **Worktrees in Parallel only** (her decision, 2026-09-29). Each agent gets
   `git worktree add <app data>/collab/<id>/<agent> -b ao/collab/<slug>-<agent>` from the
   current HEAD. **Keep** removes the other worktrees and their branches, and leaves the kept
   branch for the user to merge; **Discard all** removes every one. The app never merges.
7. **The reviewer ends with `LGTM` when nothing blocks.** Its answer is read for a line that
   is exactly `LGTM`; any other answer is a list of findings sent back to the author. At most
   two review rounds, then the collab stops and says what is still open.
8. **Output is bounded.** Each turn's output is read as it arrives (never through a full
   pipe) and kept up to 256 KiB; the summary shown is its last 4 KiB. The diff given to a
   reviewer is capped at 60 KiB, with the diff stat always included.
9. **Turn timeout: 20 minutes**, Stop at any time. Stop kills the running turn's process
   group; the thread records it as stopped.
10. **One collab at a time per repository folder**, and the app refuses a collab in a folder
    where one of its terminals already runs a session: two writers on one working tree is
    the failure the three modes exist to avoid.

## Design

### Units

- `src-tauri/src/collab/mod.rs` — `Mode`, `Role`, `Turn`, `Plan` (the script for a mode), and
  the prompts. Pure: given the task, the mode, the agents and the previous turns' results,
  it returns the next turns. Unit-tested without running anything.
- `src-tauri/src/collab/run.rs` — runs one turn: spawns the headless line in a login shell,
  reads stdout as it arrives, enforces the timeout and Stop, returns `{output, ok}`.
- `src-tauri/src/collab/git.rs` — diff and diff stat against the starting commit, worktree
  add/remove, branch delete. Every call is `git` with separate arguments, never a shell line.
- `src-tauri/src/collab/engine.rs` — the loop: run the plan's turns, feed each result into
  the next prompt, stop on LGTM / max rounds / Stop / error, emit `collab-event`s, append the
  thread to notes.md.
- Commands: `collab_start {notesPath?, repo, mode, agents, task}`, `collab_stop {id}`,
  `collab_keep {id, agent}`, `collab_discard {id}`, `collab_status {id}`.
- Renderer: `＋New → Collab` form; `renderer/collab.js` for the thread in the detail panel;
  a "Collab" chip on the card.

### Prompts (all end with the same guard)

> Work in this repository only. Do not commit, push, or change git configuration. End your
> answer with a short summary of what you did.

- Author, first turn: the task.
- Reviewer: the task, the author's summary, the diff stat and the diff, then: "Review this
  change. List each problem that should be fixed as `- file:line — problem`. If nothing
  should block it, answer with the single line LGTM."
- Author, fix turn: the reviewer's findings, then "Address these findings."
- Planner: the task, then "Write a plan: the files to change and the steps. Do not change
  code."
- Implementer: the task and the plan.
- Tester: the task, the plan, the diff, then "Write or update tests for this change, run
  them, and report what passes and fails. Fix only the tests."
- Parallel: the task, identical for every agent.

### Session and notes

A collab session is a normal managed session: the app writes its `notes.md` (as for Codex and
Copilot sessions) with `agent: collab` and a `collab:` frontmatter block:
`mode`, `agents` (role → agent), `repo`, `base` (the starting commit). The thread goes under
`## Collab thread`, one `- HH:MM <Agent> (<role>): <summary first line>` per turn, with the
findings indented under a review. It shows under **Running** while it runs, then like any
session. A collab session has no terminal; Resume is not offered, Restart re-runs the collab.

### Events

`collab-event` `{id, kind: turn_start | turn_end | done | error | stopped, turn, agent, role,
summary, diffstat, findings, ok}`; the renderer redraws the thread from them.

## Error handling

- CLI missing or its turn fails (non-zero exit): the thread shows the turn failed with its
  last output; the collab stops. The working tree stays as it is.
- Timeout: as Stop, reason "timed out after 20 minutes".
- Worktree add fails (dirty index, branch exists): Parallel refuses before any agent runs.
- The app quits mid-collab: the running turn is killed with the app's other children; the
  thread in notes.md ends at the last finished turn, and the session reads as stopped.

## Testing

- `collab::mod` unit tests: each mode's script, the LGTM rule, max rounds, prompt contents,
  bounds.
- `collab::run` tests with a fake CLI (a shell script) that prints 1 MiB (the pipe case),
  sleeps (timeout and Stop), and fails.
- `collab::git` tests on a temp repository: diff against base, worktree add/keep/discard.
- Playwright: the Collab form (agents per mode, git-folder refusal, Copilot note), the thread
  rendering from scripted events, Stop.
- One real cross-review (Claude Code author, Codex reviewer) on a throw-away repository,
  recorded in the plan's ledger.

## Not in this first version

- Choosing a model per agent (each CLI's default model is used).
- Letting the user reply inside the thread between turns.
- Brutus as coordinator, and a "judge" agent for Parallel.
