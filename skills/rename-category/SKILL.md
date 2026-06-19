---
name: rename-category
description: >-
  Safely rename a session category EVERYWHERE — moves its folder, re-tags every
  notes.md frontmatter, updates active-sessions.json, and renames it in the shared
  config. The dashboard app is read-only and only changes the config (which orphans
  old sessions); this skill is the writer that actually migrates references.
  Trigger on "/rename-category <OLD> <NEW>", "rename category <X> to <Y>",
  "renomme la catégorie <X> en <Y>".
allowed-tools: Bash Read
argument-hint: "<OLD-NAME> <NEW-NAME>"
---

# /rename-category &lt;OLD&gt; &lt;NEW&gt; — rename a category everywhere

Renames a category across **all** its references so nothing is orphaned:
the shared config, the category folder, every session's `notes.md` frontmatter,
and `~/.claude/active-sessions.json`.

> Why a skill (not the app): the dashboard is read-only on `~/.claude` — renaming
> there only edits the config, which makes old sessions vanish. This skill writes,
> so it migrates the actual files + references.

Config it reads/writes: `~/.config/agents-orchestrator/config.json`.

Usage: `/rename-category FEAT FEATURE`

---

## Step 0 — Parse arguments

`OLD` and `NEW` = the two arguments (trim whitespace). If either is missing, run
the lister and ask the user which to rename and to what:

```bash
python3 ~/.claude/skills/rename-category/rename.py
```

## Step 1 — Dry-run plan (no writes)

Show exactly what will change. This validates (OLD exists, NEW is free + valid) and
prints the folder move, the count of notes to re-tag, active-sessions entries, and
any **running** sessions in that category:

```bash
python3 ~/.claude/skills/rename-category/rename.py --plan "<OLD>" "<NEW>"
```

If the script prints an `ERROR:` line, relay it and stop.

## Step 2 — Confirm with the user

Show the plan. **If there are RUNNING sessions in this category**, warn the user:
renaming moves the folder out from under a live `claude` process (its `cwd` goes
stale) — recommend closing/ending those sessions first. Ask the user to confirm
before proceeding. Do not apply without confirmation.

## Step 3 — Apply the migration

```bash
python3 ~/.claude/skills/rename-category/rename.py --apply "<OLD>" "<NEW>"
```

The script: moves `<base>/<OLD>` → `<base>/<NEW>`, rewrites the `category:` line in
each moved `notes.md`, updates matching `active-sessions.json` entries (category +
`notes_path`), and renames the category in the config (keeping its color & scope).
All JSON writes are atomic.

## Step 4 — Report

Relay the script's summary (folder moved, N notes re-tagged, M entries updated,
config renamed). Remind the user the dashboard refreshes on its next 5-second poll.
Nothing is deleted — only moved/renamed.
