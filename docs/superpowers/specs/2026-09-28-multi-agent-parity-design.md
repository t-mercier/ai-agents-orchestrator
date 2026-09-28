# Codex CLI and Copilot CLI sessions, beside Claude Code

Status: v2, 2026-09-28. Written by Claude overnight under Timothée's mandate; she reviews it
in the morning. Nothing here is pushed or released. v1 was reviewed by an independent Opus
agent: it found that no Codex card would ever appear (the liveness check recognises only
Claude processes), that a Codex session resumed from Closed would never go live, and that
Codex's sandbox blocks the writes the skills make. v2 is the smaller slice it proposed.

Sources: `docs/superpowers/research/2026-09-28-codex-copilot-parity.md` (docs, Codex source,
and the **probe results** section, observed on real runs) and
`docs/superpowers/research/2026-09-28-claude-coupling-map.md` (every place the app assumes
Claude Code, with file:line). *(probe)* = observed; *(docs)* = read, not observed;
*(assumed)* = neither, with the test that settles it.

## What the user gets

1. **+New** has an *Agent* choice — Claude Code, Codex, Copilot — listing only the CLIs found
   on this machine. It is hidden when only Claude Code is installed, so today's form is
   unchanged for Claude-only users.
2. A Codex or Copilot session **runs in the app's embedded terminal**. It gets a `notes.md`
   in its category folder like any session, and its first prompt tells the agent where that
   file is and to keep it current. That file is its memory across restarts.
3. Its card shows an agent badge and a live dot: **busy** while it works, **idle** when it
   waits for the next prompt.
4. **Resume** and **Restart** on a closed Codex or Copilot session reopen it in the embedded
   terminal with the right CLI.
5. **Close** writes the close marker, like Close without a summary does today.

Claude Code users see no change: no Claude command line, skill, hook or status path is
modified. Brutus stays a Claude Code agent and lists Codex and Copilot sessions like any other.

## Not in this slice (README "Supported agents" says so)

- The app skills (`/save-session`, `/learn`, `/route`, `/close-session`…) inside Codex and
  Copilot. They find their session through Claude Code's pidfiles and write outside a Codex
  sandbox; porting them is its own plan. `skills/lib/aosession.py` (already built) is the
  first piece of that plan.
- Close with a summary, Sync, Import and pinned skills for Codex and Copilot sessions: these
  run a skill headless. Their buttons are disabled with the tooltip "Claude Code only for now".
- The **waiting** status. Codex writes nothing while it waits for an approval *(docs)*, so a
  session waiting for approval shows **busy**. Copilot asks before every tool unless allowed.
- Opening a Codex or Copilot session in an external terminal (iTerm, Terminal): the app
  would not see it running.
- Usage bar (context %, limits), Doctor, security audit and context budget for their configs.
- Multi-agent collaboration (cross-review, collab, parallel), scheduled after the launch.

## Rulings

Decisions taken without her, each with its cost if wrong.

1. **Claude Code is untouched.** Its status stays on `~/.claude/sessions/<pid>.json`, its
   skills keep finding their id there, and golden tests pin every Claude command line byte
   for byte. *Cost if wrong:* none for Claude; two status paths to maintain.
2. **Codex and Copilot sessions live only in the embedded terminal**, where the app spawns
   the process and so knows its pid, agent and notes path. Liveness is "the pty child is
   still running" — no process-name check, which is what defeated v1. *Cost if wrong:* a
   user who runs `codex` in their own terminal does not see it as a live card.
3. **The app writes the notes.md and the registry entry itself** for Codex and Copilot,
   with the same frontmatter `/start-session` writes plus `agent:`. No skill is needed to
   create a session. *Cost if wrong:* the notes start with an empty Goal, which the first
   prompt asks the agent to fill.
4. **Session ids.** Copilot: the app generates a UUID and passes `--session-id` *(docs;
   flag present in `copilot --help` 1.0.89, probe)*. Codex has no such flag, so the app finds
   the rollout it started: the newest `$CODEX_HOME/sessions/**/rollout-*.jsonl` created after
   the spawn whose `session_meta.cwd` is the launch directory *(probe: both fields exist)*,
   then records the id in the frontmatter and the registry. *Cost if wrong:* two Codex
   sessions started in the same folder within the same second could be swapped; the second
   match is refused rather than guessed.
5. **Copilot ≥ 1.0 is required.** 0.0.x has no `--session-id`, no session id in its hooks and
   no cwd in its session files *(probe)*. The Agent choice shows "Copilot CLI 0.0.369 is too
   old — update it" with the command for the way it was installed (`brew upgrade copilot`
   when Homebrew installed it, `npm i -g @github/copilot` otherwise).
6. **busy/idle is read from the transcript.** Codex: the last of `task_started`,
   `task_complete`, `turn_aborted`; `task_started` last → busy *(probe for the first two;
   `turn_aborted` docs)*. Copilot: the last of `assistant.turn_start` / `assistant.turn_end`
   *(probe)*. Unreadable or missing transcript → idle. *Cost if wrong:* a dot is wrong for
   one poll; liveness never depends on it.
7. **`agent` is persisted** in the notes.md frontmatter (`agent: codex`) and in the registry
   entry. Absent means `claude`, so every existing session is unchanged. An unknown value
   (`agent: codx`) is refused with an error, never launched as Claude.
8. **No hook, no config write** into `~/.codex` or `~/.copilot` in this slice. Codex runs no
   hook until the user trusts it interactively *(probe)*; the app never uses
   `--dangerously-bypass-hook-trust`.
9. **Interactive sandbox left to the user's defaults.** `codex` and `copilot` run with the
   user's own approval settings; the app adds no permission flag to an interactive launch.

## Design

### Units

- `src-tauri/src/agents/mod.rs` — *(built)* `AgentId`, `command()` for every launch line.
  `parse` changes to return `Err` for an unknown value (ruling 7).
- `src-tauri/src/agents/codex.rs`, `copilot.rs` — transcript path by id, status fold, last
  activity, and (Codex) the rollout match of ruling 4. Pure functions over file contents,
  with the directory walk kept thin.
- `src-tauri/src/agents/session.rs` — create a Codex/Copilot session: build the notes.md
  text, write it (refusing to overwrite), write the registry entry, build the first prompt.
- `pty.rs` — each pty entry records `agent`, `notes_path`, launch `cwd`, `spawned_at`, and
  the session id once known. New `PtyManager::agent_sessions()` lists the live ones.
- `reader.rs::get_sessions` — appends one session per live agent pty, before any early
  return, shaped like a running Claude session plus `agent`.
- `reader.rs` historical scan — reads `agent:` from the frontmatter; `resumable` asks the
  agent's transcript lookup instead of `~/.claude/projects`.
- Renderer — the Agent select, the badge, disabled buttons with the tooltip, Resume and
  Restart through `pty_spawn` with the agent.

### Command lines (interactive, embedded)

| | Codex | Copilot ≥ 1.0 |
|---|---|---|
| New | `codex <first prompt>` | `copilot --session-id <uuid> -i <first prompt>` |
| Resume | `codex resume <id>` | `copilot --resume=<id>` |
| Restart (no transcript) | `codex <first prompt>` with the notes path | `copilot --session-id <new uuid> -i <first prompt>` |

Every line starts `cd <dir> && ` and goes through `pty::shell_quote`. The first prompt:

> This is an AI Agents Orchestrator session, "<name>". Its notes are at <notes.md>: read
> them first. Keep them current as you work — dated entries under "Decisions made", files
> you change under "Files touched", and an up-to-date "Next steps". Fill in "Goal" now if it
> is empty.

### Transcripts

| | Codex | Copilot ≥ 1.0 |
|---|---|---|
| By id | `$CODEX_HOME/sessions/**/rollout-*-<id>.jsonl` (default `~/.codex`) | `$COPILOT_HOME/session-state/<id>/events.jsonl` (default `~/.copilot`) |
| Status | ruling 6 | ruling 6 |
| Last activity | last `response_item` with an assistant message *(assumed: test on a fixture cut from a real rollout)* | last `assistant.message` `content` *(assumed: the 0.0.369 probe had it; confirm on 1.0.89)* |

Reads are bounded: the first line for identity, the last 64 KiB for status and activity.
Ids read from folder or file names are checked with `is_valid_session_id` before use.

## Error handling

- CLI not found: the pty prints the shell's "command not found"; the Agent choice never
  offers a CLI that was not detected.
- notes.md already exists at the predicted path: refused, as `/start-session` does.
- Codex rollout not found yet: busy for the first 10 s, then **waiting** with "Codex is
  asking something in its terminal". The poll keeps looking for as long as the terminal
  lives. *(Round trip, 2026-09-29: in a folder it does not know, Codex 0.158.0 first asks
  "Trust this folder?", then "Hooks need review" when the user has Codex hooks, and writes
  its rollout only after both are answered.)*
- Transcript unreadable: idle, no activity line; nothing breaks the poll.

## Testing

- Golden tests: every Claude line from `agents::command` equals what the call sites build
  today *(built)*.
- Rust unit tests: `parse` refusing unknown values; notes.md text (frontmatter includes
  `agent:`); status fold on fixtures cut from the probe transcripts; the rollout match
  (newest after spawn, cwd equal, second match refused); `agent_sessions()` merge shape.
- Playwright: Agent select hidden with Claude only; badge; disabled buttons and tooltip.
- One real round trip per tool, recorded in the plan ledger: +New → card busy → idle →
  Close → Resume.

## Open for her

- Launch posts must say "Codex and Copilot sessions in the dashboard, with memory in their
  notes; the skills are Claude Code only for now" — not "full parity".
- Phase 2 order: skills in Codex/Copilot (with `aosession.py`), then the waiting status
  (needs Codex hook trust in onboarding), then headless Close/Sync/Import.
