# Brutus — the agent you talk to about all your sessions

**Status:** design approved in conversation, 2026-09-23 · **Target:** 0.20.0 (new capability → minor)

## The Context

AI Agents Orchestrator shows every Claude Code session on the machine and gives each one a
`notes.md` that survives compaction. What it does not have is a place to *ask* about them. To
know which session is waiting on you, what one decided last week, or what you were doing
yesterday, you read cards and open notes one by one.

**Brutus** is that place: one agent, reached from a bubble, a side panel or ⌘K, who reads the
dashboard and the notes for you and answers in plain words. He is himself a Claude Code
session with a memory file of his own, so he grows the way the other sessions do. The name is
a nod to the author's sister, who named her speaker Brutus; it is settled.

V1 is **read-only on your data**. Brutus answers, briefs and points; he does not archive,
close or sync anything. Actions come in V2, through a structured confirmation (see *Out of
scope*).

## The UI

Agreed on a live demo over the real renderer (`2026-09-23-brutus/ui-demo.js`, screenshots in
the same folder, `settings.png` for this section). Three surfaces, one conversation.

- **Bubble — the default home.** A round avatar bottom-right; click opens a 380 × 560 panel
  anchored above it. Right-click opens a menu at the pointer (like every context menu in the
  app): *Move Brutus to the side panel* · *Brutus settings…*. ⌘K is not repeated there: it is
  a shortcut, and the bubble's tooltip names it.
- **Side panel — the other home.** Docked on the right, 400 px wide; `.layout` gets a right
  margin so the dashboard shrinks instead of being covered. A small icon in its header sends
  him back to the bubble. Moving to the side panel from the bubble's menu shows a toast with
  *Undo* and *Settings*.
- **Palette — ⌘K, from anywhere in the app,** over either home. Big input at the top, the
  last exchange below, and *Continue in the bubble ↗* / *…side panel ↗* to reopen the home
  view on the same conversation.
- **Titlebar button** "Brutus ⌘K" only in side-panel mode; in bubble mode the bubble is the
  entry point and the button would be redundant.
- **Settings → Assistant:**
  - **Name** — "Brutus" by default, up to 24 characters. It changes what is displayed (header,
    avatar initial, menu labels, "Hi, I'm …") and how he introduces himself. It never changes
    the internal id: his folder, the agent id `brutus`, the commands. Naming your own assistant
    is how Brutus got his name in the first place.
  - **Style** — Concise (default) · Friendly · Casual · Nerdy, with a live sample of the same
    answer in each, so you pick by reading rather than by label.
  - **Appears as** — Bubble / Side panel.
  - The ⌘K shortcut, shown read-only, and a link that opens `memory.md`.

  Where each lives, by the README's two-stores rule: the home choice is how the app looks, so
  `localStorage` (`csm.brutusHome`). Name and style change what the backend sends Claude Code,
  so `config.json` (`assistant.name`, `assistant.style`): the runner composes the prompt from
  them, and the renderer never sends prompt text. The style is a key checked against the four
  presets; the name is plain text, trimmed, length-capped and escaped wherever it is rendered.

  Neither can weaken the sandbox: both only reach the prompt, and every restriction below is a
  command-line flag. A free-text custom style is out of V1.

Inside the conversation:

- **Session names are chips** with the session's live status dot. Clicking one scrolls to its
  card and flashes it. Brutus writes `[[session:<name>]]`; the renderer resolves the name
  against the current session list and renders an unknown name as plain text.
- **A steps line** in small grey text above each answer says what he read ("Read the
  dashboard · notes of 2 sessions"), built from the stream's tool-use events. You see what an
  answer rests on before you trust it.
- **Streaming:** a thinking state with the current step ("Reading the notes of
  race-on-logout…") until text arrives.
- **First open:** avatar, one line on what he does, and four suggested questions.
- **Header:** "Remembers N things about your work" (entries in `memory.md`), *New
  conversation* (keeps memory), close. Esc closes the palette first, then the home view.

`⌘+Space` was considered and rejected: macOS reserves it for Spotlight, so the app would
never receive it.

## How it works

### The agent is one file in the repo

`agents/brutus.md` in the repo — a Claude Code custom agent (frontmatter `name`,
`description`, `tools: Read, Glob, Grep, Write, Edit`, then the system prompt) and the single
source of truth for who Brutus is. It is embedded with `include_dir!` like the skills.

**The app does not load it as a file.** The sandbox needs `--restricted` (below), and
`--restricted` ignores agent files: `--agent brutus-probe` with the file in `.claude/agents/`
failed with "not found". So each run converts the embedded file into the inline form,
`--agents '{"brutus": {"description", "tools", "prompt"}}'`, which the probes showed is
applied under `--restricted` (persona answered correctly, twice out of two).

The launch sync also installs it to `~/.claude/agents/brutus.md`, read-only, with the same
`.ao-base` rules as the 14 skills, and `ao_skill_guard.py` extends its refusal to that file.
That copy is only for `claude --agent brutus` from a terminal — an ordinary session with your
own permissions, **not** the sandbox. The app never runs it.

The prompt calibrates him as a second brain and a dispatcher: outcome first, sessions named
with `[[session:…]]`, the ones waiting on you before anything else, and never a claim to have
done something — in V1 he can only read and remember. It also tells him what to write into
`memory.md` (stated priorities, preferences, recurring context) and to keep it short.

### His folder

`~/.config/ai-agents-orchestrator/brutus/`, next to the app's `config.json`:

| File | Written by | Purpose |
|---|---|---|
| `dashboard.md` | the app, before every message | The session list as the app sees it: name, space, category, status (busy · idle · waiting · stale), ticket and PR states, last activity, `notes.md` path. Brutus cannot compute process status himself; the app can. Running sessions plus those closed in the last 14 days; archived ones left out. |
| `memory.md` | Brutus, and only Brutus | What he keeps about you. The only file he may write. |
| `settings.json` | the app, at each run | The permission rules below, with paths resolved. |
| `conversation.json` | the app | The current Claude Code session id, so each message resumes the same conversation. *New conversation* replaces it. |

### One message = one headless run

`brutus.rs`, command `brutus_ask(message)`, same shape as `wrap_session` (`lib.rs:1125`):
through a login shell so `claude` is on PATH, `AO_HEADLESS=1`, the app's `model_flag()`.

```
cd <brutus dir> && AO_HEADLESS=1 claude --restricted
  --agents '<agents/brutus.md as JSON>' --agent brutus -p
  --output-format stream-json --verbose
  --resume <id>            # or --session-id <new uuid> for the first message
  --tools Read,Glob,Grep,Write,Edit
  --strict-mcp-config
  --settings <brutus dir>/settings.json
  --add-dir <each space root> --add-dir <each knowledge-notes folder>
  --permission-mode dontAsk
  --model <model>
```

`--model` is always passed: `--restricted` ignores `~/.claude/settings.json`, so the pinned
model there would not be inherited. It is the app's `claudeModel` when set, otherwise the
`model` key of `~/.claude/settings.json`, otherwise omitted.

- **The message goes on stdin**, never into the command line. It is the only renderer-supplied
  value, and it is capped at 8 000 characters.
- **Stdout is read line by line** as stream-json. Tool-use events become `step` events, text
  becomes `text`, the result becomes `done`; the app emits them to the renderer as Tauri events.
- **One run at a time.** A second ask while one runs is refused with a message; `brutus_cancel`
  kills the child. A 180 s ceiling kills a run that hangs.
- `brutus_reset` starts a new conversation; `brutus_memory` returns the entry count and opens
  the file.

### The sandbox, and why each flag is there

Every point below except the last was verified by a probe on Claude Code 2.1.280, with the
effect checked on disk rather than taken from the model's account of it. The last follows from
the CLI's own description of `--restricted` and is to be confirmed when it is built:

- **`--strict-mcp-config` with no `--mcp-config`.** `--tools` restricts built-in tools only:
  without this flag the agent kept 60+ `mcp__` tools, Slack send and GitHub/Jira writes among
  them. With it, zero.
- **`--tools Read,Glob,Grep,Write,Edit` and the same list in the agent file.** The agent file's
  `tools:` narrows `--tools`; no Bash, no WebFetch.
- **Writes confined by `settings.json`:** allow `Read`, `Glob`, `Grep` and
  `Edit(//<brutus dir resolved>/memory.md)`; nothing else is allowed, and `dontAsk` denies
  what is not. Two traps, both hit by the probes: rules must be `Edit(…)` (Claude Code ignores
  `Write(…)` for file checks), and an absolute path needs `//` plus the *resolved* path
  (`/tmp` is `/private/tmp` on macOS). A single `/` is relative to the settings file and
  matches nothing — every write is then denied, silently.
- **`--restricted`, because nothing else confines reads.** Without it, the agent quoted a
  file outside every `--add-dir` — with a bare `Read` rule, and again with `Read(//dir/**)`
  rules scoped to his folders. Under `dontAsk`, a read is simply not something the permission
  rules stop. `--restricted` confines the file tools to the working directory plus
  `--add-dir`: the same read was then refused, while reading a space and writing `memory.md`
  still worked, and writing into a space was still denied. So he reads exactly the spaces and
  knowledge folders in your config. Raw transcripts under `~/.claude/projects` are out of V1:
  large, slow, and the notes already hold the substance.
- **Consequences of `--restricted` to design around:** your `~/.claude/settings.json` does not
  apply — no hooks fire for Brutus, which is wanted (he must not checkpoint himself as a
  session), and the model must be passed explicitly (above).

Prompt injection, bounded: Brutus reads notes that other sessions wrote, so a note could
contain an instruction. The worst he can do is write into his own `memory.md`, which you can
open and edit from Settings. That bound is what V2's confirmation card preserves.

### Brutus is not a session on the dashboard

Every headless run is a live Claude Code process with a transcript. Unverified yet, but
likely: the dashboard would list it under Running while it answers, and first-run setup would
offer to import it. Both scans skip any session whose working directory is the Brutus folder,
and a test pins it — first thing to check against a real run.

## What does not change

- The promise on the security page — *every write is an action you trigger* — holds: Brutus
  writes his own memory and nothing else, and makes no network call beyond Claude Code's own.
- No new network path in the app. The run is Claude Code, on your subscription.
- The 14 skills, the hooks, `config.json` and its schema. The home choice is `localStorage`.
- The product name. Whether the app itself becomes "Brutus" is a separate decision.

**One behaviour change worth knowing.** Each message costs one Claude Code run, and a resumed
conversation grows with every turn. *New conversation* is the reset; the header says when a
conversation has become long.

## Testing

- **Rust:** the argument builder always includes `--restricted`, `--strict-mcp-config`, the
  five tools, `dontAsk` and `--model`, and never interpolates the message; the embedded agent
  file converts to the `--agents` JSON; a session whose cwd is the Brutus folder is absent from
  both the live list and the import scan; `settings.json` uses `Edit(//…)` on the
  resolved path; the stream-json parser maps each event kind and survives a truncated line;
  the snapshot lists running and recent sessions and omits archived ones. Each assertion gets a
  falsifier, as elsewhere in this repo.
- **Sandbox regression:** `scripts/probe-brutus-sandbox.sh` replays today's probes against the
  installed Claude Code and checks the disk, not the model's report: a file outside every
  add-dir is refused, a space is readable, `memory.md` is writable, a space is not, zero MCP
  tools. The first of these is the one that failed until `--restricted` was added. Run it after a Claude Code upgrade;
  not in CI, since it needs a logged-in `claude`.
- **Renderer (Jest):** the answer renderer escapes HTML before any formatting — model output is
  untrusted — and turns `[[session:x]]` into a chip only for a known session.
- **Smoke (Playwright):** the bubble renders and the titlebar button does not; right-click →
  *Move to the side panel* docks it and shows the button; the header icon sends it back;
  ⌘K opens the palette over either; Esc closes palette, then home.

## Out of scope for V1

- **Actions (V2).** Brutus proposes a structured action (`{"action":"archive","sessions":[…]}`);
  the app validates it against an allowlist, shows a card naming the exact sessions, and
  executes exactly those on your click or your "yes". The model never decides on its own that it
  has consent. The card is already drawn in the demo, marked V2.
- **A global shortcut** that opens Brutus while the app is in the background: a separate
  always-on-top window and a macOS permission — its own piece of work.
- Reading raw transcripts, voice, a per-space Brutus.
