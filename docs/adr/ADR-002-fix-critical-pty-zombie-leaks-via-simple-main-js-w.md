# ADR-002 — Fix critical PTY zombie leaks via simple main.js window-close handler (not SessionLifecycleManager abstraction)

**Status:** APPROVED

## Context

CRITICAL BUG: detached window close (main.js:173) calls win.on('closed', ...) but only deletes from detachedWindows Map, never kills PTY. Result: shell process remains running with orphaned onData callback still broadcasting stale data to all windows. Over rapid detach/close cycles (user opens session, detaches, closes window, repeats), 10+ zombie shells accumulate. Zombie cleanup is left to garbage collection (happens eventually, but uncontrolled).

## Decision

Add 8-line fix to main.js detached window: on window close, extract sessionId from window context, call ptyManager.kill(sessionId) before cleanup. Add 5-line onExit handler to proc in pty-manager.spawn() to auto-unregister onData listener. Reject SessionLifecycleManager (300+ lines) as premature abstraction for single-user app. Eliminate all zombie processes; make listener lifecycle explicit and testable.

## Consequences

Phase 1 (PTY lifecycle hardening): (1) main.js detached-session handler now stores windowId→sessionId mapping when window created. (2) win.on('closed') extracts sessionId, calls ptyManager.kill(sessionId). (3) pty-manager.spawn() attaches proc.onExit((code, signal) => { procs.delete(sessionId); markSessionAsDead(sessionId); }) to ensure cleanup on process death, not just on explicit kill(). (4) Add regression test: spawn pty → detach window → close → verify process dead (process.kill(pid, 0) throws). Total: 8 new lines main.js, 5 new lines pty-manager.js, 8-line test. Benefit: zero zombie processes, listener cleanup guaranteed, no state-machine overhead. Trade-off: none (fix is strictly better than status quo).


## Alternatives rejected

(1) SessionLifecycleManager (300 lines) with state machine (idle→pending→running→exiting→dead), per-proc onExit tracking, registerListener/unregisterListener bookkeeping, orphan detection audit(): way over-engineered. Cost-benefit poor (8 lines of actual fix hidden in 300 lines of abstraction). Introduces new failure modes (stale windowId→sessionId affinity map if window crashes without cleanup handler). (2) fs.watch() for cache invalidation: not a solution (unrelated to PTY cleanup); macOS fs.watch is fragile anyway. (3) Do nothing: status quo is breaking (users observe 'session closed' in UI but PTY still consuming CPU/memory); unacceptable for production.

