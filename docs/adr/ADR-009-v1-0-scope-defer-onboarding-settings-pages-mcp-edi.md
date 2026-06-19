# ADR-009 — v1.0 scope: defer onboarding, settings pages, MCP editor to v1.1; ship session viewer + terminal

**Status:** APPROVED

## Context

Multiple proposals attempt to add onboarding wizard, settings modal, MCP configurator features. Together: 600+ lines of untested code + dependencies (node-keychain, MCP subprocess spawning, OAuth flows). These features require significant unknowns (MCP connection reliability, Keychain permission UX, GitHub OAuth edge cases). Separating v1.0 (core) from v1.1 (config management) allows honest scope + faster shipping. Ship core v1.0 with high confidence, iterate v1.1 based on user feedback.

## Decision

v1.0 ships: session viewer + PTY terminal + static welcome page. Defer: onboarding wizard (5-step setup), settings modal (MCP/Skills/Secrets tabs), MCP server editor, GitHub/Slack token management, Keychain integration to v1.1 (post-launch iteration cycle). v1.0 includes static welcome.html (one-time, skippable) with links to README + FAQ.

## Consequences

Remove proposals for: (1) renderer/onboarding.html + onboarding.js (modal wizard with 5 steps), (2) renderer/settings.html + settings.js (tabbed MCP/Skills/Secrets UI), (3) data/config-manager.js (config read/write logic), (4) 12 new IPC handlers (config CRUD, MCP test, Keychain access). Instead: add renderer/welcome.html (~50 lines, static HTML, no interaction, shown once on app.ready via localStorage flag). Welcome page explains app purpose + links to README/FAQ/GitHub. Users click 'Got it' to dismiss, never shown again. v1.0 ships in 2 weeks (core only), community tests + validates features, v1.1 (4 weeks post-launch) can iterate on configurator based on feedback. Cost: 50 lines HTML. Benefit: v1.0 launches with high code confidence (300 fewer LOC = fewer bugs), community can test core immediately, v1.1 road map informed by real user needs.


## Alternatives rejected

(1) Ship full configurator in v1.0: delays 4+ weeks, unknown unknowns (MCP reliability, Keychain permissions, OAuth bugs), risks missing core v1.0 timeline. (2) Ship no onboarding: fine, but add help link in UI. (3) Ship partial onboarding (GitHub only): half-measures confuse users (GitHub configured, but 'where is Slack?').

