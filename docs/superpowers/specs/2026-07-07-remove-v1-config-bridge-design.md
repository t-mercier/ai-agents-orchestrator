# Remove the v1→v2 config bridge — design

**Date:** 2026-07-07
**Status:** Design — awaiting review
**Related:** [ADR-015](../../adr/ADR-015-config-v1-to-v2-migration-flag-gated-self-cleaning.md) (migration mechanics)

## Goal

Retire the v1 config schema (`workRoot`/`personalRoot` + a category `scope` of
work|personal, and the `obsidian.workVaultPath`/`personalVaultPath`/`vaultPath` split).
Keep only v2: a named `roots` list where each category names its `root`, and where the
**Obsidian vault lives on the root**. No permanent bridge — v1 handling is removed from
the app in this release, and from the Python skill readers one release later
(ADR-015's staged, self-cleaning rollout).

This spec is **Release N** of ADR-015. It does *not* strip the Python v1 shim or delete
the backup — those are Release N+1.

## Non-goals

- No config **path** change. v1 and v2 share `~/.config/ai-agents-orchestrator/config.json`;
  migration reads and writes that one path (ADR-015 Context). The old
  `claude-session-monitor` path was pre-public and is out of scope.
- No new root/category *features* — this is a schema retirement, not a capability add.
- Not Release N+1 (Python shim strip, backup/flag deletion, fail-loud) — a follow-up ticket.

## Target v2 schema

```jsonc
{
  "version": 2,
  "roots": [
    { "name": "Work",  "path": "~/work", "vaultPath": "~/TomTom/…" },
    { "name": "Perso", "path": "~",      "vaultPath": "~/Documents/Obsidian Vault" }
  ],
  "categories": [
    { "name": "FEAT", "color": "#7df0c0", "root": "Work" }
    // NO `scope`
  ],
  "obsidian": { "enabled": true },   // global on/off toggle ONLY
  "ticketBaseUrl": "",
  "terminalApp": ""
}
```

Removed entirely: `workRoot`, `personalRoot`, category `scope`,
`obsidian.workVaultPath` / `obsidian.personalVaultPath` / `obsidian.vaultPath`.

A category's vault = **its root's `vaultPath`** (empty/absent → that category has no
vault). `vaultPath` is optional per root. `roots[]` is the single source of truth for
both the scan/launch path and the vault.

## Migration (app = sole writer) — ADR-015 Release N

New `config::migrate_v1_if_needed()`, invoked **once at app startup in `setup()`**,
before the scan-root diagnostic. It reads the raw config file directly (not via `load()`),
so `load()` stays a pure mtime-cached read with no write side-effect.

**Trigger — by shape, not by `version`.** Migrate iff the config is not already flagged
`migratedToV2` **and** any legacy field is present:
- top-level `workRoot` or `personalRoot`, or
- any category with a `scope` and no `root`, or
- `obsidian.workVaultPath` / `personalVaultPath` / `vaultPath`.

(Shape-based because today's `settings.js` writes `roots` *and* the legacy fields
together and stamps `version: 1` — so neither "has roots" nor `version` is a reliable
signal.)

**On migrate:**
1. Rename the existing `config.json` → `config.json.v1-backup` (non-destructive).
2. Build the v2 config and write it atomically (existing `save()`: validate + fsync +
   rename):
   - **Roots:** existing `roots` if present, else `workRoot`→`Work`, `personalRoot`→`Perso`.
   - **Vaults:** `workVaultPath` (or legacy `vaultPath`) → `Work.vaultPath`;
     `personalVaultPath` → `Perso.vaultPath`. (Clean because at migration time the roots
     *are* Work/Perso.)
   - **Categories:** each category's `scope` → `root` (personal→Perso, else Work) when
     `root` absent; drop `scope`.
   - **Flag:** add transient `migratedToV2: true`.
3. Emit a one-time in-app notice ("Config migrated to v2.") — a Tauri event from `setup()`
   that the renderer shows as a toast.

**Idempotent:** a clean v2 file (flagged, no legacy fields) → no rewrite. The
`migratedToV2` flag is transient: introduced here, consumed and erased in Release N+1.

## `derive()` / `validate()` — pure v2

- **`derive()`** ([config.rs:91](../../../src-tauri/src/config.rs#L91)): read `roots` only.
  Drop the `work_root`/`personal_root` locals, the `scope`→`root` migration, and the
  legacy `workRoot`/`personalRoot` output fields. Keep the unknown-root → `roots[0]`
  safety net (and keep [aoconfig.py](../../../skills/lib/aoconfig.py) matching it). Emit
  per-root `vaultPath` in `roots_out`. Obsidian output = `{ enabled }` only.
- **`validate()`** ([config.rs:188](../../../src-tauri/src/config.rs#L188)): every category
  **must** carry a valid `root` that references a declared root; delete the `scope`
  branch. Unknown top-level fields (incl. the transient `migratedToV2`) are ignored.
- **Tests:** convert the v1-migration `derive()` tests into `migrate_v1_if_needed()`
  tests (v1-on-disk → v2-on-disk, backup created, flag set, idempotent on re-run); keep
  the pure-v2 `derive`/`validate` tests.

## Consumer edits

| File | Change |
|---|---|
| [config.rs](../../../src-tauri/src/config.rs) `derive`/`validate`/`default_config` | pure v2 (above); `default_config` seeds per-root `vaultPath`, drops the obsidian work/personal keys |
| [lib.rs:387-405](../../../src-tauri/src/lib.rs#L387-L405) `category_root_dir` | drop the v1 `scope`→workRoot/personalRoot fallback; resolve via `roots` then home |
| [lib.rs:615-634](../../../src-tauri/src/lib.rs#L615-L634) `configured_roots` | drop the `["workRoot","personalRoot"]` loop |
| [lib.rs:985-998](../../../src-tauri/src/lib.rs#L985-L998) startup diagnostic | iterate `roots[].path`, not the two legacy keys |
| [lib.rs](../../../src-tauri/src/lib.rs) tests (~1135) | update fixtures to v2 |
| [reader.rs:1047](../../../src-tauri/src/reader.rs#L1047) | re-express the "scope root" comment/logic via `root` |
| [app.js:13-22](../../../renderer/app.js#L13-L22) `configRoots` | drop the workRoot/personalRoot branch |
| [settings.js](../../../renderer/settings.js) | **vault input per space row** (replace the two work/personal vault fields); `collect()` drops `scope`, `workRoot`/`personalRoot`, `version:1`; folder-picker + rename mapping key off `roots` only |
| [index.html:367](../../../renderer/index.html#L367) | hint text: "under one of your spaces"; drop "work/personal root" and "scope" |
| [aoconfig.py](../../../skills/lib/aoconfig.py) | `vault_for` → the category's root `vaultPath`; **keep** the `roots_list`/`base_for_entry` read-only v1 shim with a "remove in ADR-015 N+1" note; `scope` subcommand derives from root name (or `''`) |
| [rename.py:60-119](../../../skills/rename-category/rename.py) | resolve base via `roots`, not `scope`→workRoot |
| [install.sh:57](../../../scripts/install.sh#L57) | seed matches `default_config()` (per-root `vaultPath`, no obsidian work/personal keys) |
| SKILL.md docs (close-session, rename-category, distil, etc.) | reword "scope"/"vault for scope" → "root"/"root's vault" |

## Sequencing & risk

- **This PR = ADR-015 Release N** — one PR so schema, migration, and every Rust/renderer
  reader move together. A split would let a legacy field reach a reader that no longer
  understands it.
- **Python shim kept this release.** It is the deliberate exception in ADR-015: an
  unattended skill (launchd `morning-pr-reviews` at 08:25, terminal `claude --resume`)
  can read a config the app has not migrated yet, so `aoconfig.py`/`rename.py` retain
  read-only v1 tolerance until N+1.
- **Follow-up ticket = Release N+1:** on `migratedToV2` → delete `.v1-backup` + the flag;
  straggler configs migrate-then-delete; strip the Python v1 shim so the readers require
  v2 and **fail loud** ("open the app to migrate") instead of resolving wrong silently.
  Must be a *separate* release — combining them removes the safety window and re-opens
  the silent-wrong-resolution risk ADR-015 exists to prevent.
- **Release N+2 (optional):** drop straggler-migration code once no v1 configs remain.

## Testing

- Rust unit tests: `migrate_v1_if_needed()` (v1→v2 on disk, backup, flag, idempotent);
  `derive`/`validate` pure-v2 (reject scope-only category, require valid root, per-root
  vault in output); `default_config` validates + derives cleanly.
- Manual: launch with a hand-written v1 `config.json` → verify backup created, v2 written,
  toast shown, sessions + vault resolve; relaunch → no re-migration.
- Skills: with a *not-yet-migrated* v1 config, `aoconfig.py vault/base/find` still resolve
  (shim); with a v2 config they resolve via roots.
