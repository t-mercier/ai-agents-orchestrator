# ADR-001 — Vanilla JS + Electron 35 macOS read-only ~/.claude projection (no network, no config writes)

**Status:** APPROVED

## Context

Project is local-first, single-user, single-process. Current main.js (200 lines) + preload.js (16 lines) establish clean Electron security boundary. Proposals to add config-manager.js + Settings renderer + node-keychain + MCP test spawning = 400+ lines of untested complexity. These features assume app should evolve into a CONFIGURATOR (manage secrets, edit MCP config). But Claude Code already owns that responsibility. App adding writes-back to ~/.claude.json risks breaking Claude's config if bugs occur.

## Decision

Maintain Vanilla JS (no React/Vue), Electron 35 stable API with contextIsolation:true + nodeIntegration:false. App is a VIEWER + PTY TERMINAL only; it reads ~/.claude files but NEVER writes them. All session data sourced from files written by Claude Code (/start, /close, /archive skills). Zero network calls, zero MCP client logic, zero secret storage. Reject proposals to add Keychain, settings UI, MCP editor, OAuth flows—these are configurator features out of scope for v1.0.

## Consequences

Eliminates ~200 proposed lines of deferred code. Keeps main.js < 200 lines, preload.js 16 lines (8 IPC channels fixed), renderer < 700 lines total. Defers onboarding (first-run wizard) + settings drawer (MCP/Skills/Secrets tabs) to v1.1. v1.0 includes static welcome.html (one-page, 50 lines) with README link. Trade-off: users cannot edit MCP config in UI (must use $EDITOR ~/.claude.json); acceptable for v1.0 because (1) most users configure Claude Code once at setup, (2) manual edit is clear alternative (respects user autonomy), (3) defers v1.1 feature to post-launch feedback cycle.


## Alternatives rejected

(1) Add Keychain + Settings UI in v1.0: delays release 3-4 weeks, adds node-keychain native rebuild overhead, requires Accessibility entitlements, introduces Keychain↔~/.claude.json sync bugs (which is source-of-truth?), creates support burden. (2) Make app a full CONFIGURATOR: violates single responsibility (viewer XOR editor), risks breaking Claude Code's config if write-back is buggy, adds MCP test spawning + connection retry logic (not justified for MVP). (3) Add OAuth for GitHub/Slack: users can paste tokens manually (3-step flow: generate token in browser → copy → paste in app → save to ~/.claude.json); not ideal UX but acceptable for v1.0.

