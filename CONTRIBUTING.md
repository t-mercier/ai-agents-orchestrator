# Contributing

Thanks for helping out! A few rules keep this app safe and maintainable.

## Ground rules

- **`main` stays buildable and green.** Before pushing: `npm test` and `npm run check:secrets` must pass, and `npm start` must launch.
- **Never commit secrets.** No API tokens, certificates, or `.env`. The scanner (`npm run check:secrets`) runs in CI; if it ever blocks a *non*-secret, tighten the pattern in `scripts/check-no-secrets.sh` rather than bypassing it.
- **Vanilla JS** in the renderer (no framework) unless an ADR says otherwise — see [docs/adr/ADR-001](docs/adr).
- Put **pure logic** in `renderer/lib/*` (UMD modules) with unit tests; keep DOM templates + event delegation in `ui.js`.

## Architecture decisions

Significant changes should reference or add an [ADR](docs/adr). The current target architecture and its trade-offs live there.

## Security review for IPC & native code

The IPC surface is intentionally small and every input is validated (sessionId regex, absolute-path checks, http(s)-only links). **Any PR that adds an IPC channel, touches `pty-manager`, or introduces a network call must:**

1. Validate all inputs at the handler boundary.
2. Preserve `contextIsolation: true` / `nodeIntegration: false`.
3. Describe the new attack surface in the PR description.
4. Add/extend tests (see `__tests__/pty-manager.test.js` for the lifecycle pattern).

Network code, in particular, must sit behind an explicit ADR (the core is zero-network by design — [ADR-001/008](docs/adr)).

## Tests

```bash
npm test                # data layer, pty lifecycle, formatters, markdown
```

Add tests next to the behavior you change. Pure functions in `renderer/lib/` and `data/` are the easy, high-value place to cover.
