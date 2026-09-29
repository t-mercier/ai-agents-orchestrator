# Invite models — other models advise a live session

**Status:** approved in conversation on 2026-09-29/30, written for review.
**Replaces:** the collab of `2026-09-29-multi-agent-collab-design.md` (plan 1 shipped in 0.21.0).

## The problem

The 0.21.0 collab runs two agents headless: an author changes the code, a reviewer lists
findings, and they alternate until the reviewer approves. Tried on 2026-09-29, it did not do
what was wanted. Nothing opened in a terminal, the thread showed "No turn has finished yet"
after a turn had finished, and a review task ended at once and closed the session because the
author had nothing to change.

What was wanted: **a normal session you talk to, whose agent can consult other models, with
the exchange visible live in its terminal and in the session's thread.**

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

1. **An open session, idle, in the app's terminal.** Its actions and its right-click menu
   gain **Invite models…**. It is enabled only when the session has an embedded terminal and
   is idle; otherwise it is disabled with the reason, like a pinned skill (busy: "working";
   waiting: "waiting on your answer"). For a session in an external terminal the dialog
   shows the command to type instead of sending it.
2. **The dialog** lists one row per model to invite:
   - **Claude** — a model from the app's `CLAUDE_MODELS` list (Opus, Sonnet, Haiku, Fable).
   - **GPT (Codex)** — a model name field, empty = Codex's own default.
   - **Copilot** — a model name field, default `auto`.
   Only CLIs this machine has are offered (the existing `agents_available`); Copilot below
   1.0 is shown disabled with the update command, as in ＋New. A row can be added twice with
   another model ("Copilot · gpt-5.4" and "Copilot · claude-sonnet-4.5"). The model fields
   suggest names used before. A line under the list says: *"The invited models read this
   session's whole conversation and its folder, and what they read is sent to their
   provider (OpenAI for Codex, GitHub for Copilot, Anthropic for Claude)."*
3. **Invite** writes the invitees to the session's notes and types one line into the
   terminal: *"Other models are invited to this session: GPT (Codex), Copilot · gpt-5.4. To
   see how to consult them, run: `python3 ~/.claude/skills/lib/ao_ask.py guide --session
   '<notes path>'`"*. The lead runs the guide and from then on knows the commands.
4. **The card** shows a chip **+ GPT, Copilot**. The detail panel has a section **Other
   models**: who is invited, and the thread of consultations, newest last, the latest two in
   full and older ones folded. A consultation in progress shows its model, "thinking… 4 min"
   and a **Stop** button.
5. **In the terminal** a consultation reads:
   ```
   ── GPT-5.4 (Codex) · asked 14:05 ──
   <the answer as it is written>
   ── end · 1 min 40 s ──
   ```
6. **Dismiss models** (same places as Invite) removes the invitees and types a one-line
   notice into the terminal. Consultations in progress are stopped.
7. **Resume and Restart** keep the invitees: the notes say so (see "Notes"), and the lead
   reads its notes on start.
8. **＋New** gains an optional **Invite models** row (the same picker, collapsed). If filled,
   the invitation is sent the first time the new session is idle with its terminal open.

## Components

### 1. `skills/lib/ao_ask.py` — the command the lead runs

Standalone Python 3 (stdlib only), installed with the app's other `skills/lib` files into
`~/.claude/skills/lib/`. Its installation must not depend on Claude Code being installed: a machine
that runs only Codex still gets it (checked in the plan against `skills.rs`). Every subcommand takes `--session <notes path>`; the session folder
is its directory.

| Subcommand | Does |
|---|---|
| `guide` | Prints the invitees and how to consult them: what to put in a question, the commands below, that answers are advice to weigh, not orders. |
| `ask <invitee> <question…>` | Starts a consultation (a detached job), then follows it: streams the answer to stdout until the job ends. Prints the job id first. |
| `wait <id>` | Follows a job already started (after the lead's own command timed out). |
| `status` | Lists this session's jobs: id, invitee, state, elapsed, seconds since last output, the last 5 lines of output and of stderr. |
| `stop <id>` | Ends the job's process group. |

`<invitee>` is the invitee's id (see "Notes"). A question is read from the arguments, or from
stdin when the argument is `-`, so the lead can pass a long one without quoting trouble.

**Detached jobs.** A consultation runs under `ao_ask.py _run <id>`, started with
`start_new_session=True` so it has its own process group and survives the lead's command
being killed. Claude Code ends its tool commands after 2 minutes by default and 10 at most; a
consultation that outlives that keeps running and `wait` picks it up. `ask` and `wait` never
end the job on a signal: stopping is `stop <id>` or the panel's Stop. Ctrl-C stops following.
(This changes what was said in the conversation, "Ctrl-C stops it": a signal from the user and
one from the lead's tool timeout cannot be told apart, and the second must not kill the job.)

Each job lives in `<session folder>/.ao/asks/<id>/`: `question.md`, `out.log`, `err.log`,
`job.json` (`{id, invitee, label, model, cli, pid, pgid, started_at, ended_at, state, exit}`),
written atomically. `state` is `running | done | failed | stopped`. The runner owns the end
of a job: it waits for the CLI, writes `job.json`, and appends the entry to the thread. So a
follower that was killed loses nothing.

**No time limit** (D8). `status` flags a job whose output has not moved for 5 minutes as
"no output for N min", with its last lines. That is how the lead diagnoses one waiting on a
prompt it cannot show (D10). The runner also stops a job itself when its output matches a
known interactive prompt, recording why: Codex's folder trust and hook review, Copilot's
permission request. Each pattern comes from a real probe; see "Proofs".

**The command line** of each invitee, read-only, taken from `collab/line.rs` (probed on real
runs for 0.21.0) plus the model and the session folder:

| CLI | Line |
|---|---|
| Claude | `claude -p <prompt> --permission-mode plan [--model M] --add-dir <session folder>` — the prompt first: `--add-dir` takes several directories and swallowed a prompt placed after it (probed) |
| Codex | `codex exec --skip-git-repo-check -c sandbox_mode="read-only" [-m M] -o <out.last> <prompt>` |
| Copilot | `copilot -p <prompt> --allow-all-tools --deny-tool write --deny-tool shell --silent [--model M] --add-dir <session folder>` |

It runs in the session's working directory (`cwd` in the notes, else the session folder),
under the user's shell (`crate::shell` logic in Python: `$SHELL`, else zsh, bash or sh) with
`-ilc` so a Finder-launched app finds the CLIs, and with `AO_HEADLESS=1 AO_ADVISOR=1` so the
app's hooks stay quiet and the reader can tell these turns from sessions. Codex's answer is
read from its `-o` file; the other two print only their answer on stdout.

**The prompt** sent to an invitee: it is advising another agent in a session with a person;
it must not change files; the question; and where to read: the conversation export, the
session folder (`notes.md`, docs, earlier consultations in `other-models.md`), the repo.

### 2. The conversation export

Before each consultation, `ao_ask` writes `<session folder>/.ao/conversation.md`: the lead's
conversation as text, oldest first. Which transcript: `aosession.current()` finds the agent
CLI the command runs under and its session id (Claude's pidfile first); the notes'
frontmatter (`agent`, `session_id`) is the fallback.

| Agent | Transcript | Kept |
|---|---|---|
| Claude | `~/.claude/projects/*/<sid>.jsonl` | `user` text, `assistant` text; a tool use as `→ Name: <input, 200 chars>`; tool results and thinking dropped |
| Codex | `~/.codex/sessions/**/rollout-*-<sid>.jsonl` | `response_item` messages of role user and assistant (`input_text`/`output_text`); tool calls as `→ name: <input, 200 chars>`; developer messages, reasoning and outputs dropped |
| Copilot | `~/.copilot/session-state/<sid>/events.jsonl` | `user.message`, `assistant.message` content; `tool.execution_start` as `→ toolName: <arguments, 200 chars>` |

The export is capped at the last 400 KB, cut at a message boundary, with a first line saying
how much was left out. A transcript that cannot be found gives an export that says so; the
consultation still runs.

### 3. Notes and the thread

- **Frontmatter** of `notes.md` gains one line, written by the backend:
  `advisors: [{"id":"gpt","cli":"codex","model":"","label":"GPT (Codex)"}, …]` (JSON, one
  line). The frontmatter parser is a flat string map, so the value is a JSON string. Ids are
  unique within a session: `claude-opus`, `gpt`, `copilot`, `copilot-2`…
- **A short `## Other models` section** in `notes.md`, rewritten on invite and dismiss: who
  is invited and the `guide` command. This is how a restarted session learns about them.
- **The thread** is `other-models.md` next to `notes.md`, append-only, one entry per finished
  consultation:
  ```
  <!-- ao-ask id=… invitee=gpt state=done at=2026-09-30T14:05:00 took=100 -->
  ### 14:05 · GPT-5.4 (Codex)
  **Asked**

  > the question

  **Answer**

  the answer
  ```
  A separate file keeps `notes.md` small and never written by two processes: the lead edits
  `notes.md` while a consultation runs.

### 4. Backend (Rust)

- `advisors_set(notes_path, advisors)` — validates (known CLI, id pattern, model name
  `^[A-Za-z0-9._:/-]{0,64}$`), writes the frontmatter line and the `## Other models` section,
  atomically. `advisors_set(…, [])` dismisses.
- `other_models(notes_path)` — the thread entries, parsed from `other-models.md`, plus the
  jobs in `.ao/asks/*/job.json`, bounded (the last 50 entries, answers capped at 20 KB each).
- `advisor_stop(notes_path, id)` — ends a running job's group after checking that its pid is
  still an `ao_ask.py _run <id>` process, so a reused pid is never killed.
- The session a reader returns gains `advisors` (the frontmatter list).
- The reader ignores `AO_ADVISOR=1` turns, as it ignored collab turns: a `claude -p` advisor
  writes a pidfile like a session.

### 5. Renderer

- `renderer/lib/other-models.js` (pure, UMD like the other lib/ models): the invitee rows
  and ids, the invite line, the chip text, the thread entries' display.
- The Invite / Dismiss actions, the dialog, the chip and the **Other models** section in
  `ui.js`; typing into the terminal goes through the path pinned skills use
  (`pinTerminalKey`, `ptyInput`), guarded the same way (`CSMSkillLaunch.decide`).
- ＋New's optional row; the pending invitation is kept per notes path until the session
  is idle with a terminal, then sent once.
- Both actions join `SHORTCUT_ACTIONS` as session actions.

## Removed

The whole headless collab: `src-tauri/src/collab/{engine,git,mod,run}.rs` and the collab
commands in `lib.rs` (`collab_start`, `collab_stop`, `collab_list`, the setup recovery and the
quit hook), `reader::collab_session` and its uses, the collab cases in `doctor.rs` and the
reader, ＋New's Collab option and fields, `collabSection` and the collab guards in `ui.js`,
the `collab-event` listener and the collab count in the update banner, `collab.spec.js`,
and the collab lines in the restart-session skill. `collab/line.rs`'s read-only lines move
to `ao_ask.py`, and `crate::shell` stays.

A session created by 0.21.0's collab (`collab_mode:` in its frontmatter) stays a plain closed
session: no Resume, no Restart (its refusal in `restart_refusal` is kept), and its old
`## Collab thread` section is still shown read-only.

## Errors

| Case | What happens |
|---|---|
| The CLI of an invitee is gone | `ask` fails at once: "codex is not installed on this machine". The dialog only offers installed ones. |
| An unknown model name | The CLI's own error ends the job as `failed`; its stderr tail is shown in the terminal and in the thread. |
| A job stuck on a prompt | Stopped by the runner with the reason when the prompt is a known one; otherwise `status` shows "no output for N min". |
| The transcript cannot be found | The export says so; the consultation runs on the session folder alone. |
| Two consultations at once | Allowed; each is its own job, and the thread orders entries by their end. |
| The session is closed while one runs | The job finishes and appends; Close does not wait. Dismiss stops them. |
| `other-models.md` edited by hand | Only marked entries are parsed; the rest is ignored. |
| Frontmatter `advisors` unreadable | Treated as none, with a banner "the invited models of this session could not be read". |

## Tests

- **Python** (`skills/lib/test_ao_ask.py`, in `npm run test:py`): the command lines per CLI
  and model; the three exports from fixture transcripts; the cap; job lifecycle with fake
  CLIs on `PATH` (answer streamed, `failed` with stderr, `stop`, runner survives the
  follower being killed, `wait` after the fact); a known prompt stops the job; the thread
  entry format; `guide` output.
- **Rust**: `advisors_set` validation and the frontmatter and section it writes;
  `other_models` parsing and bounds; `advisor_stop` refuses a pid that is not its job; the
  reader's `advisors` field; advisor turns not listed as sessions.
- **jest**: `renderer/lib/other-models.js`.
- **Playwright**: Invite disabled when busy or waiting; the dialog's rows from
  `agents_available`; Invite writes and types the line; the chip; the thread and Stop;
  Dismiss; ＋New's pending invitation sent once when idle.

## Proofs on real CLIs (short, read-only)

One tiny read-only consultation each with Codex 0.158 and Copilot 1.0.89 (and Claude), to
confirm: the lines run, `--model` is honoured, the invitee can read a file in the session
folder, and the stuck-prompt patterns. No real session is touched.

### Probed on 2026-09-30

Each CLI was asked to read a file in a separate "session" folder and answer with the one word
it held, from a git repo it was not allowed to write to:

| CLI | Result |
|---|---|
| Claude 2.x, `-p <prompt> --permission-mode plan --add-dir <dir>` | answered, exit 0, 12 s, repo untouched |
| Codex 0.158, `exec … sandbox_mode="read-only" -o <file>` | answered in `-o` and on stdout, exit 0, 12 s; stderr is its whole log (loaded instructions included), kept apart |
| Copilot 1.0.89, `-p … --deny-tool write --deny-tool shell --silent --add-dir <dir>` | answered, exit 0, 9 s |
| Copilot, `--model not-a-model-xyz` | exit 1 at once: `Model "not-a-model-xyz" from --model flag is not available.` |
| Codex, `-m not-a-model-xyz` | exit 1 at once; the reason is the `message` of a JSON error on stderr, which `ao_ask` extracts |

## Out of scope for v1

Invitees that write (in their own worktree: decision D2, option C later); an invitee
consulting another; MCP tools; external-terminal sessions beyond showing the command.
