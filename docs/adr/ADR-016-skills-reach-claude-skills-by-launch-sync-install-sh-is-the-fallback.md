# ADR-016 — Skills reach `~/.claude/skills` at launch; `install.sh` is the contributor's fallback

**Status:** Accepted — 2026-09-23

## Context

The session skills only work from `~/.claude/skills/`: Claude Code never reads them from
inside the app bundle. So something has to copy them there, and then keep them current.

For a long time that something was `scripts/install.sh`, and the README said so — a
numbered step in the quickstart, a block of flags, and a reminder to re-run it after every
`git pull`. Meanwhile the app grew its own installer (`src-tauri/src/skills.rs`) which now
does the same four jobs on every launch: copy the 14 skills, copy the hook scripts, seed
`config.json` if none exists, and create the category folders. The two paths had converged
without the documentation following, which left readers running a script the app had
already made unnecessary — and wondering what they had broken when its output said
`skip (exists)`.

One thing the app genuinely could not do, and it is what kept the script in the
quickstart: notice that a `git pull` had moved the repo's `skills/` past the copies in
`~/.claude/skills`. The check needs a path to a clone, and only the script knew one,
because only the script runs *from* a clone. On the one install we could inspect — a daily
driver built from a clone for months — the manifest read `{"bundle_epoch": …}` with no
`repo` key, so the notice had never had anything to watch and could never have fired.

## Decision

**The app is the installer. `install.sh` is for contributors and for repair.**

Nothing in the normal path asks anyone to run it, and the README no longer documents its
flags; this ADR does.

**The build records its own checkout.** `build.rs` bakes the tree the binary was compiled
from into `AO_SKILLS_CHECKOUT`, and `skills::installed_from_checkout` uses it when the
manifest names no clone. A build from a clone can therefore watch that clone with nothing
set up, which is what makes the update notice reach the person it was written for.

**Precedence, and why.** The `repo` key in `~/.claude/skills/.ao-install-manifest.json`
wins over the baked path: running `install.sh` somewhere is an explicit statement about
which clone is meant, and a build default must not override a stated intent. A `repo` that
no longer resolves falls through to the baked path rather than suppressing it — a moved
clone is not a decision.

**Both paths pass the same two gates** before the app will look at, or execute anything
in, a checkout: `canonicalize()` must succeed, and `scripts/install.sh` must be there. A
release `.dmg` carries its CI build path (`/Users/runner/work/…`), which exists on nobody's
machine and so reads as "no checkout" — the app stays quiet instead of offering an update
it cannot perform.

## How the pieces fit

| Moment | What runs | What it does |
|---|---|---|
| Every app launch | `skills::install_skills` | Copies the 14 skills and the 6 hook scripts, seeds `config.json`, creates the category folders, stamps `bundle_epoch`. |
| Launch + window focus | `skills::checkout_update` | Asks git whether the checkout's `skills/`+`hooks/` are newer than the stamp. A notice with an **Update** button when they are. |
| The Update button | `skills::update_from_checkout` | Runs that checkout's `scripts/install.sh --all`. The path comes from the manifest or the build, never from the renderer. |
| By hand, from a clone | `scripts/install.sh` | The same work, plus the one thing the app cannot do: install *this working tree's* skills without recompiling. |

The stamp is `bundle_epoch` — the unix time of the last commit touching `skills/` or
`hooks/`, not `HEAD`, so an unrelated renderer commit does not make a bundle look newer
than it is. `build.rs` bakes it, `install.sh` writes it, and both installers compare
against it, which is how an app built *before* your last `install.sh --force` stands down
instead of reverting you.

`install.sh` writes the date only when nothing was withheld: a plain run that skipped a
changed skill leaves no stamp, and "clone known, no date" is read as behind. The checkout
*path* is written every time, stale or not.

## `scripts/install.sh` — the flags

```bash
bash scripts/install.sh              # install; a skill you already have is KEPT
bash scripts/install.sh --force      # replace this app's skills with this checkout's
bash scripts/install.sh --with-hooks # also print the settings.json lines that ENABLE the hooks
bash scripts/install.sh --all        # everything: --force + --with-hooks
```

`--force` is not the default because a plain run *names* the skills whose updates it
withheld, and you decide. The hook scripts are copied by every run, flag or not;
`--with-hooks` only decides whether the `settings.json` lines that switch them on are
printed. `npm run install:skills` does not force.

Only the 14 skills this app ships are ever in scope, by name. Everything else in
`~/.claude/skills/` is invisible to both installers: not scanned, not compared, not
touched. The single case that *is* replaced is a skill of your own sharing one of those 14
names — pick another.

## Consequences

- A reader following the README never meets the script. The four jobs happen at launch,
  and the one case it existed for — a skills-only pull — is now a notice with a button.
- A contributor editing `skills/` still needs it: `cargo tauri dev` re-embeds on rebuild
  (`rerun-if-changed=../skills`), but `install.sh --force` gets the working tree into
  `~/.claude/skills` without one.
- The baked path is compile-time data, at the same trust level as the embedded skills
  themselves. It is never read from the renderer, and the two gates above bound what the
  app will execute.
- A `.dmg` install has no clone and gets no notice. Its skills advance with the app, which
  is the whole point of embedding them.

## Alternatives rejected

**A "Check for updates" button.** It would need the checkout path just the same, and once
the path is baked, the launch + focus check already *is* the headless check — it fires by
itself when the window comes back after a pull. A second affordance for the same event.

**Deriving the checkout from the running executable.** Works under `cargo tauri dev`
(`<repo>/src-tauri/target/debug/app`) and tells you nothing once the bundle is copied to
`/Applications`, which is how the app is actually run. Compile time is the moment the
checkout is known for certain.

**Keeping `install.sh` in the quickstart.** It is one more step that can fail, in a
quickstart that already asks for Rust, the Tauri CLI and a WebView toolchain — and it made
the app's own installer look optional when it is the one doing the work.
