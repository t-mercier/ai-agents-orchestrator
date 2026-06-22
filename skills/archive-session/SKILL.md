---
name: archive-session
description: >-
  Archive a stale session without loading its context — stamps its notes.md as
  "archived" in the Session history and removes it from active-sessions.json.
  The note file is kept on disk. Use for sessions that are done or abandoned.
  Trigger on "/archive-session <slug>", "archive session <slug>".
allowed-tools: Bash Read Edit
argument-hint: "<session-slug>"
---

# /archive-session &lt;slug&gt; — archive a stale session

Marks a session archived without loading its full context. Nothing is deleted —
the `notes.md` stays on disk and can be reopened later with `/restart-session <slug>`.

Usage: `/archive-session my-feature` or `/archive-session PROJ-1234`

---

## Step 0 — Mode check

If plan mode is active (a `Plan mode is active` system reminder is present): stop and print:

> ⚠️ Plan mode is active — this skill writes files and will be blocked.
> Switch to auto mode, then re-run `/archive-session`.

## Step 1 — Resolve the slug

`SLUG` = the argument (trim whitespace). If empty, ask the user which session to
archive (the slug is the session's folder name, shown in the dashboard).

## Step 2 — Locate the notes.md

Search every configured category base for `<base>/<SLUG>/notes.md`:

```bash
SLUG="<slug trimmed>"
matches=$(python3 ~/.claude/skills/lib/aoconfig.py find "$SLUG")
count=$(printf '%s' "$matches" | grep -c .)
```

- **0** → abort: "No notes.md found for `$SLUG`. Check the slug in the dashboard."
- **1** → `NOTES_PATH="$matches"`
- **>1** → show the paths and ask which one.

## Step 3 — Read it

Read `$NOTES_PATH`. From the frontmatter, note `name`, `ticket`, `category`.
Show a one-line summary before archiving:

```
Archiving: <name> [<ticket>] — <NOTES_PATH>
```

## Step 4 — Stamp the Session history

Append a line under `## Session history` (create the section if missing):

```
- <YYYY-MM-DD HH:MM> | ARCHIVED | archived via /archive-session
```

Use `date +"%Y-%m-%d %H:%M"` for the timestamp.

## Step 5 — Remove from active-sessions.json

```bash
python3 - <<EOF
import json, os
p = os.path.expanduser('~/.claude/active-sessions.json')
if not os.path.exists(p):
    print("active-sessions.json not found — nothing to remove"); raise SystemExit
data = json.load(open(p))
before = len(data)
data = {k: v for k, v in data.items() if v.get('notes_path') != '$NOTES_PATH'}
tmp = p + '.tmp'
json.dump(data, open(tmp, 'w'), indent=2); os.replace(tmp, p)
print(f"Removed {before - len(data)} entry(ies) from active-sessions.json")
EOF
```

## Step 6 — Confirm

Print:

```
✓ Archived: <name> [<ticket>]
  Stamped: <NOTES_PATH>
  Removed from active sessions (note file kept).
```

Nothing was deleted — reopen any time with `/restart-session <slug>`.
