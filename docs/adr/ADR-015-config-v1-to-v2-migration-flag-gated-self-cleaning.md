# ADR-015 — Config v1→v2 migration: a transient flag, migrate-on-launch, and a self-cleaning rollout

**Status:** Accepted

## Context

The config moved from the v1 schema (`~/.config/claude-session-monitor/config.json`,
flat `workRoot`/`personalRoot` + categories) to the v2 schema
(`~/.config/ai-agents-orchestrator/config.json`, named `roots`/`spaces`). We want to
**remove v1 entirely** — the old file, the app's migration code, and the read-only v1
tolerance in the Python skill readers (`aoconfig.py`, `rename.py`).

Two facts make a naïve "just delete v1" unsafe:

1. **The app is the sole migration writer**, and it migrates on launch. But it can't
   force a user to launch it — some machines may still hold a v1 config.
2. **The Python skill readers run independently of the app** — a launchd job
   (`morning-pr-reviews` at 08:25), or `claude --resume` in a terminal, can invoke
   `aoconfig.py` *before* the app has ever migrated that machine's config.

If `aoconfig.py` drops v1 support while a v1 config still exists, it resolves the wrong
roots/vault **silently** — the worst failure mode (a skill writes to the wrong place,
no error). See the read-only-shim discussion: keeping v1 read tolerance is a temporary
safety net, not a permanent dual-write bridge.

## Decision

A **transient `migratedToV2` flag** in the v2 config drives a **self-cleaning, staged
rollout**. The trigger is always **app launch** (works for `.dmg` and source installs
alike — not `git pull`). Migration is **idempotent** and always runs when a v1 config is
seen; the flag gates only the **destructive** steps.

**Release N (introduce)** — on launch:
- If a v1 config is present and not yet migrated → write the v2 equivalent (atomic),
  set `migratedToV2: true`, and **keep** the old v1 file renamed to `*.v1-backup`.
- Show a one-time in-app notice: "Config migrated to v2."
- `aoconfig.py` keeps its **read-only** v1 shim (never writes).

**Release N+1 (finalize + self-clean)** — on launch:
- If `migratedToV2: true` → **delete** the `*.v1-backup` **and delete the flag itself**,
  leaving a clean v2 config with no migration residue.
- Straggler (v1 present, no flag — skipped Release N) → migrate now, delete v1
  immediately; don't bother re-writing the flag (it's being retired).
- **Strip the v1 shim** from `aoconfig.py`/`rename.py`. From here they require v2 and
  **fail loud** ("open the app to migrate") if they ever see a non-v2 config — never a
  silent wrong resolution.

**Release N+2 (optional)** — remove the last straggler-migration code from the app once
telemetry/time confirms no v1 configs remain in the wild.

The load-bearing guarantee: the flag is a **transient artifact** — born during Release N's
migration, consumed and erased by Release N+1. The end state carries **no flag, no v1
file, no shim**.

## Consequences

- Migration is **forced and visible** at every user's first launch of Release N — the
  only way to stay on v1 is to never open the app, and such a machine is unaffected by
  the shim strip until it updates *and* launches (which migrates it).
- The dangerous case (v1-stripped reader + v1 config) is neutralized two ways: it's
  **delayed** past the migrate-on-launch window, and when the shim is finally removed the
  readers **fail loud** instead of resolving wrong silently.
- The config self-heals to a clean v2 with no migration cruft — no lingering
  `migratedToV2` field, no `configVersion` accretion.
- Cost during the window: a few lines of read-only v1 tolerance in Python and a renamed
  backup file — both removed by N+1.

## Alternatives rejected

- **Strip v1 from the Python readers immediately** (zero bridge, now): any skill that
  runs before the app migrates (launchd, `claude --resume`) resolves wrong roots/vault
  **silently**. The silent failure is the whole reason for the staged plan.
- **Permanent read-only v1 shim**: safe but never cleans up; v1 handling lingers in the
  codebase forever. The flag gives a definite end date.
- **Dual-write bridge (skills also write v1)**: turns a one-way migration into ongoing
  two-format maintenance and drift risk. The shim stays strictly read-only.
- **A monotonic `configVersion` integer instead of a boolean**: works, but accretes a
  version field the config carries forever. The transient boolean self-erases, which is
  cleaner for a one-time v1→v2 hop.
