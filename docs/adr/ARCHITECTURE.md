# Target Architecture

Electron 35 macOS app (single-user, local-first, read-only projection of ~/.claude files). Two primary subsystems: (1) Data Layer (main.js + data/reader.js + mtime-cache): polls ~/.claude sessions, notes.md, jsonl transcripts every 5s, filters by running/closed/archived status, derives metadata (goal, activity, branch, PR links). NO write access to ~/.claude (source-of-truth remains Claude Code's /start, /close, /archive skills). (2) Renderer Layer (app.js + ui.js + terminal.js): state machine (sessions[], selectedKey, activeTab, viewMode, search, filters), polling orchestration, delegated event handling for navigation/filtering, xterm.Terminal instances cached per-sessionId. PTY manager (data/pty-manager.js) spawns shells via node-pty, broadcasts data via IPC onData callbacks, cleaned up on window close or process exit. Preload.js enforces contextIsolation:true + 8 fixed IPC channels (no network calls, validated inputs). Vanilla JS throughout (no frameworks), CSS Grid cards/list layout, dark theme + vibrancy. Detached always-on-top windows for multi-session view share same PTY broadcast bus (IPC).

**Key Invariants:**
- Running session = alive pid in ~/.claude/sessions/*.json + isProcessAlive check
- Closed session = notes.md with Session-history section, no ARCHIVED marker
- Archived session = notes.md with ARCHIVED marker
- PTY affinity: one process per sessionId, killed on last window close
- xterm instance cached per sessionId, disposed on PTY exit or app quit
- Reader cache: mtime-tracked, invalidated if file mtime changed OR poll interval > 5s
- IPC surface locked: 8 channels, all inputs validated (sessionId regex, path bounds, protocol whitelist)
- Terminal UX: 5s polling with frozen sort (prevents list reorder under cursor), xterm resize via ResizeObserver + rAF throttle, status badges (busy=orange, waiting=red pulse, idle=green)
- Security: no secrets in app memory, no Keychain access (v1.0), no network, no shell injection via AppleScript (use explicit arg array to osascript)
- Distribution (v1.0): code-signed .dmg via electron-builder + Apple notarization (CI/CD in GitHub Actions), no auto-update (v1.1), arm64+x64 Universal binary via lipo

**Not in scope (v1.0):** onboarding wizard, settings pages, MCP server editor, Keychain integration, OAuth flows, config file writes, network clients, multi-machine sync, Windows/Linux ports.

Scoped for v1.1+: electron-updater auto-update, Homebrew cask, full MCP config UI, secret management (Keychain or ~/.claude.json writes with atomic transactions).
