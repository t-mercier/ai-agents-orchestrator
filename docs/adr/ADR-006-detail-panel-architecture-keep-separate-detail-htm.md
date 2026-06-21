# ADR-006 — Detail panel architecture: keep separate detail.html, extract shared rendering to renderer/lib/detail-lib.js

> ⚠️ **Historical — pre-Tauri (Electron era).** Kept as a decision record. The app has since migrated to Tauri; see [ARCHITECTURE.md](./ARCHITECTURE.md) for the current design.


**Status:** APPROVED

## Context

Proposal to consolidate detail.html into index.html#detail-mode?key=X via iframe claims 'eliminates ~200 lines of duplication'. Reality: (1) iframe sandbox requires cross-origin postMessage bridge (30+ lines of IPC logic), (2) iframe shares preload.js scope (all window.api channels available to iframe, breaks window-specific access control), (3) if one window crashes, entire iframe pool crashes (no isolation), (4) separate detail.html is architectural strength (failure in detail window doesn't crash main), not technical debt.

## Decision

Keep detail.html as separate file (preserves always-on-top isolation for detached windows). Extract detail-rendering logic (renderDetailPanel, sessionKey derivation, goal/status parsing) into renderer/lib/detail-lib.js (~50 lines of pure functions). Both app.js (line 421) and detail-window.js (line 26) import + call these functions. Reject iframe sandbox consolidation approach as introducing postMessage bridging complexity + breaking architectural isolation.

## Consequences

Extract renderer/lib/detail-lib.js with pure functions: renderDetailPanel(session, tab, actions), sessionKey(session), renderSessionHeader(session), renderActivityLog(session), renderGoal(session), renderActions(session). Both app.js + detail-window.js require() and call these. Eliminates copy-paste (sessionKey derivation exists in both places with slight differences; bugs fixed in one missed in other). Cost: 1-hour refactor. Benefit: single source of truth for detail rendering, no iframe sandbox overhead, maintains architectural isolation (detached window still separate BrowserWindow, failure-isolated from main).


## Alternatives rejected

(1) iframe consolidation: postMessage bridge adds 30+ lines, breaks window-specific security model (all IPC available to iframe), detail window crash ripples to main window. (2) Do nothing (keep duplication): violates DRY, bugs in one view missed in the other. (3) Move all rendering to main process (send HTML via IPC): requires rendering in main thread (no DOM), defeats purpose of Electron windows (which provide DOM/layout engine).

