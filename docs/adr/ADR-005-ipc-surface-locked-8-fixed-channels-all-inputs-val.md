# ADR-005 — IPC surface locked: 8 fixed channels, all inputs validated, no future expansion without security audit

**Status:** APPROVED

## Context

Current IPC handlers have scattered validation (regex for sessionId in some places, missing in others). open-in-iterm escapes cwd via simple backslash+quote (vulnerable to shell metacharacters in AppleScript context, though attack surface is small). Proposals to add 12 new config-management handlers (get-mcp-servers, add-mcp, test-connection, get-keychain-secret, etc.) multiply attack surface without commensurate review. Lock down now prevents future vulnerabilities by making IPC contract explicit + auditable.

## Decision

Preload.js exposes exactly 8 IPC channels (getSessions, getHistoricalSessions, openExternal, openPath, openInIterm, detachSession, pty-spawn/input/resize/kill). Validate all inputs at handler entry: sessionId regex /^[A-Za-z0-9_-]+$/, paths via path.isAbsolute(), URLs via protocol whitelist (http/https only). Fix open-in-iterm AppleScript escaping by using execFile with arg array (no shell interpolation). All future IPC additions require explicit security review documented in CONTRIBUTING.md.

## Consequences

Add IPC_SCHEMA validation object (30 lines) at preload.js entry, validate all args before passing to main. Fix open-in-iterm: replace inline AppleScript with execFile array args: `execFile('osascript', ['-e', 'on run argv...', '--', cwd, sessionId])` (osascript handles arg array escaping, zero shell injection risk). Document every channel in preload.js with threat model. Add pre-commit hook (already in .husky) to audit IPC calls for unsanitized user input. Cost: 30 lines schema + 5 lines open-in-iterm fix. Benefit: audit trail of accepted IPC contracts, prevents silent injection bugs, makes threat model explicit for future maintainers.


## Alternatives rejected

(1) Continue ad-hoc validation: scattered checks, easy to miss edge cases, future contributors won't know what's validated, likely to introduce vulns. (2) Add 12 config-management handlers in v1.0: expands attack surface (12 new IPC calls × 5 potential input fields = 60 new validation points), requires Keychain security analysis (how to prevent key leakage?), MCP test spawning adds timeout/signal-delivery complexity. (3) Use shared secret between main + renderer: Electron already enforces this via preload + contextIsolation; no additional secret scheme needed. (4) Allow arbitrary IPC expansion: opens door to security regressions; lock down prevents this.

