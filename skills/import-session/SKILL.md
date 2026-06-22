---
name: import-session
description: >-
  Adopt the CURRENT (already-running) Claude Code session into management: writes
  a notes.md under a category's configured folder and registers the session in
  ~/.claude/active-sessions.json, so the dashboard tracks it like a /start-ed one.
  Meant to run right after `claude --resume <id>` (the dashboard's +Import does
  this for you). Unlike /start-session it does NOT create a fresh workspace or sync a repo —
  it binds the session you're already in. Trigger on "/import-session", "/import-session FEAT name".
allowed-tools: Bash Read Write AskUserQuestion
argument-hint: "<CATEGORY> [name]"
---

# /import-session — adopt the current session

Binds the session you're in (typically just `--resume`d) to a `notes.md` under a
category folder + registers it, so it shows up managed in the dashboard. Categories
and their folders come from your config — edit them in Settings, not here.

## Step 0 — Mode check

If plan mode is active (a `Plan mode is active` system reminder is present): stop and print:

> ⚠️ Plan mode is active — this skill writes files and will be blocked.
> Switch to auto mode, then re-run `/import-session`.

## Step 1 — Parse arguments + validate category

Read `$ARGUMENTS`. Form: `<CATEGORY> [name]`.

- `CATEGORY` — uppercase it; it must be one of the configured categories:
  ```bash
  python3 ~/.claude/skills/lib/aoconfig.py categories
  ```
  If the list is **empty**, stop and print:
  > No categories configured. Add one in the app's **Settings** (or via **＋New**) first — a session needs a category folder to live under.

  If `CATEGORY` isn't in the list, prompt with `AskUserQuestion` (offer the listed categories).
- `NAME` — everything after the category. If absent, derive a short slug from the session's first goal/topic, or ask with `AskUserQuestion` ("Short name for this session? 3–6 words").

## Step 2 — Resolve the CURRENT session ID

This is the session we're adopting (the one this skill runs in — i.e. the resumed one).

```bash
SESSION_ID=$(python3 -c "
import json, os, glob, subprocess
def ancestors(pid):
    result = set()
    while pid > 1:
        try:
            out = subprocess.run(['ps','-p',str(pid),'-o','ppid='], capture_output=True, text=True).stdout.strip()
            pid = int(out); result.add(pid)
        except: break
    return result
mine = ancestors(os.getpid())
for f in sorted(glob.glob(os.path.expanduser('~/.claude/sessions/*.json')), key=os.path.getmtime, reverse=True):
    try:
        pid = int(os.path.basename(f).replace('.json',''))
        if pid in mine:
            d = json.load(open(f)); sid = d.get('sessionId','')
            if sid: print(sid); break
    except Exception: pass
")
```

If empty, abort: "Couldn't resolve the current session id — is this running inside `claude`?"

## Step 3 — Compute slug + path; abort if already managed

```bash
slug() { echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g'; }
FOLDER=$(slug "$NAME")
[ -z "$FOLDER" ] && FOLDER="imported-$(echo "$SESSION_ID" | cut -c1-8)"
TARGET_DIR=$(python3 ~/.claude/skills/lib/aoconfig.py dir "$CATEGORY" "$FOLDER")
NOTES_PATH="$TARGET_DIR/notes.md"
```

If `notes.md` already exists at `$NOTES_PATH`, abort: "Already managed at `$NOTES_PATH` — use `/restart-session $FOLDER` to reopen." Do NOT overwrite.

## Step 4 — Resolve branch

```bash
if git rev-parse --git-dir >/dev/null 2>&1; then BRANCH=$(git branch --show-current); else BRANCH=""; fi
```

## Step 5 — Write the notes.md

```bash
mkdir -p "$TARGET_DIR"
NOW=$(date +"%Y-%m-%d %H:%M"); TODAY=$(date +%Y-%m-%d)
```

Write `$NOTES_PATH` (Write tool), substituting the bracketed values. Fill the Goal +
Next steps from what you can infer about the conversation so far (it's already loaded);
leave them as a short prompt if unclear.

```markdown
---
session_id: <SESSION_ID>
category: <CATEGORY>
ticket: <TICKET if one is obvious from the work, else empty>
name: <NAME>
branch: <BRANCH or "to fill">
started_at: <NOW>
---

# <NAME>

## Goal
<one line inferred from the conversation, or "imported — fill in">

## Branch
<BRANCH or "to fill">

## Decisions made
- <TODAY>: imported into <CATEGORY> from an existing Claude Code session.

## Files touched
- …

## Open questions
- [ ] …

## Next steps
1. …

## Session history
- <NOW> | session=<SESSION_ID> | imported into <CATEGORY> via the dashboard
```

## Step 6 — Register in active-sessions.json

```bash
python3 - <<EOF
import json, os
p = os.path.expanduser('~/.claude/active-sessions.json')
data = {}
if os.path.exists(p):
    try: data = json.load(open(p))
    except: data = {}
data['$SESSION_ID'] = {
    'notes_path': '$NOTES_PATH',
    'category': '$CATEGORY',
    'ticket': '',
    'name': '$NAME',
    'started_at': '$NOW',
}
tmp = p + '.tmp'
json.dump(data, open(tmp,'w'), indent=2)
os.replace(tmp, p)
EOF
```

## Step 7 — Confirm

Print a short confirmation: imported `<NAME>` into `<CATEGORY>`, notes at `$NOTES_PATH`,
registered. Remind the user the dashboard picks it up on its next 5-second poll (it's
live now → **Running**), and that `/close-session` will file it under Closed when they're done.
