# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

> Add entries under **[Unreleased]** as you go; when you tag a release, rename that
> section to the version + date and start a fresh **[Unreleased]** above it.

## [Unreleased]

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

[Unreleased]: https://github.com/t-mercier/ai-agents-orchestrator/compare/v0.2.0-alpha...HEAD
[0.2.0-alpha]: https://github.com/t-mercier/ai-agents-orchestrator/releases/tag/v0.2.0-alpha
