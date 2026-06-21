# ADR-010 — Terminal lifecycle: cache xterm instances per sessionId, dispose on PTY death or app quit

> ⚠️ **Historical — pre-Tauri (Electron era).** Kept as a decision record. The app has since migrated to Tauri; see [ARCHITECTURE.md](./ARCHITECTURE.md) for the current design.


**Status:** APPROVED

## Context

Current code rapidly creates/disposes xterm on tab switches (openTerminalPane/closeTerminalPane). This wastes resources (ResizeObserver + event listeners recreated per switch) + introduces race conditions (racy ResizeObserver cleanup, xterm.dispose() called twice causing errors). Caching + reuse is correct for UX (instant restore when switching back to same session) but requires explicit lifecycle tracking: on app quit, must dispose ALL cached instances (call xterm.dispose() + unregister ResizeObserver for each).

## Decision

Cache Terminal instances in terminals Map<sessionId, xterm.Terminal>. Reuse instance when switching tabs (do NOT dispose on tab switch). Dispose ONLY on: (1) PTY process dies (proc.onExit callback), (2) app quits (app.on('before-quit')). ResizeObserver attached once per instance, cleaned on dispose.

## Consequences

Modify terminal.js: (1) ensureTerminal(sessionId) returns cached xterm if exists, else create new + store in terminals Map. (2) closeTerminalPane(sessionId) removes DOM element + unregisters event listeners, but does NOT dispose xterm (instance stays in cache). (3) On PTY death (proc.onExit handler), auto-dispose corresponding xterm: unregister ResizeObserver + call term.dispose(). (4) On app quit (app.on('before-quit')), loop terminals Map + dispose all (loop: term.dispose(), unregister ResizeObserver). Cost: ~30 lines modification (terminal.js + app.js). Benefit: no rapid create/dispose cycles, ResizeObserver + listeners attached once per session (perf), cleaner lifecycle semantics (xterm dies when PTY dies, not when user switches tabs). Trade-off: minor (slight memory increase per cached terminal, offset by not recreating DOM + listeners on every switch).


## Alternatives rejected

(1) Dispose on every tab switch: wastes resources, no benefit (xterm re-init is <10ms). (2) Never dispose (memory leak): xterm instances accumulate indefinitely, listeners fire for dead PTYs, resource exhaustion at quit time. (3) Singleton terminal registry: global state, harder to test, same lifecycle issues.

