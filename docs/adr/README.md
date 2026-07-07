# Architecture Decision Records

_Generated from the adversarial expert-panel synthesis (6 personas, 3 rounds). Each ADR records a decision, its trade-off, and the rejected alternatives._

> ⚠️ **ADR-001–011 are historical (Electron era).** They document the original Electron design and the Electron→Tauri migration plan. The app runs on **Tauri** now — see [ARCHITECTURE.md](./ARCHITECTURE.md). **ADR-012+ are current.** ADRs are append-only records, so the old ones are kept rather than rewritten.

| ADR | Title | Status |
|---|---|---|

| [ADR-001](./ADR-001-vanilla-js-electron-35-macos-read-only-claude-proj.md) | Vanilla JS + Electron 35 macOS read-only ~/.claude projection (no network, no config writes) | Historical |
| [ADR-002](./ADR-002-fix-critical-pty-zombie-leaks-via-simple-main-js-w.md) | Fix critical PTY zombie leaks via simple main.js window-close handler (not SessionLifecycleManager abstraction) | Historical |
| [ADR-003](./ADR-003-renderer-architecture-2-3-files-app-js-ui-js-deleg.md) | Renderer architecture: 2-3 files (app.js, ui.js, delegated-events.js) with extracted pure-function modules (not 7-module split) | Historical |
| [ADR-004](./ADR-004-data-layer-caching-mtime-tracked-files-not-fs-watc.md) | Data layer caching: mtime-tracked files (not fs.watch), 5s TTL invalidation on poll | Historical |
| [ADR-005](./ADR-005-ipc-surface-locked-8-fixed-channels-all-inputs-val.md) | IPC surface locked: 8 fixed channels, all inputs validated, no future expansion without security audit | Historical |
| [ADR-006](./ADR-006-detail-panel-architecture-keep-separate-detail-htm.md) | Detail panel architecture: keep separate detail.html, extract shared rendering to renderer/lib/detail-lib.js | Historical |
| [ADR-007](./ADR-007-distribution-electron-builder-code-signing-notariz.md) | Distribution: electron-builder + code-signing + notarization in v1.0, auto-update deferred to v1.1 | Historical |
| [ADR-008](./ADR-008-secrets-management-read-only-from-claude-json-in-v.md) | Secrets management: read-only from ~/.claude.json in v1.0, NO Keychain or in-app storage | Historical |
| [ADR-009](./ADR-009-v1-0-scope-defer-onboarding-settings-pages-mcp-edi.md) | v1.0 scope: defer onboarding, settings pages, MCP editor to v1.1; ship session viewer + terminal | Historical |
| [ADR-010](./ADR-010-terminal-lifecycle-cache-xterm-instances-per-sessi.md) | Terminal lifecycle: cache xterm instances per sessionId, dispose on PTY death or app quit | Historical |
| [ADR-011](./ADR-011-incremental-migration-plan-4-phases-pty-cleanup-te.md) | Incremental migration plan: 4 phases (PTY cleanup, tests, refactor, packaging) with buildable + green-test gates | Historical |
| [ADR-012](./ADR-012-new-session-via-launcher-not-writer.md) | New session via launcher (open `claude` + `/start`), not an in-app writer | APPROVED |
| [ADR-013](./ADR-013-archive-from-dashboard-bounded-source-of-truth-write.md) | Archive from the dashboard: one bounded source-of-truth write | APPROVED |
| [ADR-014](./ADR-014-delete-archived-session-to-os-trash.md) | Delete an archived session by moving its folder to the OS Trash (recoverable, guarded) | APPROVED |
| [ADR-015](./ADR-015-config-v1-to-v2-migration-flag-gated-self-cleaning.md) | Config v1→v2 migration: transient `migratedToV2` flag, migrate-on-launch, self-cleaning staged rollout, fail-loud shim strip | APPROVED |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the synthesized target architecture and invariants.
