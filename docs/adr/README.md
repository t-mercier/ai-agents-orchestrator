# Architecture Decision Records

_Generated from the adversarial expert-panel synthesis (6 personas, 3 rounds). Each ADR records a decision, its trade-off, and the rejected alternatives._

| ADR | Title | Status |
|---|---|---|

| [ADR-001](./ADR-001-vanilla-js-electron-35-macos-read-only-claude-proj.md) | Vanilla JS + Electron 35 macOS read-only ~/.claude projection (no network, no config writes) | APPROVED |
| [ADR-002](./ADR-002-fix-critical-pty-zombie-leaks-via-simple-main-js-w.md) | Fix critical PTY zombie leaks via simple main.js window-close handler (not SessionLifecycleManager abstraction) | APPROVED |
| [ADR-003](./ADR-003-renderer-architecture-2-3-files-app-js-ui-js-deleg.md) | Renderer architecture: 2-3 files (app.js, ui.js, delegated-events.js) with extracted pure-function modules (not 7-module split) | APPROVED |
| [ADR-004](./ADR-004-data-layer-caching-mtime-tracked-files-not-fs-watc.md) | Data layer caching: mtime-tracked files (not fs.watch), 5s TTL invalidation on poll | APPROVED |
| [ADR-005](./ADR-005-ipc-surface-locked-8-fixed-channels-all-inputs-val.md) | IPC surface locked: 8 fixed channels, all inputs validated, no future expansion without security audit | APPROVED |
| [ADR-006](./ADR-006-detail-panel-architecture-keep-separate-detail-htm.md) | Detail panel architecture: keep separate detail.html, extract shared rendering to renderer/lib/detail-lib.js | APPROVED |
| [ADR-007](./ADR-007-distribution-electron-builder-code-signing-notariz.md) | Distribution: electron-builder + code-signing + notarization in v1.0, auto-update deferred to v1.1 | APPROVED |
| [ADR-008](./ADR-008-secrets-management-read-only-from-claude-json-in-v.md) | Secrets management: read-only from ~/.claude.json in v1.0, NO Keychain or in-app storage | APPROVED |
| [ADR-009](./ADR-009-v1-0-scope-defer-onboarding-settings-pages-mcp-edi.md) | v1.0 scope: defer onboarding, settings pages, MCP editor to v1.1; ship session viewer + terminal | APPROVED |
| [ADR-010](./ADR-010-terminal-lifecycle-cache-xterm-instances-per-sessi.md) | Terminal lifecycle: cache xterm instances per sessionId, dispose on PTY death or app quit | APPROVED |
| [ADR-011](./ADR-011-incremental-migration-plan-4-phases-pty-cleanup-te.md) | Incremental migration plan: 4 phases (PTY cleanup, tests, refactor, packaging) with buildable + green-test gates | APPROVED |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the synthesized target architecture and invariants.
