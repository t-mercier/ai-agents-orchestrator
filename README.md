<div align="center">

# AI Agents Orchestrator

**Stop explaining your project to Claude every morning.** A tiny native dashboard that gives your Claude Code sessions a persistent memory, so your agent grows with you. macOS & Linux.

[![Live site](https://img.shields.io/badge/%F0%9F%8C%90%20Live%20site-visit-9b8cff?style=for-the-badge)](https://t-mercier.github.io/ai-agents-orchestrator/)

[![Version](https://img.shields.io/github/v/release/t-mercier/ai-agents-orchestrator?include_prereleases&label=version&color=9b8cff)](CHANGELOG.md)
[![CI](https://img.shields.io/github/actions/workflow/status/t-mercier/ai-agents-orchestrator/ci.yml?branch=master)](https://github.com/t-mercier/ai-agents-orchestrator/actions)
[![License: Source Available](https://img.shields.io/badge/license-Source%20Available-blue.svg)](LICENSE)
[![macOS](https://img.shields.io/badge/macOS-13+-000000?style=flat&logo=apple)](https://www.apple.com/macos/)
[![Linux](https://img.shields.io/badge/Linux-X11%20%26%20Wayland-000000?style=flat&logo=linux&logoColor=white)](https://www.kernel.org/)
[![Made with Claude Code](https://img.shields.io/badge/Made%20with-Claude%20Code-000000)](https://claude.com/claude-code)

</div>


> A long Claude Code session gets **compacted** — the decisions you made on day one are squeezed out, and the next conversation starts from nothing. Run several in parallel and you also lose track of which one is waiting on you.
>
> **AI Agents Orchestrator gives every session a memory it keeps** — a `notes.md` beside its code, a folder of knowledge notes the agent writes into as it learns, and a skill proposal whenever it learns a procedure. Nothing becomes active until you have seen the exact wording and said yes. And every session in one window: live status, the work in progress, and a terminal for each. Local-first, read-only on your session data, and silent on the network until you press **Sync** or **Close**.

## TL;DR — how you're meant to use it

**Run your sessions inside the app.** Each one gets its own embedded terminal, so switching
between a dozen of them is a click instead of a hunt through terminal windows — that's the
whole point. Opening in your own terminal is supported, but it puts the juggling back.

**The lifecycle, in one line:**

```
＋ New  →  Running  →  (terminal gone → still Running, "stale")  →  Closed  →  Archived
```

Nothing moves on its own — you close, you archive.

| Action | What it does |
|---|---|
| **＋ New** | Creates the session's folder + its `notes.md`, registers it, launches it. **Start here** — you never need the terminal first. **Start in** takes any folder the session should open in, not only a git checkout, and is optional; leave it blank for the space root and git is never touched unless that folder sits inside a repo. |
| **Resume** | Relaunches a session the app already manages. |
| **First-run setup** | Names your spaces, categories and colours — plus the optional knowledge-notes folder, tracker URL and card density — then brings the Claude Code sessions already on this machine in, each to the space and category you pick, after a look at what it opened with and what it left off at. Runs itself once on a fresh install; **Settings → First-run setup** re-runs it. |
| **Close session ✕** | Wraps it up with a summary → Closed. From a stale session, the **Close** button does the same headlessly, no terminal needed. |

Two things that save pain: a session's **`notes.md` is its memory** (it survives compaction —
`/save-session` checkpoints it, `/close-session` wraps it up), and **one session = one process**
(resuming one that's already running forks the conversation, so take *Reveal window* when the
app warns you).

Full tour: **[the guide](docs/GUIDE.md)**.

## Contents

[TL;DR](#tldr--how-youre-meant-to-use-it) · [The problem](#the-problem) · [Features](#features) · [How it works](#how-it-works) · [Quick start](#quick-start) · [Session skills](#session-skills) · [Customization](#customization) · [FAQ](#faq) · [Security](#security) · [Tech stack](#tech-stack) · [What's new](#whats-new) · [Roadmap](#roadmap) · [Changelog](#changelog) · [Contributing](#contributing) · [License](#license)

## The problem

Four things you shouldn't have to do twice — each one something you already worked out, gone by the time you need it again:

- **Day one is gone by day two.** A long session gets compacted, and the next conversation starts from nothing. → A `notes.md` per session keeps the goal, the decisions, the next steps and the session id, so a fresh conversation picks the thread back up.
- **Every session starts knowing nothing about your project.** → A folder of knowledge notes per space: `/learn` writes into it as the agent learns, `/route` reads it back before you open the code.
- **You correct the same mistake forever.** → When a session teaches it a procedure, it proposes a skill and shows you the exact wording. Nothing runs until you say yes.
- **You are the bottleneck, not the agents.** Which session needs an answer? Which finished an hour ago? → All of them in one window, as a list or a kanban, one click back in.

## Features

- **Knowledge that outlives a session** — closing a session distils its high-signal decisions into a folder of **knowledge notes** (per space), so what cost you an afternoon is still there months later — and `/route <ticket>` reads it back, with your past sessions and your tracker, *before* you open the code. A folder you choose; **Obsidian is one way to browse it, not a requirement**.
- **Live dashboard** — polled every 5s. Every session's status at a glance: **busy** · **idle** · **waiting** (pulsing) · **stale** (terminal gone, work not wrapped up) · **background shell**.
- **Two views** — a grouped **List** and a **Board** (kanban).
- **Kanban board** — drag to reorder (insertion line), **drop a card onto another to group** them (named, collapsible), **attach notes** to a card or group, flag **urgent**, and add sessions from the board itself. Generative **column colours** (pick one seed → a harmonious set across however many columns you have), with each column tinting its own accent.
- **In-context detail** — click any card to open a **slide-over** with the session's goal, last activity, branch, ticket and PR links, and one-click **Resume / Restart / terminal** — without leaving the view.
- **Tickets & PRs on the card** — the ticket id and a GitHub icon sit on every card, clickable straight through to your tracker. A session can carry **several** of each (a task split across two PRs, an epic plus its sub-task): the icon then shows a count and opens a picker. Editable from the app, and `/save-session` · `/close-session` keep the lists filled as the work grows.
- **Start & resume your way** — open a **new** session or pick an existing one back up in the **built-in terminal** (in the app, xterm.js + portable-pty) *or* in **your own terminal** (iTerm / Terminal) — your choice, one toggle. Detach the built-in one into its own always-on-top window if you like.
- **Keyboard-first** — arrows / `j` `k` to navigate (`h` `l` too, across board columns), `Enter` to launch or open the focused card, `/` to search, `1`–`3` for tabs, `←/→` to switch tabs in the list, `v` to toggle list ⇄ board, `b` for board. The six named actions — search, the three tabs, the view toggle and board — are **remappable** in Settings → Shortcuts; the navigation keys are fixed.
- **Looks & density** — curated colour "looks" (accent + a subtle surface ambiance), a custom accent, and Detailed / Compact / Minimal card density. Dark & light themes.
- **Lifecycle tabs** — Running · Closed · Archived, with live **search** and a **⚲ Filter** popover (category checkboxes, one control across every view).
- **Spaces** — group categories under multiple named spaces (e.g. *Work*, *Perso*, a client). The **List** organises into collapsible **space sections** → category groups; the **Board** gets its own space filter next to its search. Pinned and ⚡ waiting cards float above every space section — they're your shortlist, so they stay at the top of the column. A single space configured ⇒ no space chrome at all.
- **Backup** — export / import all your settings to a file (handy before a reinstall).

### Brutus, the one you ask

Ask **Brutus** anything about your sessions — *what's waiting on me?*, *brief me on
FEAT-1842*, *what did I decide last week?* — from the bubble in the corner, a panel docked on
the right, or **⌘K** from anywhere in the app. He reads the dashboard and the sessions' notes,
answers with the sessions as clickable chips, and keeps a memory of what you tell him, so he
gets better the more you use him. Rename him and pick his style — concise, friendly, casual,
nerdy or sarcastic — in **Settings → Assistant**.

He can read and remember, nothing else: every answer is a Claude Code run started with
`--restricted`, no MCP servers and five file tools, reading only your category and knowledge
folders and writing only his own `memory.md`. Actions — archiving the stale ones he points
out — come next, and will always ask you first.

### Two ways to look at your work

The **List** — sessions grouped by space → category, with the selected one's notes,
tickets and pull requests inline beside it:

![List view: sessions grouped by category on the left, the selected session's notes, tickets and PRs on the right](docs/media/hero.png)

The other way in is a **Board**:

![Kanban board with groups, attached notes and urgent flags](docs/media/board.png)

Kanban with groups, attached notes, urgent flags and generative column colours. Click any
card for a **detail slide-over** — goal, branch, links, and one-click Resume / Restart —
without leaving the board.

Make it yours — curated colour "looks" (accent + a subtle surface ambiance), a custom accent, density, dark **and** light themes:

| Appearance settings | A colour "look" — Rose Poudré |
|:---:|:---:|
| ![Appearance settings](docs/media/settings.png) | ![Rose Poudré look](docs/media/look-rose.png) |

…and the same dashboard in the light theme:

![Light theme](docs/media/light.png)

### Resume right in the app

![Embedded terminal resuming a Claude Code session in place](docs/media/terminal.png)

Every session resumes in an **embedded terminal** (xterm.js + a Rust pty) — pick the exact conversation back up where you left it, or pop it into its own always-on-top window.

## How it works

**Local-first. Nothing in the background.**

AI Agents Orchestrator is a *projection* of the session state Claude Code already writes under `~/.claude` (session metadata, `notes.md`, JSONL transcripts). It reaches the network **only** when you press **Sync** or **Close** — Sync reads ticket statuses and pull requests, Close runs `gh pr view` to attach the PR while filing the session; nothing else calls out, and nothing runs in the background — and it **never** stores secrets: it visualizes what's on disk and lets Claude Code do the rest.

**No `git worktree` anywhere.** A session's folder holds its `notes.md` and nothing else — your
repo stays where it is, and a "Worktree" row appears in the detail panel only when a session
happens to already be running in one. Git runs only when a session starts **inside a repo** —
the **Start in** field if you give one, the space's root otherwise — and that field takes any
folder, not only a checkout. When the folder *is* inside a repo, session start fetches and
**rebases that branch onto `origin`** — and it reads the branch from the checkout, so this
fires even with **Branch** left blank. Point **Start in** outside any repo, or leave it
blank, and your checkout is never touched.

It is **read-only on your session data by design**: every write is an action you trigger, and there are five of them — **archiving** a session, **saving its PR links / tickets**, the repairs you tick in **Doctor**, what you tick in **Clean** (archive, or delete to the OS Trash), and the rollback of a first-run import that died half-done. All written atomically and confined under your configured roots (see [`docs/adr`](docs/adr)). Separately, it keeps **its own session skills** current in `~/.claude/skills/`, syncing them at launch and on the Settings button — a write confined to that skills folder, which puts back a copy edited by hand (and names it on screen) and never touches your transcripts. Your UI preferences live in `localStorage` + your own config file.

## Quick start

### Download a build

Grab the newest asset from **[Releases](https://github.com/t-mercier/ai-agents-orchestrator/releases)** —
universal `.dmg` (Intel & Apple Silicon) · `.deb` · `.AppImage` · `.rpm`. Nothing to compile, and no
Chromium: it runs on the system WebView, so the `.dmg` is 7 MB and the `.deb`/`.rpm` about 3 MB. The `.AppImage` is the exception at ~77 MB — the format bundles its own runtime.

You also need **[Claude Code](https://claude.com/claude-code)** — the app is a view onto the sessions it
writes to `~/.claude`, so it has nothing to show without it. On first launch the app installs its own
session skills into `~/.claude/skills/` and keeps them current from then on; see
[Session skills](#session-skills).

**macOS, in one command** — fetches the latest `.dmg`, installs it, and clears the quarantine
flag in one go:

```bash
curl -fsSL https://raw.githubusercontent.com/t-mercier/ai-agents-orchestrator/master/scripts/install-macos.sh | bash
```

Each step says what it does — [read it first](scripts/install-macos.sh) if
piping a script into a shell makes you uneasy. That is a reasonable instinct, and the two-step
version below does the same thing.

> [!NOTE]
> **Why the quarantine step exists.** The alpha builds are not signed with an Apple Developer
> ID, so Gatekeeper refuses them and reports the app as "damaged". It is not damaged — it is
> unsigned. By hand: move the app to `/Applications`, then clear the flag once (right-click →
> **Open** no longer does this on recent macOS):
> ```bash
> xattr -cr "/Applications/AI Agents Orchestrator.app"
> ```
> Signed and notarized releases come once it is out of alpha, and the installer script becomes
> unnecessary then.

### Build from source

Only needed to contribute, or to run an unreleased branch.

**Requirements:** [Rust](https://rustup.rs) + the Tauri CLI (`cargo install tauri-cli`) · [Claude Code](https://claude.com/claude-code), plus your platform's WebView toolchain:

- **macOS 13+** — Xcode Command Line Tools (`xcode-select --install`).
- **Linux** — WebKitGTK + GTK dev libraries. On Debian/Ubuntu:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libsoup-3.0-dev build-essential \
    curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config
  ```

```bash
git clone https://github.com/t-mercier/ai-agents-orchestrator.git
cd ai-agents-orchestrator

# Run the app (system WebView — no Chromium bundled)
cargo tauri dev
```

The dashboard auto-discovers your sessions from `~/.claude`. First launch installs the
session skills and hook scripts, writes a default config if you have none, and creates
the category folders — there is no install step to run.

**Build an installable bundle:**

```bash
cargo tauri build      # macOS: .app/.dmg · Linux: .deb/.AppImage — in src-tauri/target/release/bundle/
```

> [!NOTE]
> **macOS:** a bundle you build yourself is unsigned too — clear the quarantine flag the same way as a
> downloaded build (see [Download a build](#download-a-build)).

> [!NOTE]
> **Linux:** runs on X11 and Wayland (verified on GNOME/Wayland). One feature is macOS-only: *revealing* an existing external terminal window (there's no portable way to focus a window by tty on X11/Wayland), so that button is hidden on Linux. Opening a new terminal and the in-app embedded terminal both work.

## Session skills

**The app does not do the work — these skills do.** ＋ New, Resume, Restart, Close, Sync
and Archive are launchers: each one opens Claude Code on one of the skills below, and the
skill is what creates the folder, writes the `notes.md`, registers the session or files it
away. That is deliberate (see [ADR-012](docs/adr)) — the app stays a *view* of what Claude
Code writes, instead of becoming a second writer that drifts from it. The app installs them
itself at every launch — without them, the buttons would open a session that does nothing.

### Where they live, and what an install touches

They are ordinary Claude Code skills in your ordinary skills folder:

```
~/.claude/skills/
├── start-session/SKILL.md        ← the 14 below: this app's, and the only names it touches
├── close-session/SKILL.md
├── …
├── lib/aoconfig.py               ← shared helper: reads your config so skills and app agree
├── .ao-base/<name>/              ← pristine copy of each, to tell "you edited it" from "it's old"
└── your-own-skill/SKILL.md       ← never read, never written, never listed

~/.claude/hooks/
├── ao_skill_guard.py             ← copied with the skills; sessions from the app run them all
├── ao_autosave.py  ao_precompact.py  ao_session_start.py
├── pr_attach.py
└── learn_nudge.py
```

**The 14 are the app's, and your own skills are not involved.** The app's skills write the
`notes.md` the dashboard reads, so they are not customisable: the files are installed
read-only, the `ao_skill_guard` hook refuses an agent's edit to one, and a copy that was
forced anyway is restored at the next sync and named on screen. For different behaviour,
copy a skill under another name and change that one. Both installers — the launch sync and
the contributor script — iterate over the 14 names this app ships; anything else in that folder
is invisible to them: not scanned, not compared, not touched. The single case that *is*
replaced is a skill of your own that happens to share one of those 14 names — pick another.

**They install themselves.** Every launch copies the 14 skills and the hook scripts into
`~/.claude/skills/`, so they arrive with the app and move forward with it — nothing to run.
Contributors editing `skills/` have a script for getting a working tree in place without a
rebuild; it is documented in
[ADR-016](docs/adr/ADR-016-skills-reach-claude-skills-by-launch-sync-install-sh-is-the-fallback.md).

| Skill | What it does |
|---|---|
| `/start-session <CAT> <ticket> <name>` | Create the session's folder + `notes.md` under the category's folder, register it, and — only when that folder is inside a git repo — fetch and rebase the branch onto `origin`. The branch is read from the checkout when you did not name one, so being inside a repo is what triggers this, not the Branch field |
| `/close-session` | Wrap up the session: summarise into `notes.md` + append a history entry tagged with the session id |
| `/save-session` | Checkpoint mid-flight (same summary as close, marked `(in progress)`) **without** closing it — handy before a context compaction |
| `/sync-refs <notes>` | Realign one session's references: each ticket's current status from the tracker (via MCP) and any pull request whose branch names one of its tickets. Run by the dashboard's **Sync** |
| `/wrap-session <notes> <id>` | The headless twin of `/close-session`, run by the dashboard's **Close** button: steps 1–6 only, no distil and no questions — `--print` has no one to answer them |
| `/restart-session <slug>` | Reload a session's notes **and its recorded session id** into a fresh session (history stays linked) |
| `/archive-session <slug>` | Mark a session archived (drops it from the active list) |
| `/import-session <CAT> <name>` | Bind an existing Claude Code session to a `notes.md` and register it, under a chosen space and category. Run by first-run setup |
| `/rename-category <OLD> <NEW>` | Rename a category everywhere — moves the folder, re-tags notes, updates config |
| `/skill-propose` | Turn what this session taught into a new skill, or a patch to an existing one. With you there on a repeated correction it shows the verbatim change and applies it on your yes, logging it to `~/.claude/skills-applied.log`; otherwise it stages it for `/skills-review` |
| `/skills-review` | The approval gate for staged proposals: list, diff, then approve or reject. Where a proposal lands when nobody was there to answer it |
| `/skills-curate` | Periodic pass over the whole set: refresh usage, report `active`/`stale`/`archived`, stage merges of overlapping skills |
| `/learn` | Write one atomic note into this space's knowledge notes **the moment** something durable is learned — not at session close |
| `/route <ticket \| topic>` | A **Context Brief before you investigate**: this space's knowledge notes + past session notes + your tracker, summarised. Read-only |

Categories, note locations and knowledge-notes folders all come from your shared config, so the skills and the app stay in sync.

### The hooks

The skills run *inside* a session, so there are moments they cannot see — a turn ending
with the context nearly full, a compaction, a PR opened in passing. A hook is a script
**Claude Code** runs at one of those moments — not the app: the app puts the script on
disk and decides where it is declared.

All six ship inside the app and are **copied automatically** — with the skills, on every
launch. **Every session started from the
dashboard runs all six** without touching your settings: the app passes Claude Code a
`--settings` file of its own, and Claude Code merges that file's hooks with your global
ones (only `statusLine` is replace-not-merge, which is why the app wraps yours rather than
setting its own). A hook you have already enabled globally is not injected a second time.

| Hook | Event | What it closes |
|---|---|---|
| `ao_skill_guard.py` | `PreToolUse` (`Edit`, `Write`…) | The 14 skills are the app's; an edit to one is refused with the reason and the alternative — a skill of your own under another name. |
| `ao_autosave.py` | `Stop` | The checkpoint only happened when someone typed `/save-session`. This has the model run it itself — at 75 % and again at 90 % of context, and after 30 minutes without a checkpoint while the conversation moved. The figure is the session's real context percentage from the statusline cache, not a transcript byte count. |
| `ao_precompact.py` | `PreCompact` | Compaction is when a session forgets. This appends an `(in progress)` line to the session history with the transcript path and the moment — the summary stays the model's to write, and the next hook says so once tools are back. |
| `ao_session_start.py` | `SessionStart` | The `/learn` habit — write a durable fact the moment it emerges — depended on whose `CLAUDE.md` the session loaded. This states it at every tracked session's start; after a compaction with stale notes, it asks for `/save-session` first. |
| `pr_attach.py` | `PostToolUse` (`Bash`, or the GitHub MCP create tool) | A session's PRs are read from its `notes.md`, which only the skills write — so a PR opened mid-session is invisible until your next `/save-session`, exactly when the link matters most. This attaches the URL the moment `gh pr create` (or `edit`, `reopen`) prints it, or the GitHub MCP server's `create_pull_request` returns it. The URL is always taken from the tool's result, never from its input. |
| `learn_nudge.py` | `UserPromptSubmit` | `/learn` and `/skill-propose` say "use PROACTIVELY", but nothing forces the check at the turn a correction actually lands. This reads your message and, on a short high-precision phrase list, injects a one-line reminder for that turn. |

**Enabling** them in `~/.claude/settings.json` — the file that decides which code Claude Code
runs on your machine — extends all of this to sessions you start from a plain terminal.
Nothing does that behind your back.

**Two ways to enable them**, both equivalent:

- **From the app** — first-run setup's last step, or **Settings → first-run setup** later.
  It shows the exact `settings.json` it would write, copies your current one to a
  timestamped backup, then writes atomically. It also tells you which are already enabled,
  and offers nothing when all six are.
- **By hand** — they are ordinary Claude Code hook entries.

Two things worth knowing about how they behave. `pr_attach` is the only one that **writes**:
it requires a `gh pr create` (never `edit`, `list` or `view`, whose output is full of other
people's PR URLs) and takes the URL from the tool's *response*, not the command — a failed
create prints none, and a `--body` mentioning "depends on …/pull/12" is not the PR you just
opened. Its writes are additive, idempotent and atomic. `learn_nudge` writes nothing at all;
its phrase list is deliberately narrow ("always", "never", "toujours", "from now on",
"je préfère", "ne … plus"…), because matching an ordinary mid-conversation redirect would
fire on most turns and teach the model to ignore the nudge — which is the very problem it
exists to fix. Throttled to once per session per 15 minutes.

Both are silent and exit 0 on every path: a broken hook must never make a successful
`gh pr create` look like a failure, or turn sending a message into a visible error. And
`learn_nudge` only catches signal carried in your own wording — a gotcha you never phrase as
a standing preference still relies on the model's judgment, or on the distil step of
`/save-session` and `/close-session`.

> [!IMPORTANT]
> **Working from a clone? `git pull` alone does not update your skills.** It moves the repo's `skills/`; the copies Claude Code loads live in `~/.claude/skills/`, and a rebuild is what carries them across. **The app tells you when that has not happened** — a notice at launch and whenever the window regains focus, with an **Update** button that closes the gap. It needs no setup: a build from a clone watches that clone. Only this app's 14 skills are ever in scope, and one you had edited is restored and named — they are the app's, not customisable (see "Where they live"). A release `.dmg` has no clone to watch and stays quiet; its skills advance with the app. Details in [ADR-016](docs/adr/ADR-016-skills-reach-claude-skills-by-launch-sync-install-sh-is-the-fallback.md).
>
> **Updating from an earlier version?** Your config **auto-migrates to v2** on first launch — named spaces + per-space knowledge-notes folders, with a `.v1-backup` kept (see [ADR-015](docs/adr/ADR-015-config-v1-to-v2-migration-flag-gated-self-cleaning.md)). Nothing to do by hand.

### Memory that beats compaction

Long sessions force the assistant to **compact** its own history — silently dropping older context until it loses the thread. This app keeps what matters in `notes.md` on disk instead: `/close-session` records the goal, decisions and next steps **plus the session id**; `/restart-session` loads all of it — and that id — into a fresh conversation, so the chain back to the original is never broken. Need the literal transcript? `claude --resume <id>` replays it verbatim.

**And a second tier, across sessions.** A `notes.md` remembers *one* session; the decision that cost you an afternoon deserves to outlive it. Give a space a knowledge-notes folder and two things fill it: `/close-session` distils the session's high-signal decisions on the way out, and **`/learn` writes a note the moment something durable comes up** — which matters, because a session you never close teaches the next one nothing. `/learn` extends an existing note rather than adding a near-duplicate, and announces every write in one line; there is deliberately no approval prompt, since a prompt at every insight would defeat writing in flight.

The skill ships, but the *trigger* has to be in front of the assistant at all times to fire on its own. Sessions started from the app get it from a hook ([The hooks](#the-hooks)); for a session started elsewhere with the hooks not enabled, add this to your `~/.claude/CLAUDE.md`:

> When something durable emerges mid-session — a preference or correction I stated, a stable fact about the environment, a gotcha with its workaround — invoke `/learn` then, not at the end. The test is: does writing this stop me repeating myself?

`/route <ticket | topic>` then reads that folder, your past session notes and — when a tracker is reachable — its tickets, to build a **Context Brief before you open the code**. It resolves *which* folder from the current session's space, so work and personal knowledge never bleed into each other.

```mermaid
flowchart LR
    S1(["Session 1<br/>you + Claude"]) -->|/close-session| N["notes.md<br/>goal · decisions · next steps<br/>+ session id"]
    N -->|"/restart-session &lt;slug&gt;"| S2(["Session 2<br/>fresh chat,<br/>briefed from the notes"])
    N -->|"claude --resume &lt;id&gt;"| R(["The exact original<br/>transcript, replayed"])
    S2 -->|/close-session| N
    classDef disk fill:#1e2230,stroke:#9b8cff,stroke-width:2px,color:#fff;
    class N disk;
```

Everything stays linked — **notes → session id → transcript** — so nothing important lives only in a context window.


<details>
<summary><strong>Usage bar (model · 5h / weekly limits · context) — automatic</strong></summary>

A slim bottom bar shows your **model**, the **5-hour** and **weekly** rate-limit windows
(colour-coded, with reset countdowns), and the current **context %** — the numbers a Claude
Code statusline shows. Claude Code only hands that data to a `statusLine` command (never to
disk), so the app supplies its own.

**No setup needed** for sessions **launched from the dashboard**: the app installs a bundled
wrapper (`~/.claude/ao-statusline.sh`) and, at each launch, passes it as that session's
`statusLine` via `claude --settings` — **per-session, so it never edits your global
`settings.json`**. The wrapper writes `~/.claude/statusline-cache.json` (which the app reads
**read-only**) and then delegates to your own statusline, so your terminal statusline is
unchanged. See [`scripts/ao-statusline.sh`](scripts/ao-statusline.sh).

Caveat: only sessions started from the app feed the bar (the injection is per-launch), so it
dims as *stale* if you've only worked outside the app, and hides entirely when no cache exists.

</details>

📖 **New to the lifecycle?** The **[Guide](docs/GUIDE.md)** explains the four session states (Active · Stale · Closed · Archived), Start vs Resume vs Restart, and how the notes beat compaction — in plain terms, no jargon.

## Customization

Edit everything in the app's **Settings (⚙)** — spaces & their paths, categories & colours, knowledge-notes folders, terminal app, ticket tracker URL, themes/looks, density, keyboard shortcuts. Two stores, deliberately: anything the **skills also need** persists to `~/.config/ai-agents-orchestrator/config.json`, while what is purely how the app looks to you — theme, accent, look, density, compact chrome, shortcuts, pinned cards — stays in `localStorage`, so it never travels through the file the skills read.

```json
{
  "roots": [
    { "name": "Work",  "path": "~/work", "vaultPath": "~/work/vault" },
    { "name": "Perso", "path": "~", "vaultPath": "" }
  ],
  "categories": [
    { "name": "FEAT",   "color": "#7df0c0", "root": "Work" },
    { "name": "BUG",    "color": "#ff9eb1", "root": "Work" },
    { "name": "REVIEW", "color": "#d9a86e", "root": "Work" },
    { "name": "PERSO",  "color": "#8fd9ff", "root": "Perso" }
  ],
  "knowledge": { "enabled": false },
  "ticketBaseUrl": ""
}
```

Each category names the **space** it lives under — the `root` key in the config (its folder is `<space path>/<CATEGORY>`), so the *same* category name can exist in several spaces, and the titlebar space selector scopes the view. Each space can carry a `vaultPath` — its **knowledge notes**: a plain folder of Markdown the session skills distil decisions into, and `/route` reads back before you investigate. Obsidian is a pleasant way to browse it; nothing requires it, and the config key is `knowledge` (the old `obsidian` key is still read). *(Back-compat: a legacy v1 config — `workRoot`/`personalRoot`, a category `scope` of `work`/`personal`, and `obsidian.workVaultPath`/`personalVaultPath` — is auto-migrated on launch to the `Work`/`Perso` spaces + per-space `vaultPath` (a backup is kept), so existing configs keep working untouched.)*

**Ticket tracking — any tracker, not just Jira.** `ticketBaseUrl` is just a URL prefix: the app appends each session's ticket ID to it to make the ID clickable. Point it at whatever you use:

| Tracker | `ticketBaseUrl` |
|---|---|
| Jira | `https://yourcompany.atlassian.net/browse/` |
| Linear | `https://linear.app/your-team/issue/` |
| GitHub Issues | `https://github.com/owner/repo/issues/` |
| Azure DevOps | `https://dev.azure.com/org/project/_workitems/edit/` |

Leave it blank and ticket IDs simply show as a (non-clickable) tag. *(The legacy key `jiraBaseUrl` is still read for backward compatibility.)*

## FAQ

**Does it show all my sessions, or only ones started with `/start-session`?** Two sources, both automatic:

- **Running** — *every live Claude Code session* on your machine shows up, managed or not. Unmanaged ones just carry less metadata (no goal/category/ticket) until you bring them in — through **first-run setup**, or with `/restart-session` for one you had managed before.
- **Closed / Archived / Stale** — these list **managed** sessions: ones with a `notes.md` under your category roots (created by `/start-session`). That `notes.md` is what gives the dashboard the goal, history, and lifecycle state.

**Can I import my existing / older Claude Code sessions?** Yes — that is what **first-run setup** is for. It scans `~/.claude` for every transcript a person actually typed in, shows you what each one opened with and left off at (**▸ Preview**), and imports the ones you tick, each to the space and category you choose. It runs itself once on a fresh install, and **Settings → First-run setup** re-runs it whenever you want. Live sessions need nothing either way — they are already in **Running**.

Under the hood each import runs `/import-session`, which writes the `notes.md` and registers the session; `/restart-session <slug>` reopens one later. Setting a space's **path** only tells the app *where* to scan for managed sessions — it does not ingest transcripts on its own; the import pass does, and only for what you ticked.

## Security

- **Brutus is sandboxed by flags, not by his prompt** — `--restricted` confines his reads to your category and knowledge folders (never a space root, never your home folder), `--strict-mcp-config` removes every MCP server, and his only allowed write is his own `memory.md`. `scripts/probe-brutus-sandbox.sh` checks all of it against your installed Claude Code, judging each check on the tool's result, not the model's answer.
- **Every shell interpolation is quoted** — `claude` runs through a login shell, because a Finder-launched app has no `claude` on its PATH; each value interpolated into that command line is POSIX single-quote escaped first. `open`, `osascript` and `git` are spawned with separate args, and AppleScript uses the `on run argv` pattern.
- Folder / branch / URL inputs are **allowlist-validated** (absolute canonical path that exists and is a directory; a real git checkout whenever a branch is asked for; safe branch name; `github.com/owner/repo/pull/N`).
- The session-file writes (archive · PR links / tickets · Doctor's repairs · Clean's archive-or-delete · the rollback of a half-done import) are **atomic**, target a real `notes.md` or a session folder two levels below a configured space, and are **confined under your configured roots** (canonicalized — no `../` escape). A Clean deletion goes to the OS Trash, not an unlink.
- **The session skills** are app-owned: the app copies its bundled versions into `~/.claude/skills/` **silently at each launch**, plus on the Settings button. The write is confined to the 14 names it ships plus `lib/` and `.ao-base/`, never touches session transcripts or a skill of yours, and an older build stands down rather than revert a newer install. The files are installed read-only and the `ao_skill_guard` hook refuses an agent's edit to one; a copy forced anyway is restored and named.
- External links open in your **system browser**, never inside the app.
- **The app itself makes no network calls**, and stores no secrets — none of its direct dependencies is an HTTP client, and the one `Cargo.lock` does carry comes from Tauri core and is unused here. Two buttons do reach out, through Claude Code rather than the app: **Sync** (tracker via MCP, `gh` for pull requests) and **Close** (`/wrap-session` runs `gh pr view` to attach the PR before filing the session). Both are things you press.

## Tech stack

| Layer | Tool |
|---|---|
| Desktop | **Tauri v2** (Rust + the OS's WebView — 7 MB `.dmg`, no Chromium) |
| UI | Vanilla JS — no framework (fast, simple, hackable) |
| Terminal | xterm.js + portable-pty |
| Backend | Rust (`config` · `reader` · `pty` · commands) |
| Tests | Rust unit tests (219, `cargo test`) + Jest (216, renderer logic) + Playwright smoke tests (18, the renderer in a real browser) + the hooks' own unittest files (71, `python3 hooks/test_*.py`) — 524 total |

> [!NOTE]
> ## What's new
>
> - ⟳ **Sync realigns a session with reality** — one button: ticket statuses read from your tracker, and any pull request opened since the last checkpoint attached. **Sync all**, in the titlebar, does it for every open session at once — one `gh` batch, then the agents one at a time. Nothing runs in the background.
> - 🔀 **Pull requests carry their state** — open, merged, closed or draft, on the card and spelled out with each PR's title in the detail panel.
> - 🏷 **Tickets carry their tracker's own status word** — `In Review`, `Triaged`, whatever your project calls it. Read through MCP, so the app itself never holds a tracker credential.
> - ✅ **Close finishes a stale session properly** — it resumes the session headless, writes the summary, attaches the PRs, and moves it to Closed. No terminal opens.
> - 🧠 **Knowledge notes build themselves** — `/learn` writes the moment something durable comes up, extending the note that already owns the subject; an opt-in hook now catches it the instant your own wording states a preference or correction, not only when you ask.
> - 📂 **A session can start in any folder** — the ＋New form's **Start in** takes any directory, not only a git checkout: a notes tree, a scratch folder, wherever the work is. Only **Branch** still needs a checkout. It is also the way to keep git out of it entirely — a folder outside any repo means session start never fetches or rebases.
> - 🌱 **Git is optional, and no worktree is ever created** — what decides whether git runs is whether the session opens inside a repo; the ＋New form carries that warning where the decision is made.
> - 📥 **First-run setup brings your existing sessions in** — three steps: spaces and categories, then the Claude Code sessions already on this machine, then one import pass. Each session goes to the space and category you pick, and **▸ Preview** shows what it opened with and what it left off at before you decide. The first step also sets each space's knowledge-notes folder, your ticket tracker URL and the card density — the last with a live sample card, so you pick by looking.
> - 🩺 **Doctor finds what is genuinely broken** — a session filed as closed while its process is still running, a frontmatter pointing at a conversation that no longer exists, a pidfile for a process that has exited. It reports; you tick what it repairs. A pruned transcript is ordinary ageing, and it says so rather than counting it as damage.
> - 🧹 **Clean audits the rest by age** — it proposes what to archive and what to delete, using the same last-touched date the list already shows. Nothing is pre-ticked, and a deletion goes to the Trash.
> - 🛡 **The app's skills keep themselves current, and stay the app's** — the 14 lifecycle skills are synced silently at launch like any app resource, installed read-only, and an agent's edit to one is refused by a hook. An older build never reverts a newer install. Want different behaviour? Copy a skill under another name and change that one — it is never touched.
>
> Earlier releases: the [changelog](CHANGELOG.md) has the full history.

## Roadmap

- [x] In-app Settings UI (categories, colours, roots, themes, shortcuts)
- [x] Bundled session skills + one-command installer
- [x] Kanban board (groups, attached notes, generative colours)
- [x] Export / import settings
- [x] Tracker-agnostic ticket links (Jira, Linear, GitHub Issues, Azure DevOps)
- [ ] **Beyond Claude Code** — GitHub Copilot, and other agent CLIs next (today it reads Claude Code's session state)
- [ ] Standalone terminal tab — use the in-app terminal for ad-hoc commands, not just resuming a session
- [ ] Signed + notarized `.dmg` releases
- [ ] Homebrew cask · auto-update
- [ ] Richer knowledge-notes integration (auto-distil, backlink graph)

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for notable changes ([Keep a Changelog](https://keepachangelog.com/) format).

## Contributing

**Issues and suggestions are very welcome** — bug reports, feature ideas, rough edges. This is an opinionated, design-led project that I maintain solo, so I keep tight control over the UX. I do occasionally accept well-scoped PRs — especially infrastructure and cross-platform work (Linux support [landed that way](CHANGELOG.md)) — but **please open an issue first** so we can agree on the approach before you write code. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

**[AI Agents Orchestrator Source Available License v1.0](LICENSE)** — free to download, use, and evaluate, including in the course of your professional work at a company. You **may not** resell it, redistribute it, deploy it organization-wide, offer it as a hosted/SaaS service, rebrand it, or distribute modified versions, without written permission. Source is available for transparency, learning, and contribution. Want to do more? Reach out.

Built by an ADHD developer who loves parallel-tasking with Claude a little too much — for anyone juggling more parallel work than one brain can hold.
