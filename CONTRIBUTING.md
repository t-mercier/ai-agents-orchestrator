# Contributing

Thanks for your interest! 🙏

## How to help right now

**Issues and suggestions are very welcome** — bug reports, feature ideas, papercuts, "this felt off" notes. They genuinely shape the roadmap.

- 🐛 **Bugs:** what you did, what happened, what you expected. macOS version + a screenshot help a lot.
- 💡 **Ideas / UX feedback:** open an issue and describe the problem you're hitting — not just a proposed solution.

## About code contributions

This is an opinionated, design-led project that I maintain **solo**, and for now I'm **not accepting outside code (pull requests)**. Two reasons:

1. The UX/UI is intentionally coherent and I want to keep it that way.
2. Keeping the codebase 100% mine keeps the licensing clean.

So please **open an issue before writing any code** — if an idea's a good fit I'd rather we discuss it there. If the project grows real traction I may open up code contributions later (under a DCO sign-off); this file will say so when that happens.

## License

The project is under the [PolyForm Noncommercial 1.0.0](LICENSE) licence — free for non-commercial use; commercial use needs a separate licence. By opening an issue you're just sharing feedback; nothing here asks you to assign rights.

## If you're poking around the code

A few notes so the project stays coherent:

- **Stack:** [Tauri v2](https://tauri.app) (Rust backend + system WebView) with a **vanilla-JS** renderer — no framework. Pure logic lives in `renderer/lib/*` (UMD modules, unit-tested); DOM templates + event delegation live in `ui.js`.
- **Run it:** `cargo tauri dev`. **Tests:** `npm test` (Jest, renderer logic) and `cargo test` (in `src-tauri/`, Rust).
- **Read-only by design.** The app never writes to `~/.claude` except two explicit, sandboxed actions (archive, PR link). The Rust command surface is small and every input is allowlist-validated (absolute paths, safe branches, `github.com/owner/repo/pull/N`), commands are spawned argv-only (no shell strings), and the core is **zero-network**.
- **Architecture decisions** live in [`docs/adr`](docs/adr). Anything that adds a Tauri command, touches the PTY layer, or introduces a network call would need an ADR + a security rationale.

These keep the bar clear in case the project opens to code contributions down the line.
