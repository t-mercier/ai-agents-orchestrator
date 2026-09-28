# Codex CLI and Copilot CLI sessions, beside Claude Code

Status: draft for review, 2026-09-28. Written by Claude overnight under Timothée's
mandate; she reviews it in the morning. Nothing here is pushed or released.

Sources: `docs/superpowers/research/2026-09-28-codex-copilot-parity.md` (docs, Codex source,
and the **probe results** section, which was observed on real runs) and
`docs/superpowers/research/2026-09-28-claude-coupling-map.md` (every place the app assumes
Claude Code, with file:line). A claim below marked *(probe)* was observed; *(docs)* was read
and not observed; *(assumed)* is neither and has a test that would settle it.

## What the user gets

A developer who uses Codex or Copilot, alone or next to Claude Code, sees those sessions in
the same dashboard and works with them the same way:

1. **+New** has an *Agent* choice (Claude Code, Codex, Copilot), showing only the CLIs found
   on this machine. The session starts in its space folder, runs `/start-session` (the Codex
   form is `$start-session`), and gets its `notes.md`, ticket and PRs like any other.
2. The card shows which agent runs it (a small badge) and a live dot: **busy** while it works,
   **idle** when it waits for the next prompt. **waiting** (a permission question) is
   Claude-only at launch; see *Limits*.
3. **Resume**, **Restart**, **Close** and **Sync** work on a Codex or Copilot session: the app
   launches the right CLI with the right flags.
4. **Import** lists existing Codex and Copilot sessions next to Claude Code ones.
5. The app skills are installed where each tool reads them, so `/save-session`, `/learn`,
   `/close-session` work inside Codex and Copilot too.

Claude Code users see no change. Brutus stays a Claude Code agent.

## Launch slice and what waits

In the launch slice: everything in *What the user gets*.

After the launch (Phase 2, listed in the README as not yet supported):
- the **waiting** status for Codex and Copilot;
- the usage bar (context %, 5-hour and 7-day limits) for Codex and Copilot. The bar shows only
  the model name for them;
- Doctor, the security audit and the context-budget panel for Codex and Copilot config files;
- the automatic checkpoint hooks (`ao_autosave`, `ao_checkpoint_relay`, `ao_precompact`,
  `learn_nudge`, `pr_attach`, `ao_skill_guard`) on Codex and Copilot. The skills still work;
  only the reminders that fire on their own are Claude-only at launch;
- multi-agent collaboration (cross-review, collab, parallel), already scheduled after launch.

## Rulings

Each ruling is a decision taken without her, with its cost if wrong.

1. **Claude Code keeps its own status source** (`~/.claude/sessions/<pid>.json`). Her install
   runs 100+ managed sessions on it. Moving Claude to a new source the night before launch
   buys nothing for Claude users. *Cost if wrong:* two status paths to maintain.
2. **Copilot ≥ 1.0 is required.** 0.0.x hooks carry no session id and its session files carry
   no cwd *(probe)*. The app shows "Copilot CLI 0.0.369 is too old — update it with
   `npm i -g @github/copilot`" with a copy button. *Cost if wrong:* users on 0.0.x cannot
   use Copilot sessions until they update.
3. **No `--dangerously-bypass-hook-trust`, ever.** Codex runs no hook until the user trusts it
   *(probe: silently skipped)*. So the launch slice does not depend on any Codex hook.
   *Cost if wrong:* none for launch; Phase 2 adds an onboarding step for trust.
4. **The session id comes from the environment, not from pidfiles.** Each tool exports it to
   the shell commands it runs *(probe)*: `CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`,
   `COPILOT_AGENT_SESSION_ID`. Those variables leak into nested tools *(probe)*, so the lookup
   first finds the nearest ancestor process that is one of the three CLIs, and reads only
   that tool's variable. The parent-pid walk over `~/.claude/sessions` stays as the fallback
   for older Claude Code builds. This also settles the open item "seven skills guess their
   session id". *Cost if wrong:* a skill run under an unrecognised wrapper falls back to the
   old guess, exactly as today.
5. **One registry for live Codex and Copilot sessions**:
   `~/.config/ai-agents-orchestrator/state/<pid>.json`, written by the skills
   (`/start-session`, `/restart-session`, `/import-session`, through `aosession.py
   register`) and, for Copilot, also by a `sessionStart` hook. The pid is the CLI's own pid:
   the nearest-ancestor walk above finds it, and the Copilot hook's parent is the `copilot`
   binary *(probe)*. *Cost if wrong:* a Codex session started outside the app without
   `/start-session` is not live on the dashboard until it is imported, which matches how
   unmanaged Claude sessions behave today.
6. **busy/idle for Codex and Copilot is read from the transcript**, not from hooks: Codex
   writes `task_started` / `task_complete`, Copilot writes `assistant.turn_start` /
   `assistant.turn_end` *(probe)*. The last of the pair that appears decides. *Cost if wrong:*
   a turn cut off by a crash shows busy until the process is gone; liveness is checked by
   pid, so the card then leaves Running.
7. **`agent` is persisted in two places**: the notes.md frontmatter (`agent: codex`) and each
   `active-sessions.json` entry. Absent means `claude`, so every existing session is
   unchanged. Resume, Restart, Close and Sync on a closed session read it from there.
8. **Skills install to `~/.agents/skills` for Codex and Copilot**, which both read *(Codex:
   probe; Copilot: docs)*, and stay in `~/.claude/skills` for Claude. The skill sources are
   edited in this repo only (the app skills are locked; `~/.claude/skills` is never edited by
   hand). Wording that only Claude understands becomes neutral: "the arguments after the
   skill name (`$ARGUMENTS` in Claude Code)", "ask the user (with AskUserQuestion when that
   tool exists)".
9. **Hooks for Copilot are a global write** to `~/.copilot/hooks/ao.json` *(probe: user-level
   hooks fire; repo-level did not)*, behind the same preview, backup and atomic-write steps as
   the Claude settings write (`hooks.rs:342-395`), offered in onboarding and Settings, never
   silent.

## Design

### Units

- `src-tauri/src/agents/mod.rs` — `AgentId { Claude, Codex, Copilot }`, `from_str` (unknown or
  absent → Claude), and the per-agent functions below as plain `match` arms. No trait objects:
  three variants do not need dynamic dispatch, and a `match` shows every case in one place.
- `src-tauri/src/agents/codex.rs`, `copilot.rs` — transcript location, fold, enumeration and
  status for each tool. Claude's existing code stays where it is (`reader.rs`) and is called
  from the `Claude` arms.
- `src-tauri/src/agents/launch.rs` — every command line the app builds, for every agent:
  interactive new, resume, restart, headless run (wrap, sync, run-skill, import).
- `src-tauri/src/state.rs` — reads the state directory, drops entries whose pid is dead.
- `skills/lib/aosession.py` — `current` (prints `<agent> <session_id>`) and `register <notes>
  [<name>]` (writes the state file). Every skill that looks up its own id calls it.
- `hooks/ao_state.py` — the Copilot `sessionStart` / `sessionEnd` hook: writes and removes
  the state file.

### Command lines

`<p>` is the prompt, `<id>` the session id, `<m>` the model when one is set. Every piece goes
through `pty::shell_quote`.

| | Claude Code (unchanged) | Codex | Copilot |
|---|---|---|---|
| New, interactive | `claude [--model <m>] --permission-mode auto --settings … <p>` | `codex [-m <m>] <p>` | `copilot [--model <m>] -i <p>` |
| Resume | `claude --resume <id> …` | `codex resume <id> -C <cwd> [-m <m>]` | `copilot --resume=<id> [--model <m>]` |
| Headless (wrap, sync, run-skill, import) | `claude … --permission-mode acceptEdits -p <p>` | `codex exec resume <id> -s workspace-write <p>`, or `codex exec -s workspace-write <p>` with no id | `copilot [--resume=<id>] -p <p> --allow-all-tools` |
| Skill invocation in `<p>` | `/name args` | `$name args` | `/name args` |

`-C <cwd>` on Codex resume avoids its interactive cwd prompt *(docs)*. The Codex and Copilot
headless forms are *(docs)* until Task 0 of the plan runs them once.

### Transcripts

| | Codex | Copilot ≥ 1.0 |
|---|---|---|
| Find by id | `$CODEX_HOME/sessions/**/rollout-*-<id>.jsonl` (`CODEX_HOME` defaults to `~/.codex`) | `$COPILOT_HOME/session-state/<id>/events.jsonl` (default `~/.copilot`) |
| cwd, branch | `session_meta.payload.cwd`; branch from live git | `workspace.yaml` `cwd`, `branch` |
| Title | first user message | `workspace.yaml` `name` |
| Last activity | last `response_item` message from the assistant, and its timestamp | last `assistant.message` `content`, and its timestamp |
| busy/idle | `task_started` after the last `task_complete` → busy | `turn_start` after the last `turn_end` → busy |
| Enumerate (Import) | walk `sessions/`, newest first, bounded like today's scan | walk `session-state/`, newest first |

Reads stay bounded (head for identity, tail for activity), with the same (len, mtime) cache as
`read_transcript`.

### Renderer

- +New: an *Agent* select above the category, defaulting to the last one used; hidden when
  only Claude Code is installed, so Claude-only users see today's form.
- Cards and board tiles: a badge `Codex` / `Copilot` (none for Claude, to keep today's cards).
- Model select: one list per agent, from a new `agent_models` command.
- Usage bar: model name only for Codex and Copilot sessions.
- Import picker: an Agent column.
- Terminal Close: types the agent's skill invocation (`$close-session` for Codex).
- Pinned skills: invoked with the session's agent syntax.

### Onboarding and Settings

- Detect `claude`, `codex`, `copilot` on the login-shell PATH, with their versions
  (`--version`). Copilot below 1.0 shows the update line from ruling 2.
- Install skills for each detected agent (ruling 8).
- Offer the Copilot hook write (ruling 9) with the same preview as the Claude one.

## Error handling

- Agent CLI missing at launch: the same error path as a missing `claude` today, naming the
  CLI ("`codex` was not found on your PATH").
- Transcript missing or unreadable: the session shows no activity and stays resumable only if
  the tool says so; nothing crashes the poll.
- State file with a dead pid: ignored and removed on the next read.
- Malformed state file: ignored, never deleted (it may be mid-write by a newer app version).

## Testing

- Rust unit tests per agent: command lines (exact argv), transcript fold on fixture files cut
  from the probe runs, status from turn events, `from_str` defaulting to Claude.
- Python tests for `aosession.py`: the nearest-ancestor rule with a nested-tool environment
  (the probe case: Copilot under Claude), the fallback to pidfiles, `register` atomicity.
- Playwright: the +New agent select (hidden with one agent), the badge, the import column.
- One real round trip per tool, recorded in the plan's ledger: +New → `/start-session` →
  card busy then idle → Close.

## Limits stated to the user (README "Supported agents")

- Codex and Copilot: no waiting status, no usage limits, no automatic checkpoint reminders yet.
- Copilot needs version 1.0 or later.
- Codex hooks are not used at all, because Codex requires trusting each hook interactively.

## Open for her

- The waiting status needs Codex hooks, so Phase 2 needs an onboarding step where the user
  trusts them. Acceptable?
- The badge text and position on cards: a mock-up is in the plan's first UI task.
