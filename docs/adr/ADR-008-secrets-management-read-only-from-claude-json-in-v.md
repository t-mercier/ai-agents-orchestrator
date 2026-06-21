# ADR-008 — Secrets management: read-only from ~/.claude.json in v1.0, NO Keychain or in-app storage

> ⚠️ **Historical — pre-Tauri (Electron era).** Kept as a decision record. The app has since migrated to Tauri; see [ARCHITECTURE.md](./ARCHITECTURE.md) for the current design.


**Status:** APPROVED

## Context

Proposals to add Keychain (node-keychain native module) + Settings drawer for secret editing assume app should be a CONFIG MANAGER. This conflicts with ADR-001 (read-only VIEWER). If app stores secrets (Keychain or JSON file), it MUST: (1) keep ~/.claude.json in sync (coherency problem: which is source-of-truth?), (2) validate secrets on write (MCP test spawning), (3) handle Keychain permission prompts (UX friction on first use). For v1.0, single source-of-truth (~/.claude.json, written by Claude Code) is simpler, safer, and aligns with app's read-only mission.

## Decision

v1.0: App reads ~/.claude.json as reference only (displays 'GitHub MCP configured: yes/no' badge). User edits secrets externally via $EDITOR ~/.claude.json (clearly labeled 'Edit in your text editor'). NO Keychain access, NO in-app secret storage, NO MCP config editor UI in v1.0. Defer secret management to v1.1 if user demand justifies complexity.

## Consequences

Remove ~150 proposed lines: config-manager.js, Settings modal renderer, node-keychain integration, Keychain sync logic. App reads ~/.claude.json at startup (JSON parse, no YAML complexity). Detail panel shows 'GitHub token: configured' (green badge only, no value display). When user wants to add/edit token: link 'Edit in ~/.claude.json' opens file in default editor ($EDITOR env var or VSCode). User edits JSON → saves → app re-polls ~/.claude.json on next 5s cycle. Benefit: zero new dependencies, no node rebuild overhead, clear separation of concerns (Claude Code owns secrets, app only reads), no Keychain permission prompts, no sync bugs. Trade-off: users cannot edit secrets in app UI (must use editor); acceptable for MVP because (1) most users configure once at setup, (2) manual edit is clear alternative, (3) v1.1 can add write support if feedback justifies it.


## Alternatives rejected

(1) Add Keychain + Settings UI in v1.0: 400 lines code, node-keychain rebuild overhead, Accessibility entitlements + permission prompts, Keychain↔~/.claude.json sync complexity, support burden. (2) Full configurator (MCP servers, skills, GitHub/Slack tokens): requires MCP connection testing, OAuth flows, YAML parsing; massive scope explosion. (3) Hybrid model (Keychain + ~/.claude.json): which is source-of-truth? If Keychain, Claude Code can't read it (app-only). If ~/.claude.json, Keychain is duplication.

