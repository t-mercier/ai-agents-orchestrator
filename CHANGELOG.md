# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

> Add entries under **[Unreleased]** as you go; when you tag a release, rename that
> section to the version + date and start a fresh **[Unreleased]** above it.

## [Unreleased]

### Added
- **In-app session-skills installer** — the app now bundles the session skills (embedded at compile time) and can install/refresh them into `~/.claude/skills/` itself: a first-launch banner offers a one-click install when they're missing, and **Settings → Backup → Session skills** has an *Install / update skills* button (force-refresh, for after an app upgrade). A `.dmg`-only install is now self-sufficient — no git clone + `install.sh` needed. The installer also seeds a default config if absent and pre-creates the category folders. Writes only under `~/.claude/skills/`, user-triggered.
- **Linux support** 🐧 — runs on X11 and Wayland (verified on GNOME/Wayland); `cargo tauri build` produces `.deb`/`.AppImage`. External terminals resolve via `$TERMINAL`/`xdg-open` and the standard emulators; the macOS-only *reveal-existing-window* button is hidden on Linux. *(First external contribution — thanks [@FelixDombek-TomTom](https://github.com/FelixDombek-TomTom), #1.)*
- **CI + bundle-freshness guard** — a GitHub Actions workflow runs clippy/tests, and `npm run check:bundle` fails if the vendored `renderer/xterm-bundle.js` drifts from its source. *(Contributed by [@FelixDombek-TomTom](https://github.com/FelixDombek-TomTom), #2.)*
- **Import → v2 spaces** — the Import modal now picks a **space** (dropdown, like ＋New) instead of the old Work/Personal toggle, filters categories by space, and threads `--root` through `import_session` + the `/import-session` skill so the adopted notes.md lands under the chosen space.
- **Import by session ID** — paste a session ID to import one that isn't in the recent-transcripts list.
- **Import: Embedded / Terminal toggle** — adopt a session in the in-app terminal (keyed by its real id, links to the card with no re-key) or an external tab, sharing the `Open in` pref.

### Fixed
- **Resume/Restart now launch in `--permission-mode auto`** — previously only `+New`/Import did. If your default is **plan mode**, a resumed session started in plan, so `/close-session` and `/save-session` (which write `notes.md`) bailed at their plan-mode check — the close never recorded and the session lingered as **"stale"** in Running. All four launch sites (Resume/Restart × embedded/external) now force auto, matching `+New`.
- **Resumed archived/closed session showed as "OTHER"** — the Running tab resolved category/root only from `active-sessions.json` (by session id), so a session resumed after being archived/closed (de-registered) appeared uncategorised with no workspace. It now relinks to the managed `notes.md` whose history records that `session=<id>`, recovering category/ticket/root — and is excluded from its historical bucket while live (no double-listing).
- **Embedded `+New` terminal — false "already running"** — resuming a `+New` session (whose terminal is keyed by `notesPath`) checked liveness only by `sessionId`, so it warned "already running" instead of re-revealing the backgrounded terminal. It now matches either key and re-reveals.
- **`/close-session` relink** — a resumed session whose id isn't in `active-sessions.json` now finds its `notes.md` via the `session=<id>` history line (so the close records in the right place), and no longer falls back to "most recently modified session" (which could mis-route the close to a different session).
- **Import** launches the resumed session in **auto mode** (`--permission-mode auto`) so `/import-session` can write — plan mode was silently blocking the adoption.
- **False "Archived"** — a session was wrongly filed under Archived when the *word* "archived" appeared anywhere in its `notes.md` history (so the dashboard's own project, whose notes discuss archiving, kept self-archiving). The classifier now matches only the genuine `| ARCHIVED |` marker that `/archive-session` writes.
- **Archived/Closed status dot** — these showed a green ("running") dot in the List/Cards; they now use the muted grey *historical* dot (they aren't running).

## [0.2.2-alpha] - 2026-06-22

### Added
- **Start a new session in the embedded terminal** — ＋New now offers the same **Embedded / Terminal** destination toggle as Resume/Restart (shared `Open in` pref), so a brand-new session can open in the built-in terminal instead of an external iTerm tab.
- New sessions launch in **auto mode** (`--permission-mode auto`) so `/start-session` can write its workspace without being blocked by plan mode.

### Fixed
- **Embedded terminal — Shift+Enter** now inserts a newline instead of submitting (the Enter was leaking through and submitting).
- **Embedded terminal — scrolling** no longer intermittently sticks: the wheel drives xterm's `scrollLines` directly, bypassing a WKWebView canvas-viewport stall.
- **No white flash on window resize** — the webview is non-opaque and the native window background tracks the theme, so the growing edge shows the theme colour instead of the OS-default white.
- **rename-category** refuses to rename a category that exists under multiple spaces (it would have renamed only one and left the config inconsistent) — remove the duplicate first.
- **Session → space tagging** uses component-aware path matching, so a session under `FEAT-bug/` is no longer mis-tagged as belonging to `FEAT`.

## [0.2.1-alpha] - 2026-06-22

### Added
- **Spaces editor in Settings** — rename a space, set its folder (Browse), add/remove. Renaming a space retags the categories under it; each space shows its selected path on its own line.
- **Category colours from a seed + scheme** — the same generative system as the board (Spectrum / Shades / Analogous): pick a seed and the per-category colours fill from it.
- **Resizable Settings modal** — drag the corner; up to +20% wider and taller until everything fits.
- **Unified ⚲ Filter** — the filter popover now filters by **Space** *and* **Category** (the board's separate space selector was removed).

### Changed
- **List view** — pinned sessions float to the top of *each space* (no "PINNED" header); per-card space labels removed (the section header is the only space marker); the ticket/PR/notes icons sit flush-left under the title.

### Fixed
- **Restart** — closed/archived sessions restart in their **space root** (resolved from the session's `notes.md` location), not `$HOME`.
- **Board** — an empty, in-creation note no longer shows a delete trash; Escape / click-away cancels it.

## [0.2.0-alpha] - 2026-06-22

### Added
- **Spaces** — categories can live under multiple named spaces (e.g. *Work*, *Perso*, a client) instead of the fixed work/personal pair. **List & Cards** organise into collapsible **space sections** → category groups; the **Board** gets its own space filter next to its search; pinned / ⚡ waiting cards (which float out of their section) keep a small space tag. A category that exists in 2+ spaces (e.g. `AI-SYSTEM` under both Work and Perso) is fully supported — `＋New` has a **space dropdown** that picks which one a session lands under, and `start_session` + the `start-session` skill resolve the folder via the chosen space. Config schema v2: `roots: [{name,path}]` + a `root` per category, migrated transparently from the legacy `workRoot`/`personalRoot` + `scope`. *(A Spaces editor in Settings is still to come — add spaces by editing the config / folder picker meanwhile.)*
- **⚲ Filter popover** — the per-category chip row became a single **⚲ Filter** button + checkbox menu (deduped categories, active-count badge, one control across List/Cards/Board).
- **Import existing sessions** — a `＋Import` picker lists your recent *unmanaged* Claude Code sessions (searchable); pick one and it resumes (`claude --resume`) and is adopted into management (writes `notes.md` + registers it) under a chosen root/category. Backed by a new `discover_sessions` command and an `/import` skill. Picker hides slash-command/skill one-off runs and sub-agent sidechains.
- **Kanban board: category filters + search** — same controls as the List/Cards views, on a single filter bar.
- **Ticket as a number label** — tickets render as a clickable `PROJ-123` chip in the List, Cards, and Board (was a bare icon); clickable when a tracker URL is set, a plain label otherwise.
- **Guide + FAQ** — `docs/GUIDE.md` (session lifecycle, Start vs Resume vs Restart, notes-beat-compaction diagram) and a README FAQ on what shows up automatically vs. needs importing.
- README version badge.

### Changed
- **Licence → AI Agents Orchestrator Source Available License v1.0** (was PolyForm Noncommercial, which barred use at a for-profit). Now free to download, use, and evaluate — including in the course of professional work at a company — while prohibiting resale, redistribution, org-wide deployment, SaaS offerings, rebranding, and modified-version distribution without written permission.
- **Session skills renamed** (follows Claude's skill-naming conventions — generic single-word names are discouraged): `/start`→`/start-session`, `/close`→`/close-session`, `/restart`→`/restart-session`, `/archive`→`/archive-session`, `/import`→`/import-session` (`/rename-category` unchanged). The dashboard launcher emits the new names. **Re-run `bash scripts/install.sh --force`** and use the new commands.
- **Session skills are root-aware** — `aoconfig.py` resolves a session's folder from its category's root (with the legacy work/personal layout still supported). **Re-run `bash scripts/install.sh --force`** to update the bundled skills.
- **Board cards** — the title gets its own row; status badges + action icons moved to a foot row; the branch chip was dropped; the `STALE` badge is now the muted grey used in the List.
- **Positioning** — hero/README reframed around *AI development sessions* (mission control for the sessions you already run), not agent-spawning.
- Pre-Tauri ADRs (001–011) are clearly marked **Historical (Electron era)**; the app runs on Tauri.

### Fixed
- **`/restart` un-archive** — the revive step matched the substring `ARCHIVED` anywhere in a line and could strip legitimate `notes.md` history/decision bullets that merely mention the word. It now strips only a genuine archive marker (a `… | ARCHIVED | …` Session-history bullet).
- **Lifecycle classification** — a properly `/close`d session no longer lingers as *stale*: the classifier recognises the current `… | session=<id> | …` history format and reads the **newest-dated** entry (not the last physical line, which could be out of order).
- **Embedded terminal** — status dot updates live on the poll; returning to the List from the Board restores the open terminal; Resume/Restart route to the List view; the ⓘ info button works over the terminal.
- **Board inline editing** — Escape cancels a column/group rename or note edit (and a freshly-added empty note is removed instead of left as an orphan); the rename input survives the 5-second poll.
- **Import picker** — Escape closes it; cleaner derived titles; modal width fixed.
- **Mobile landing** — the "View on GitHub" button no longer wraps to two lines.

[Unreleased]: https://github.com/t-mercier/ai-agents-orchestrator/compare/v0.2.1-alpha...HEAD
[0.2.1-alpha]: https://github.com/t-mercier/ai-agents-orchestrator/compare/v0.2.0-alpha...v0.2.1-alpha
[0.2.0-alpha]: https://github.com/t-mercier/ai-agents-orchestrator/releases/tag/v0.2.0-alpha
