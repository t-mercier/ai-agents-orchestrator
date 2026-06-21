# ADR-011 — Incremental migration plan: 4 phases (PTY cleanup, tests, refactor, packaging) with buildable + green-test gates

> ⚠️ **Historical — pre-Tauri (Electron era).** Kept as a decision record. The app has since migrated to Tauri; see [ARCHITECTURE.md](./ARCHITECTURE.md) for the current design.


**Status:** APPROVED

## Context

Risk-ordering: correctness (no zombies) >> maintainability (tests + modularization) >> distribution (signing). Shipping v1.0 with zombie PTYs is unacceptable (users observe dead shells). Shipping without tests is acceptable (test suite can grow post-launch). Shipping unsigned is acceptable (v1.0 users expect unsigned, v1.1 benefit from auto-update). Phases ordered to maximize feedback: fix bugs first → solidify via tests → refactor for clarity → package for distribution.

## Decision

Phase 1 (Week 1): PTY lifecycle hardening (main.js fix + onExit handler) + regression tests (8 tests on zombie cleanup). Phase 2 (Week 2): test coverage expansion (renderer tests on formatters/query/markdown, terminal lifecycle tests). Phase 3 (Week 3): renderer refactoring (extract pure-function libs). Phase 4 (Week 4): electron-builder + GitHub Actions CI + signing. Each phase commits buildable code + green tests before next phase starts. v1.0 ships after Phase 4.

## Consequences

**Phase 1 (Week 1): PTY Lifecycle Hardening** — main.js lines 149-173 (detached-session handler): store windowId→sessionId mapping. win.on('closed'): extract sessionId, call ptyManager.kill(sessionId) before cleanup. pty-manager.js spawn(): attach proc.onExit((code, signal) => { procs.delete(sessionId); }). Add 8 regression tests (test/pty-lifecycle.test.js): (1) spawn pty, verify proc in procs map, (2) kill pty, verify process.kill called + proc removed, (3) spawn pty, detach window, close window, verify process dead (process.kill(pid, 0) throws), (4) kill pty twice (second should error gracefully), (5) onExit fires on proc exit, (6-8) rapid spawn/kill cycles (no orphans). Cost: 8 lines code, 50 lines tests. Deliverable: fixed bug, no zombies, git commit. **Phase 2 (Week 2): Test Coverage** — Add renderer tests (test/renderer/): (1) formatters.test.js (truncate, escapeHtml, statusLabel, sessionTime), (2) query.test.js (rebuildSortRank, groupByCategory, filterBySearch), (3) markdown.test.js (renderMarkdown edge cases, doneDetection regex). Add terminal-lifecycle tests (test/terminal-lifecycle.test.js): (1) ensureTerminal caches instance, (2) reuse on tab switch, (3) dispose on PTY death, (4) dispose all on app quit. Cost: ~50 test lines. Deliverable: 40+ tests (all green), git commit. **Phase 3 (Week 3): Renderer Refactoring** — Create renderer/lib/ directory. Extract formatters.js, query.js, markdown.js. Update app.js + ui.js to require() from lib. Verify existing tests still pass (no regressions). Cost: 1-2 hours refactor. Deliverable: same functionality, tests green, git commit. **Phase 4 (Week 4): electron-builder + Signing** — Add electron-builder.config.js, .github/workflows/release.yml. Set up GitHub Secrets (APPLE_ID, etc.). Test build locally: npm run dist (creates unsigned .app for testing). Commit CI/CD config. On git tag vX.Y.Z, GitHub Actions builds, signs, notarizes, publishes .dmg. Cost: 3-4 hours setup. Deliverable: signed .dmg on GitHub Releases, v1.0 ready for download. Result: v1.0 ships in Week 4 with solid foundations (no zombies, 40+ tests covering critical paths, clean renderer, production-ready signing).


## Alternatives rejected

(1) Monolithic refactor (all 4 phases in parallel): risk high (PTY bugs + signing + renderer split = hard to debug), feedback delayed, blame diffusion (which phase broke tests?). (2) Defer Phase 1 to v1.1: ships broken app (zombies), bad user experience, support burden. (3) Skip testing (Phase 2): acceptable in isolation but regressions compound in v1.1; early test investment pays dividends. (4) Defer signing (Phase 4): ships unsigned, v1.0 users annoyed by Gatekeeper, market perception hurt.

