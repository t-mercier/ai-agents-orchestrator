# Invite models — other models advise a live session

**Status:** v2, approved in conversation on 2026-09-29/30; v1 reviewed by an independent Opus
agent, whose findings are folded in (see "Review of v1").
**Replaces:** the collab of `2026-09-29-multi-agent-collab-design.md` (plan 1 shipped in 0.21.0).

## The problem

The 0.21.0 collab runs two agents headless: an author changes the code, a reviewer lists
findings, and they alternate until the reviewer approves. Tried on 2026-09-29, it did not do
what was wanted. Nothing opened in a terminal, the thread showed "No turn has finished yet"
after a turn had finished, and a review task ended at once and closed the session because the
author had nothing to change.

What was wanted: **a normal session you talk to, whose agent can consult other models, with
the exchange visible in its terminal and in the session's thread.**

## Decisions (from the conversation)

| # | Decision | Her words, or the reason |
|---|---|---|
| D1 | The lead is a normal interactive session; you talk to it the whole time | "Oui, c'est une session normale" |
| D2 | v1: invited models **advise only** — they read, never write | "go pour A pour la première version" |
| D3 | The lead consults them through a command the app ships, `ao_ask.py` | "oui la 1" (over MCP or an app-side relay) |
| D4 | Invited from an **existing** session (an action on it), and optionally from ＋New | "pouvoir le lancer dans une session existante" |
| D5 | Named by the **model**, not the agent: "Invite models…", "GPT (Codex)", "+ GPT, Copilot" | "c'est surtout d'autres modèles" |
| D6 | A model can be set per invitee: Claude models from a list, Codex and Copilot by name | "sur copilot il faudrait définir aussi le modèle" |
| D7 | Invitees read the **whole conversation** and the session's folder | "les autres agents auraient accès en lecture à tout l'historique et les docs" |
| D8 | No time limit on a consultation | "pourquoi caper à 10 min?" |
| D9 | Privacy is the user's call: one clear notice, no blocking | "c'est le user qui décidera" |
| D10 | A stuck consultation is diagnosable by the lead itself | "on peut toujours demander à notre agent principal de jeter un œil" |
| D11 | The old headless collab is removed | the new flow replaces it; unused code is not kept |

## What the user sees

1. **An open session, idle, in the app's terminal**, whatever its agent (Claude Code, Codex,
   Copilot). Its actions and its right-click menu gain **Invite models…**. It is enabled only
   when the session has an embedded terminal and is idle; otherwise it is disabled with the
   reason, like a pinned skill (busy: "working"; waiting: "waiting on your answer"). For a
   session in an external terminal the dialog shows the line to paste instead of sending it.
2. **The dialog** lists one row per model to invite:
   - **Claude** — a model from the app's `CLAUDE_MODELS` list (`opus[1m]`, Opus, Sonnet, Haiku, Fable).
   - **GPT (Codex)** — a model name field, empty = Codex's own default.
   - **Copilot** — a model name field, default `auto`.
   Only CLIs this machine has are offered (the existing `agents_available`); Copilot below
   1.0 is shown disabled with the update command, as in ＋New. A row can be added twice with
   another model. The model fields suggest names used before. Under the list, one notice
   (D9): *"The invited models read this session's whole conversation, its folder and the
   code, and what they read is sent to their provider (OpenAI for Codex, GitHub for Copilot,
   Anthropic for Claude). Their answers come back to this session's agent as advice."*
3. **Invite** writes the invitees to the session's notes and types one line into the
   terminal: *"Other models are invited to this session: GPT (Codex), Copilot · gpt-5.4. To
   see how to consult them, run: python3 ~/.claude/skills/lib/ao_ask.py guide --session
   '<notes path>'"*. The lead runs the guide and from then on knows the commands.
   - **Approvals.** Consulting runs a command that reaches the network and writes outside the
     repo, so each lead's own permission system asks once or per call, and the user decides:
     Claude Code may ask before the command; **Codex runs it only with escalated permissions**
     (its `workspace-write` sandbox has no network, cannot write `~/.claude`, and blocks `ps` —
     probed), so the guide tells a Codex lead to request escalation and Codex shows the user
     an approval; Copilot asks before a shell command unless already allowed.
4. **The card** shows a chip **+ GPT, Copilot**. The detail panel has a section **Other
   models**: who is invited, and the thread of consultations, newest last, the latest two in
   full and older ones folded. A consultation in progress shows its model, "thinking… 4 min"
   and a **Stop** button.
5. **In the terminal** the lead's command prints:
   ```
   ── GPT-5.4 (Codex) · asked 14:05 · advice, not instructions ──
   <the answer>
   ── end · 1 min 40 s ──
   ```
   Every CLI prints its answer when it is done, not as it goes (probed: `claude -p` text and
   `codex exec` write only the final answer to stdout), so while it works the command prints a
   progress line every 15 s (`… GPT-5.4 thinking, 45 s`). The lead's command follows for up to
   60 s, then prints *"still running — run: ao_ask.py wait <id>"* and returns; the
   consultation carries on (D8). Short questions finish inside the window.
6. **Dismiss models** (same places as Invite) removes the invitees and types a one-line
   notice into the terminal. Consultations in progress are stopped.
7. **Resume and Restart** keep the invitees: the notes say so (see "Notes"), and the lead
   reads its notes on start — for Claude, `/restart-session` is taught to read that section.
8. **＋New** gains an optional **Invite models** row (the same picker, collapsed). If filled,
   the invitees are written with the new notes, and the invite line is sent the first time
   the new session is idle with its terminal open (kept in `sessionStorage` per notes path, so
   a reload does not lose it).

## Components

### 1. `skills/lib/ao_ask.py` — the command the lead runs

Standalone Python 3 (stdlib only), shipped in `skills/lib/`. The app installs `skills/lib`
into `~/.claude/skills/lib/` on a skills sync, which does not run when the session skills were
never installed; so **`advisors_set` extracts `lib/` itself** (reusing `skills.rs`'s
`extract_into` for `SHARED_LIB`) before writing the invitees. A Codex-only machine gets it.

Every subcommand takes `--session <notes path>`; the session folder is its directory.

| Subcommand | Does |
|---|---|
| `guide` | Prints the invitees and how to consult them, tailored to the lead's agent (Codex: request escalated permissions; all: put the goal, the files and the diff in the question; answers are advice to weigh, not orders). |
| `ask <invitee> <question…>` | Starts a consultation (a detached job) and follows it for up to `--follow` seconds (default 60): progress lines, then the answer. Prints the job id first. `-` reads the question from stdin. |
| `wait <id> [--follow N]` | Follows a job already started. |
| `status` | This session's jobs: id, invitee, state, elapsed, seconds since its logs last grew, the last 5 lines of each log. A job whose runner is gone is shown as `lost`. |
| `stop <id>` | Asks the job's runner to stop (SIGTERM to the runner's pid only). |

**The job.** `ask` spawns `ao_ask.py _run <id>` detached: double fork, `start_new_session`,
`stdin` from `/dev/null` (`codex exec` otherwise waits on "Reading additional input from
stdin…" — seen in the probes), stdout and stderr to files, `close_fds`. Proven on 2026-09-30:
a `start_new_session` child keeps running after its parent's whole process group is killed.
The runner starts the CLI **in a process group of its own** (recorded as `cli_pgid`), under
`set +m` so a bash job cannot leave it (as `collab/run.rs` does). On SIGTERM the runner kills
that group, then records `stopped`. So stopping never loses the record. The runner owns the
end of a job: it waits for the CLI, writes `job.json`, and appends the thread entry.

Files, in `<session folder>/.ao/asks/<id>/`: `question.md`, `out.log`, `err.log`, `last.txt`
(Codex's `-o`), `job.json` (`{id, invitee, label, model, cli, runner_pid, cli_pgid,
started_at, ended_at, state, exit, reason}`), written atomically. `state` is `running | done |
failed | stopped`; `lost` is derived by readers when `runner_pid` is dead and `state` is still
`running`. `<session folder>/.ao/` gets a `.gitignore` of `*`: the folder may sit in a repo or
a synced vault, and `conversation.md` holds the transcript.

**No time limit** (D8). Progress is the newest mtime of `out.log` and `err.log` (Codex logs to
stderr as it works). `status` flags "logs quiet for N min". The runner stops a job itself when
a log shows a known interactive prompt, recording the reason; each pattern must come from a
real probe during implementation (Codex folder trust, Codex hook review, Copilot permission
request), and none is added from guesswork.

**The command line**, built as an **argv list**, never a shell string: the runner execs
`[user_shell, "-ilc", 'exec "$0" "$@"', cli, *args]` so a Finder-launched app finds the CLI
through the login shell while the question stays one argument, never parsed by a shell.
`user_shell` follows `src/shell.rs`: `$SHELL`, else the first of zsh, bash, sh.

| CLI | argv after the CLI name (read-only, no network tools, no MCP) |
|---|---|
| Claude | `-p <prompt> --permission-mode plan --restricted --strict-mcp-config --tools Read,Grep,Glob --no-session-persistence [--model=M] --add-dir <session folder>` — the prompt first: `--add-dir` takes several directories and swallowed a prompt placed after it (probed) |
| Codex | `exec --skip-git-repo-check -c sandbox_mode="read-only" [--model=M] -o <last.txt> <prompt>` |
| Copilot | `-p <prompt> --allow-all-tools --deny-tool write --deny-tool shell --deny-tool url --disable-builtin-mcps --silent [--model=M] --add-dir <session folder>` |

Environment: `AO_HEADLESS=1` (the app's hooks stay quiet), `AO_ADVISOR=1`.

**Working directory**: the directory `ask` itself runs in (the lead's), passed to the runner —
the notes have no `cwd` key.

**Model names** are checked by `^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,63}$` in Rust
(`advisors_set`) and again in Python before use (the frontmatter is editable by anyone),
and passed as `--model=M` so a value can never be read as another option.

**The prompt** sent to an invitee: it advises another agent in a session with a person; it
must not change files; the question; where to read: the conversation export, the session
folder (`notes.md`, docs, earlier consultations in `other-models.md`), the repo.

**Security** (the inversion stated): 0.21.0's rule was that another model's output never
reaches an agent that can both write and reach the network. Here it does by design (D2): the
lead reads the advice and can act. Two things bound it: the invitee has no network tool and
no MCP (the argv above), so text planted in the repo cannot make it send anything out; and
the answer reaches the lead inside a fixed frame that names it advice, with terminal escape
sequences stripped. The lead's own permission system still guards what it then does.

### 2. The conversation export

Before each consultation, `ao_ask` writes `<session folder>/.ao/conversation.md`.
Which transcript: `aosession.current()` (the agent CLI the command runs under and its session
id; Claude's pidfile first). When `ps` gives no ancestry (a sandbox), it falls back to the
agent's environment variable (`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`,
`COPILOT_AGENT_SESSION_ID`), then to the notes' frontmatter (`agent`, `session_id`).

| Agent | Transcript | Kept |
|---|---|---|
| Claude | `~/.claude/projects/*/<sid>.jsonl` | `user` text, `assistant` text; a tool use as `→ Name: <input, 200 chars>`; tool results and thinking dropped |
| Codex | `~/.codex/sessions/**/rollout-*-<sid>.jsonl` | `response_item` messages of role user and assistant (`input_text`/`output_text`), except harness injections (a user item starting with `# AGENTS.md`, `<environment_context>` or `<user_instructions>`); tool calls as `→ name: <input, 200 chars>`; developer messages, reasoning and outputs dropped |
| Copilot | `~/.copilot/session-state/<sid>/events.jsonl` | `user.message` `data.content` (not `transformedContent`); `assistant.message` `data.content` when not empty; `tool.execution_start` as `→ toolName: <arguments, 200 chars>` |

**Newest first**, in files of at most 100 KB (`conversation.md`, `conversation-2.md`, …, up to
400 KB in all) — an invitee's file tool reads a bounded amount at once, and the latest
exchanges matter most. The first line says how much is included and what was left out. A
transcript that cannot be found gives an export that says so; the consultation still runs.

### 3. Notes and the thread

- **Frontmatter** gains one line written by the backend: `advisors: [{"id":"gpt","cli":"codex",
  "model":"","label":"GPT (Codex)"}, …]` — an **unquoted** JSON array on one line; the
  frontmatter parser splits at the first `:` and trims quotes at the ends, which reads it back
  intact. Ids are unique within a session: `claude-opus`, `gpt`, `copilot`, `copilot-2`…
  A value that does not parse (an LLM reformatted it) is treated as none, with a banner.
- **A short `## Other models` section** in `notes.md`, rewritten on invite and dismiss: who is
  invited and the `guide` command. This is how a restarted session learns about them.
- **The thread** is `other-models.md` next to `notes.md`, append-only under an `fcntl.flock`,
  one entry per finished consultation:
  ```
  <!-- ao-ask id=… invitee=gpt state=done at=2026-09-30T14:05:00 took=100 -->
  ### 14:05 · GPT-5.4 (Codex)
  **Asked**

  > the question

  **Answer**

  > the answer, every line quoted
  ```
  Quoting every line of the question and answer means an answer can never forge an entry
  marker. A separate file keeps `notes.md` small and out of reach of the runner.

### 4. Backend (Rust)

- `advisors_set(notes_path, advisors)` — extracts `skills/lib` if missing; validates (known
  CLI, id pattern, model pattern); writes the frontmatter line and the `## Other models`
  section atomically. `advisors_set(…, [])` dismisses. Invite is gated on idle, so the lead is
  not editing `notes.md` at that moment.
- `other_models(notes_path)` — the thread entries parsed from `other-models.md`, plus the jobs
  in `.ao/asks/*/job.json` (with `lost` derived), bounded: the last 50 entries, answers capped
  at 20 KB each.
- `advisor_stop(notes_path, id)` — sends SIGTERM to the job's runner after checking that its
  pid is still an `ao_ask.py _run <id>` process, so a reused pid is never signalled.
- The session a reader returns gains `advisors` (the frontmatter list).
- **Advisor turns are not sessions.** A Claude invitee runs with `--no-session-persistence`, so
  it leaves no transcript for Import. Its `claude -p` still writes a pidfile, so the runner
  registers the CLI's group in `~/.config/ai-agents-orchestrator/asks/<cli_pgid>.json`
  (`{notes_path, id}`), removed when the job ends; `get_sessions` and `doctor` skip a pidfile
  whose process group is registered there and whose runner is alive — the same filter the
  collab's in-memory group registry gave, now shared through a folder.
- Codex's rollout matching (`codex::find_started`) must skip rollouts an invitee's
  `codex exec` writes in the lead's folder: they carry `originator` other than the interactive
  CLI's (to verify on a real rollout; if not, skip rollouts whose `session_meta.id` is in the
  registry's jobs).

### 5. Renderer

- `renderer/lib/other-models.js` (pure, UMD like the other lib/ models): the invitee rows and
  ids, the invite and dismiss lines, the chip text, the thread entries' display.
- Invite / Dismiss actions, the dialog, the chip and the **Other models** section in `ui.js`.
  Typing into the terminal reuses the pinned-skill path (`pinTerminalKey`, `ptyInput`) and
  only the blocked/terminal **verdict** of `CSMSkillLaunch.decide`, not its `input` and not the
  pinned-skill refusal of non-Claude sessions. The line is sent as a bracketed paste
  (`\x1b[200~…\x1b[201~`, as `terminal.js` does for Shift-Enter) and `\r` in a second write
  200 ms later, so a TUI that treats a fast burst as a paste still submits it; the notes path
  inside the line is shell-quoted.
- ＋New's optional row; the pending invitation in `sessionStorage` per notes path.
- Both actions join `SHORTCUT_ACTIONS` as session actions.

## Removed, and what 0.21.0 sessions keep

Removed: `src-tauri/src/collab/{engine,git,mod,run,line}.rs` and `mod collab`; in `lib.rs`
`collab_request`, `collab_start`, `collab_stop`, `collab_list`, their registration, the setup
recovery, the quit hook and the test at the collab request; `reader::collab_session`, the
collab listing in `get_sessions` and Running, the collab group filter in the reader and in
`doctor.rs` (replaced by the advisor registry), and `reader::live_claude_cwds` if its only
caller was `collab_start`; in the renderer ＋New's Collab option and fields (`index.html`,
`app.js` `fillAgentChoice`, the form branch), `collabStart`/`collabStop`/`collabList` in
`tauri-api.js`, the `collab-event` listener, the collab count in the update banner, the
running-collab Stop and spinner in `collabSection`; tests `collab.spec.js`, the collab cases in
`agents.spec.js` and `app-update.spec.js`, and the reader and lib tests that call removed code.
The read-only lines move to `ao_ask.py`; `crate::shell` stays.

Kept for sessions 0.21.0 created (`collab_mode:` in the frontmatter): the reader's `collab`
and `collabThread` fields, a read-only `## Collab thread` section in the panel, the guards
that give them no Resume, Restart or terminal actions, `restart_refusal`'s refusal, the
`collab_mode:` stop in the restart-session skill, and the `TURN_MARK` check that keeps their
turn transcripts out of Import. These sessions are all closed; none can run again.

## Errors

| Case | What happens |
|---|---|
| The CLI of an invitee is gone | `ask` fails at once: "codex is not installed on this machine". The dialog only offers installed ones. |
| An unknown model name | The CLI's own error ends the job as `failed` (probed: Copilot's one-line error; Codex's JSON `message`, extracted); shown in the terminal and the thread. |
| A Codex lead without escalation | The command fails in the sandbox (no network); `ask` recognises the resolver error and says: "run this with escalated permissions". |
| A job stuck on a prompt | Stopped by the runner with the reason when the prompt is a known one; otherwise `status` shows "logs quiet for N min" and the lead can read the logs. |
| The runner killed (SIGKILL, reboot) | `lost` in `status` and in the panel; the entry is not written; `stop` clears it. |
| The transcript cannot be found | The export says so; the consultation runs on the session folder alone. |
| Two consultations at once | Allowed; each is its own job, entries ordered by their end, appends under a lock. |
| The session is closed while one runs | The job finishes and appends; Close does not wait. Dismiss stops them. |
| `other-models.md` edited by hand | Only marked entries are parsed; the rest is ignored. |
| Frontmatter `advisors` unreadable | Treated as none, with a banner. |
| An idle lead holding a half-typed draft | The line joins the draft, as with pinned skills today; out of scope. |

## Tests

- **Python** (`skills/lib/test_ao_ask.py`, in `npm run test:py`): the argv per CLI and model
  (the prompt stays one element; a hostile question and a model starting with `-` are refused
  or inert, ported from `line.rs`'s `a_hostile_task_stays_one_argument`); the three exports
  from fixture transcripts, newest first, split and capped, harness injections dropped; job
  lifecycle with fake CLIs on `PATH` (answer, `failed` with stderr, `stop` recorded as
  `stopped`, the runner survives its follower being killed, `wait` after the fact, `lost`);
  stdin is `/dev/null`; the thread entry format and its quoting; `guide` per lead agent; the
  registry file written and removed.
- **Rust**: `advisors_set` validation (`opus[1m]` accepted, `-x` refused), the frontmatter and
  section it writes, `lib/` extracted; `other_models` parsing, bounds and `lost`;
  `advisor_stop` refuses a pid that is not its job; the reader's `advisors` field; a
  registered advisor pid is not listed as a session nor reported by Doctor; legacy collab
  sessions still refused for Restart.
- **jest**: `renderer/lib/other-models.js`.
- **Playwright**: Invite disabled when busy or waiting, enabled for a Codex session; the
  dialog's rows from `agents_available`; Invite writes and pastes the line then `\r`; the chip;
  the thread and Stop; Dismiss; ＋New's pending invitation sent once when idle, surviving a
  reload; a legacy collab session shows its read-only thread and no Restart.

## Proofs on real CLIs

### Probed on 2026-09-30

Each CLI was asked to read a file in a separate "session" folder and answer with the one word
it held, from a git repo it was not allowed to write to:

| CLI | Result |
|---|---|
| Claude, `-p <prompt> --permission-mode plan --add-dir <dir>` | answered, exit 0, 12 s, repo untouched |
| Claude, `-p --permission-mode plan --add-dir <dir> <prompt>` | exit 1: "Input must be provided…" — `--add-dir` took the prompt |
| Codex 0.158, `exec … sandbox_mode="read-only" -o <file>` | answered in `-o` and on stdout, exit 0, 12 s; stderr is its whole log, kept apart |
| Copilot 1.0.89, `-p … --deny-tool write --deny-tool shell --silent --add-dir <dir>` | answered, exit 0, 9 s |
| Copilot, `--model not-a-model-xyz` | exit 1 at once: `Model "not-a-model-xyz" from --model flag is not available.` |
| Codex, `-m not-a-model-xyz` | exit 1 at once; the reason is the `message` of a JSON error on stderr |
| `codex sandbox` (workspace-write, her config) | no network (`nodename nor servname`), cannot write `~/.claude`, `ps` not permitted |
| A `start_new_session` child, its parent's group then SIGKILLed | the child ran to its end |

### To probe during implementation

The hardened argv of each CLI (`--restricted --tools …` for Claude, `--deny-tool url
--disable-builtin-mcps` for Copilot) still answers the PAPAYA question; a question needing
several reads gets a text answer from Claude's plan mode (not an ExitPlanMode stop); a Codex
lead with escalation runs a consultation; the invite line pasted into each TUI is submitted
intact; the stuck-prompt patterns; the `originator` of an `exec` rollout.

## Review of v1

An independent Opus review of v1 found 3 critical and 10 important issues; each is addressed
above: Claude's prompt order (argv, probed); advisor turns listed as sessions (registry,
`--no-session-persistence`); the Codex sandbox (escalation, probed); `stop` killing the
runner (separate CLI group); stdin; output not streamed and tool timeouts (progress lines,
bounded follow); the missing `cwd` key; `lib/` not installed without the skills; the model
pattern and quoting (argv, `--model=`); the security inversion (no network tools, framing);
an incomplete Removed list and legacy sessions; the restart-session skill; typing a long line
(bracketed paste). Its minor points are folded in (export shape, unquoted frontmatter, locks
and quoting, `.gitignore`, the pending invitation's storage, Codex rollout matching).

## Out of scope for v1

Invitees that write (in their own worktree: D2, option C later); an invitee consulting another;
MCP tools; sending the invite into an external terminal.
