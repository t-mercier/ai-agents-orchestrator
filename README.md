# Agents Orchestrator

**Live mission control for all your parallel Claude Code sessions — a native macOS dashboard that brings order to the chaos.**

[![CI](https://img.shields.io/github/actions/workflow/status/t-mercier/agents-orchestrator/ci.yml?branch=master)](https://github.com/t-mercier/agents-orchestrator/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![macOS](https://img.shields.io/badge/macOS-13+-000000?style=flat&logo=apple)](https://www.apple.com/macos/)
[![Made with Claude Code](https://img.shields.io/badge/Made%20with-Claude%20Code-000000)](https://claude.com/claude-code)

<!-- HERO GIF — the #1 conversion lever. Record a ~5–10s looped demo (dashboard
     with sessions in different states → toggle List/Cards → search/filter → open
     the embedded terminal), save it to docs/media/hero.gif, then uncomment the
     line below. Kept commented so the README never renders a broken image. -->
<!-- ![Agents Orchestrator](docs/media/hero.gif) -->

## The problem

You're running a dozen Claude Code sessions in parallel — across tickets, projects, branches. Each one is a buried terminal tab. Which are running? Which are *waiting for you*? Which finished an hour ago? Where is each one?

Terminal tabs don't scale. You need mission control.

## Features

- **Live dashboard** — polled every 5s. Every session's status at a glance: **running** · **idle** · **waiting** (pulsing) · **background shell**.
- **Two views** — flip between a grouped **List** and a full-width **Cards** view.
- **Lifecycle tabs** — Running · Closed · Archived, with live **search** and **category filters**.
- **Session detail** — goal, last activity, git branch, last-update time, clickable Jira & PR links.
- **Embedded terminal** — resume a session in place (xterm.js + node-pty), or **detach it into its own window** with a pin / always-on-top toggle.
- **One-click actions** — **New** session, **Resume** (full transcript), **Restart** (from notes), **Open notes** folder in Finder.
- **Pin** the sessions that matter to the top.
- **Customizable** — categories, colors, and work-root folder, all yours.

## How it works

**Local-first. Zero network. Read-only.**

Agents Orchestrator is a *projection* of the session state Claude Code already writes under `~/.claude` (session metadata, `notes.md`, JSONL transcripts). It **never** sends anything over the network, **never** writes your session state, and **never** stores secrets. It visualizes what's on disk and lets Claude Code do the rest.

Your data stays on your machine, under your OS's protection. The app is just a window into it. Privacy by design.

## Quick start

```bash
git clone https://github.com/t-mercier/agents-orchestrator.git
cd agents-orchestrator
npm install
npm run rebuild     # compiles the node-pty native module against Electron
npm start
```

The dashboard auto-discovers your sessions from `~/.claude`.

**Build a signed DMG:**

```bash
npm run dist        # code-signed + notarized .dmg in dist/
```

**Requirements:** macOS 13+ · Node 20+ · Xcode Command Line Tools (`xcode-select --install`, for `node-pty`) · [Claude Code](https://claude.com/claude-code).

## Customization

Settings live in `~/.config/agents-orchestrator/config.json`. Define your own categories (name, color, and whether they live under your work root or your home folder):

```json
{
  "version": 1,
  "workRoot": "~/work",
  "categories": [
    { "name": "FEAT",   "color": "#7df0c0", "scope": "work" },
    { "name": "BUG",    "color": "#ff9eb1", "scope": "work" },
    { "name": "REVIEW", "color": "#d9a86e", "scope": "work" },
    { "name": "CHORE",  "color": "#ffe17a", "scope": "work" },
    { "name": "TEST",   "color": "#cdd0d6", "scope": "work" },
    { "name": "PERSO",  "color": "#8fd9ff", "scope": "personal" }
  ],
  "obsidian": { "enabled": false, "vaultPath": "" },
  "jiraBaseUrl": ""
}
```

Set `jiraBaseUrl` to your tracker's browse prefix (e.g. `https://yourcompany.atlassian.net/browse/`) to make ticket IDs clickable; leave it empty for plain text.

`scope: "work"` → the category folder lives under `workRoot`; `scope: "personal"` → under your home directory. Changes are picked up on the next refresh. *(An in-app Settings editor is on the roadmap — for now, edit the JSON.)*

## Security

- Electron hardened: `contextIsolation: true`, `nodeIntegration: false`.
- A small, validated IPC surface — every input is checked.
- External links open in your **system browser**, never inside the app.
- **No secrets** stored or transmitted; nothing leaves your machine.
- Releases are **code-signed and notarized**, so Gatekeeper won't block them.

## Tech stack

| Layer | Tool |
|---|---|
| Desktop | Electron |
| UI | Vanilla JS — no framework (fast, simple, hackable) |
| Terminal | xterm.js + node-pty |
| Build | esbuild, electron-builder |
| Tests | Jest (90+) |

## Roadmap

- [ ] In-app Settings UI for categories & colors (no more hand-editing JSON)
- [ ] Bundled session skills (`/start`, `/close`, `/restart`, `/archive`) + one-command installer
- [ ] Optional Obsidian integration (auto-distill notes)
- [ ] Homebrew cask
- [ ] Auto-update

## Contributing

Issues and PRs welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). The codebase is intentionally small: vanilla JS + Electron, no framework overhead. New IPC channels or any network code require an ADR (see [`docs/adr`](docs/adr)).

## Why I built this

> _<add your personal note here>_

## License

[MIT](LICENSE). Built for Claude Code users, by a Claude Code user.
