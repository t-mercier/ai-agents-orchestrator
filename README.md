<div align="center">

<a href="https://t-mercier.github.io/ai-agents-orchestrator/"><img src="docs/media/banner.png" alt="AI Agents Orchestrator — mission control for your AI development sessions" width="820"></a>

# AI Agents Orchestrator

**Mission control for your AI development sessions — a tiny native macOS dashboard that brings order to the chaos.**

[![Live site](https://img.shields.io/badge/%F0%9F%8C%90%20Live%20site-visit-9b8cff?style=for-the-badge)](https://t-mercier.github.io/ai-agents-orchestrator/)

[![CI](https://img.shields.io/github/actions/workflow/status/t-mercier/ai-agents-orchestrator/ci.yml?branch=master)](https://github.com/t-mercier/ai-agents-orchestrator/actions)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue.svg)](LICENSE)
[![macOS](https://img.shields.io/badge/macOS-13+-000000?style=flat&logo=apple)](https://www.apple.com/macos/)
[![Made with Claude Code](https://img.shields.io/badge/Made%20with-Claude%20Code-000000)](https://claude.com/claude-code)

</div>

> AI coding sessions don't last minutes anymore. They last **days, weeks, sometimes entire projects** — each accumulating context, decisions, repositories, tasks and agents. Before long, you're juggling dozens of parallel workstreams.
>
> **AI Agents Orchestrator gives you a unified view of every session, across every project** — so you can stay focused instead of getting lost in the chaos.

## The problem

Today each session is a buried terminal tab. Which are running? Which are **waiting for you**? Which finished an hour ago? Where did you leave each one?

Terminal tabs don't scale. You need mission control.

## Features

- **Live dashboard** — polled every 5s. Every session's status at a glance: **busy** · **idle** · **waiting** (pulsing) · **stale** (terminal gone, work not wrapped up) · **background shell**.
- **Three views** — a grouped **List**, a full-width **Cards** grid, and a **Board** (kanban).
- **Kanban board** — drag to reorder (insertion line), **drop a card onto another to group** them (named, collapsible), **attach notes** to a card or group, flag **urgent**, and add sessions from the board itself. Generative **column colours** (pick one seed → a harmonious set across however many columns you have), with each column tinting its own accent.
- **In-context detail** — click any card to open a **slide-over** with the session's goal, last activity, branch, Jira / PR links, and one-click **Resume / Restart / terminal** — without leaving the view.
- **Resume your way** — pick a session back up in the **built-in terminal** (in the app, xterm.js + portable-pty) *or* in **your own terminal** (iTerm / Terminal) — your choice. Detach the built-in one into its own always-on-top window if you like.
- **Keyboard-first** — arrows / `j` `k` to navigate, `Enter` to launch, `/` to search, `1`–`3` for tabs, `←/→` to switch tabs, `v` for view, `b` for board. **Remap any of it** in Settings → Shortcuts.
- **Looks & density** — curated colour "looks" (accent + a subtle surface ambiance), a custom accent, and Detailed / Compact / Minimal card density. Dark & light themes.
- **Lifecycle tabs** — Running · Closed · Archived, with live **search** and **category filters**.
- **Backup** — export / import all your settings to a file (handy before a reinstall).

### Three ways to look at your work

| Cards | Board |
|:---:|:---:|
| ![Cards view](docs/media/cards.png) | ![Kanban board](docs/media/board.png) |
| Full-width grid — every session at a glance. | Kanban with groups, attached notes, urgent flags, and generative column colours. |

Click any session for a **detail slide-over** — goal, branch, links, and one-click Resume / Restart — without leaving the grid:

![Detail slide-over over the cards grid](docs/media/cards-detail.png)

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

**Local-first. Zero network.**

AI Agents Orchestrator is a *projection* of the session state Claude Code already writes under `~/.claude` (session metadata, `notes.md`, JSONL transcripts). It **never** touches the network and **never** stores secrets — it visualizes what's on disk and lets Claude Code do the rest.

It is **read-only on `~/.claude` by design**. The only writes it makes are two explicit actions you trigger — **archiving** a session and **saving a PR link** — written atomically and confined to a `notes.md` under your configured roots (see [`docs/adr`](docs/adr)). Your UI preferences live in `localStorage` + your own config file.

## Quick start

**Requirements:** macOS 13+ · [Rust](https://rustup.rs) + the Tauri CLI (`cargo install tauri-cli`) · Xcode Command Line Tools (`xcode-select --install`) · [Claude Code](https://claude.com/claude-code).

```bash
git clone https://github.com/t-mercier/ai-agents-orchestrator.git
cd ai-agents-orchestrator

# 1. Install the session skills + seed your config
bash scripts/install.sh

# 2. Run the app (system WebView — no Chromium bundled)
cargo tauri dev
```

The dashboard auto-discovers your sessions from `~/.claude`.

**Build a `.app` / `.dmg`:**

```bash
cargo tauri build      # bundle in src-tauri/target/release/bundle/
```

> Built unsigned for now — on first launch, right-click the app → **Open** to get past Gatekeeper. Signed/notarized releases come once it's out of alpha.

## Session skills

The launcher buttons (**＋ New**, **Resume**, **Restart**, **Archive**) drive a small set of Claude Code skills. `scripts/install.sh` copies them into `~/.claude/skills/`:

| Skill | What it does |
|---|---|
| `/start <CAT> <ticket> <name>` | Create a session workspace + `notes.md` under the category's folder, register it, sync the repo |
| `/close` | Wrap up the session: summarise into `notes.md` + append a history entry |
| `/restart <slug>` | Reload a session's context from its notes into a fresh session |
| `/archive <slug>` | Mark a session archived (drops it from the active list) |
| `/rename-category <OLD> <NEW>` | Rename a category everywhere — moves the folder, re-tags notes, updates config |

Categories, note locations and Obsidian vaults all come from your shared config, so the skills and the app stay in sync. The installer won't overwrite a customised skill unless you pass `--force`.

📖 **New to the lifecycle?** The **[Guide](docs/GUIDE.md)** explains the four session states (Active · Stale · Closed · Archived) and Start vs Resume vs Restart — in plain terms, no jargon.

## Customization

Edit everything in the app's **Settings (⚙)** — categories & colours, scan roots, terminal app, themes/looks, density, keyboard shortcuts. It all persists to `~/.config/ai-agents-orchestrator/config.json` (which the skills read too):

```json
{
  "version": 1,
  "workRoot": "~/work",
  "personalRoot": "~",
  "categories": [
    { "name": "FEAT",   "color": "#7df0c0", "scope": "work" },
    { "name": "BUG",    "color": "#ff9eb1", "scope": "work" },
    { "name": "REVIEW", "color": "#d9a86e", "scope": "work" },
    { "name": "PERSO",  "color": "#8fd9ff", "scope": "personal" }
  ],
  "obsidian": { "enabled": false, "workVaultPath": "", "personalVaultPath": "" },
  "ticketBaseUrl": ""
}
```

`scope: "work"` → the category folder lives under `workRoot`; `scope: "personal"` → under `personalRoot`.

**Ticket tracking — any tracker, not just Jira.** `ticketBaseUrl` is just a URL prefix: the app appends each session's ticket ID to it to make the ID clickable. Point it at whatever you use:

| Tracker | `ticketBaseUrl` |
|---|---|
| Jira | `https://yourcompany.atlassian.net/browse/` |
| Linear | `https://linear.app/your-team/issue/` |
| GitHub Issues | `https://github.com/owner/repo/issues/` |
| Azure DevOps | `https://dev.azure.com/org/project/_workitems/edit/` |

Leave it blank and ticket IDs simply show as a (non-clickable) tag. *(The legacy key `jiraBaseUrl` is still read for backward compatibility.)*

## Security

- **No shell-string execution** — `open`, `osascript`, `git`, `claude` are all spawned with separate args (no injection); AppleScript uses the `on run argv` pattern.
- Repo / branch / URL inputs are **allowlist-validated** (absolute path, real git repo, safe branch, `github.com/owner/repo/pull/N`).
- The two filesystem writes (archive, PR link) are **atomic**, target a real `notes.md`, and are **confined under your configured roots** (canonicalized — no `../` escape).
- External links open in your **system browser**, never inside the app.
- Nothing is sent over the network; no secrets stored.

## Tech stack

| Layer | Tool |
|---|---|
| Desktop | **Tauri v2** (Rust + the OS's WebView — ~8 MB app, no Chromium) |
| UI | Vanilla JS — no framework (fast, simple, hackable) |
| Terminal | xterm.js + portable-pty |
| Backend | Rust (`config` · `reader` · `pty` · commands) |
| Tests | Rust unit tests (34, `cargo test`) + Jest (56, renderer logic) |

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
- [ ] Optional Obsidian integration (auto-distil notes)

## Contributing

**Issues and suggestions are very welcome** — bug reports, feature ideas, rough edges. This is an opinionated, design-led project that I maintain solo, so I'm not taking outside code contributions for now (it keeps the UX coherent and the codebase cleanly mine). Open an issue and let's talk. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

**[PolyForm Noncommercial 1.0.0](LICENSE)** — free to use, modify, and share for any **non-commercial** purpose. Commercial use requires a separate licence; reach out if that's you.

Built by an ADHD developer who loves parallel-tasking with Claude a little too much — for anyone juggling more parallel work than one brain can hold.
