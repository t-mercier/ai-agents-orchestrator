# ADR-003 — Renderer architecture: 2-3 files (app.js, ui.js, delegated-events.js) with extracted pure-function modules (not 7-module split)

> ⚠️ **Historical — pre-Tauri (Electron era).** Kept as a decision record. The app has since migrated to Tauri; see [ARCHITECTURE.md](./ARCHITECTURE.md) for the current design.


**Status:** APPROVED

## Context

ui.js is 469 lines: sorting, grouping, formatting (time/HTML/truncate), markdown parsing (3 functions), done-detection (20 lines), templating (6 render functions), session key logic, delegated event handling. Proposals to split into 7 modules promise 'independent testing' + 'clear boundaries'. Reality: (1) rendering templates ARE tightly coupled to event delegation (both change when view changes), (2) splitting creates circular import graph (session-view imports app-state imports formatters), (3) current monolith is readable via grep + line-range tracing; refactored 7-module code has MORE indirection (harder to follow data flow), (4) no current pain point (no perf bottleneck, no failing tests in production). Industry best practice: refactor when you HIT a problem, not when you IMAGINE one.

## Decision

Extract pure logic functions into renderer/lib/ (formatters.js: 40 lines for truncate/escapeHtml/statusLabel/sessionTime; query.js: 80 lines for rebuildSortRank/groupByCategory/filterBySearch; markdown.js: 50 lines for renderMarkdown/doneDetection). Keep rendering templates + event delegation IN ui.js (~400 lines). Add 30-40 unit tests on library modules. Reject proposal to split into 7 separate modules (ui-core, session-view, detail-view, app-state, event-router) as YAGNI + fragmentation.

## Consequences

Create renderer/lib/ directory with: formatters.js (truncate, escapeHtml, statusLabel, sessionTime: pure functions), query.js (rebuildSortRank, groupByCategory, filterBySearch), markdown.js (renderMarkdown, doneDetection). Add ~30 unit tests with jsdom + mocked localStorage. ui.js shrinks by ~100 lines (move pure functions to imports), but rendering + event delegation stay (~400 lines). app.js unchanged (~180 lines). Cost: 2-hour refactor. Benefit: pure logic is independently testable without DOM, can verify escapeHtml covers all XSS cases, can test markdown regex edge cases, UI rendering logic stays in one place (easier to debug). Trade-off: minimal (zero functional change, just better test coverage).


## Alternatives rejected

(1) Full 7-module refactor (ui-core, session-view, detail-view, app-state, event-router, delegated-events, plus app.js + ui.js): 8+ hours refactor cost, circular deps, harder trace of render flow, testing requires mocking 6 modules per test. (2) No modularization: keep pure functions inline in ui.js; no unit tests; bugs in escapeHtml not caught until production (XSS vulnerability). (3) TypeScript + strict module boundaries: overkill for Vanilla JS project, requires build tooling, defers to v1.1 (not core blocker).

