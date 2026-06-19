---
name: restart
description: >-
  Two modes. (1) No arg — wraps the current session via /close logic, verifies
  notes.md was saved (persistence gate), then prints fresh-start options. (2) With
  <session-slug> — loads an existing notes.md into the CURRENT fresh session,
  checks out the branch from its frontmatter, registers this session in
  active-sessions.json, and suggests a /rename. Trigger on "/restart",
  "/restart <slug>", "resume <slug>", "reprendre la session".
allowed-tools: Bash Read Write Edit AskUserQuestion
argument-hint: "[session-slug]"
---

# /restart — wrap or resume a session

## Step 0 — Mode check

If plan mode is active (a `Plan mode is active` system reminder is present): stop and print:

> ⚠️ Plan mode is active — this skill writes files and will be blocked.
> Switch to auto mode, then re-run `/restart`.

Two flows depending on `$ARGUMENTS`:
- **Empty** → wrap the current session (run `/close`), gate, print fresh-start steps.
- **Non-empty** → `$ARGUMENTS` is a past session's slug; load its notes.md here.

---

## Mode A: no arguments (wrap-and-prompt)

Run the full `/close` skill steps (resolve session, summarise, update notes.md,
append Session history).

### Persistence gate
After the writes, re-read `$NOTES_PATH` and verify the new Session history line
(today's date + this session's summary) and any added bullets are present. If not,
do **not** print fresh-start instructions — print:

> `notes.md` missing expected update — re-run `/restart` or save manually before clearing context.

and stop.

### Fresh-start instructions (only after the gate passes)
`<slug>` = parent dir name of `$NOTES_PATH`. Read the current session's `cwd` from
its `~/.claude/sessions/<pid>.json` (match `$SESSION_ID`) — `claude --resume` only
works from that directory. Print:

```
Notes saved. Fresh start options:

Option A — in-place (recommended):
  /clear
  /restart <slug>

Option B — full shell restart:
  exit
  cd <SESSION_CWD>
  claude --resume <SESSION_ID>
```

Stop here for Mode A.

---

## Mode B: with `<session-slug>`

### Step 1 — Locate the notes file

```bash
SLUG="$ARGUMENTS"   # trim whitespace
matches=$(python3 ~/.claude/skills/lib/aoconfig.py find "$SLUG")
count=$(printf '%s' "$matches" | grep -c .)
```

- **0** → abort: "No notes.md found for slug `$SLUG`. Did you `/start` it?"
- **1** → `NOTES_PATH="$matches"`
- **>1** → `AskUserQuestion` to pick (list full paths).

### Step 2 — Read notes.md + extract context

Read `$NOTES_PATH`. Parse frontmatter (`session_id`, `category`, `ticket`, `name`,
`branch`, `started_at`) and the body sections (Goal, Open questions, Next steps,
Session history).

### Step 3 — Resolve current session ID

```bash
SESSION_ID=$(python3 -c "
import json, os, glob, subprocess

def ancestors(pid):
    result = set()
    while pid > 1:
        try:
            out = subprocess.run(['ps', '-p', str(pid), '-o', 'ppid='],
                                 capture_output=True, text=True).stdout.strip()
            pid = int(out)
            result.add(pid)
        except: break
    return result

mine = ancestors(os.getpid())
for f in sorted(glob.glob(os.path.expanduser('~/.claude/sessions/*.json')), key=os.path.getmtime, reverse=True):
    try:
        pid = int(os.path.basename(f).replace('.json', ''))
        if pid in mine:
            d = json.load(open(f))
            sid = d.get('sessionId', '')
            if sid:
                print(sid); break
    except Exception:
        pass
")
```

### Step 4 — Register in active-sessions.json

Point this NEW `$SESSION_ID` at the existing `$NOTES_PATH` (substitute frontmatter values):

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
    'category': '<CATEGORY from frontmatter>',
    'ticket': '<TICKET from frontmatter>',
    'name': '<NAME from frontmatter>',
    'started_at': '$(date +"%Y-%m-%d %H:%M")'
}
tmp = p + '.tmp'
json.dump(data, open(tmp, 'w'), indent=2); os.replace(tmp, p)
EOF
```

### Step 4.5 — Un-archive (revive into the lifecycle)

If this session was previously archived, its `## Session history` has an `ARCHIVED`
line — which makes the dashboard keep classifying it as Archived even after you
close it again. Restarting revives the session, so strip that marker now; the next
`/close` then files it under Closed (normal lifecycle). Idempotent — does nothing
if the session wasn't archived.

```bash
python3 - <<EOF
import os
p = "$NOTES_PATH"
lines = open(p).read().splitlines()
# Drop Session-history bullets marking the session ARCHIVED (case-insensitive).
kept = [l for l in lines if not (l.lstrip().startswith('-') and 'ARCHIVED' in l.upper())]
if len(kept) != len(lines):
    tmp = p + '.tmp'
    open(tmp, 'w').write('\n'.join(kept) + '\n')
    os.replace(tmp, p)
    print(f"Un-archived: removed {len(lines)-len(kept)} ARCHIVED marker(s).")
else:
    print("Not archived — nothing to strip.")
EOF
```

### Step 5 — Git sync (only if in a repo)

Sync the branch recorded in the notes (not whatever the shell is on):

```bash
if git rev-parse --git-dir >/dev/null 2>&1; then
  NOTES_BRANCH="<BRANCH from Step 2 frontmatter>"
  CURRENT_BRANCH=$(git branch --show-current)
  if [ -z "$NOTES_BRANCH" ] || [ "$NOTES_BRANCH" = "to fill" ]; then
    echo "WARN: no branch recorded — syncing current branch ($CURRENT_BRANCH)"
    BRANCH="$CURRENT_BRANCH"
  else
    BRANCH="$NOTES_BRANCH"
    if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
      if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
        git checkout "$BRANCH" || { echo "ERROR: cannot switch to '$BRANCH' — commit/stash first."; exit 1; }
      elif git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
        git checkout -b "$BRANCH" "origin/$BRANCH" || { echo "ERROR: cannot switch to '$BRANCH' — commit/stash first."; exit 1; }
      else
        echo "WARN: branch '$BRANCH' not found (deleted post-merge?) — staying on '$CURRENT_BRANCH'"
        BRANCH="$CURRENT_BRANCH"
      fi
    fi
  fi
  git fetch --all --prune || echo "WARN: fetch failed"
  if [ -n "$BRANCH" ] && git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
    git rebase "origin/$BRANCH" || { git rebase --abort; echo "WARN: conflicts on origin/$BRANCH — aborted"; }
  fi
  default=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
  [ -z "$default" ] && default=main
  if [ -n "$BRANCH" ] && [ "$BRANCH" != "$default" ]; then
    git rebase "origin/$default" || { git rebase --abort; echo "WARN: conflicts on origin/$default — aborted"; }
  fi
  echo "Branch: $BRANCH (synced)"
fi
```

Never use `--force`, `--no-verify`, or `--skip`.

### Step 6 — Rename the session

```bash
NEW_NAME="$CATEGORY | $NAME"
[ -n "$TICKET" ] && NEW_NAME="$NEW_NAME | $TICKET"
python3 - <<EOF
import json, os, glob
session_id = '$SESSION_ID'
new_name = """$NEW_NAME"""
for f in glob.glob(os.path.expanduser('~/.claude/sessions/*.json')):
    try:
        data = json.load(open(f))
        if data.get('sessionId') == session_id:
            data['name'] = new_name
            json.dump(data, open(f, 'w'), indent=2)
            print(f"Renamed session to: {new_name}"); break
    except Exception:
        pass
else:
    print(f"WARN: no session file for {session_id} — rename manually: /rename {new_name}")
EOF
```

### Step 7 — Brief the user

Read the current session's `cwd` from its `~/.claude/sessions/<pid>.json`. Print a
tight 5-second summary:

```
Loaded <SLUG> from <NOTES_PATH>.

**Goal:** <one line>
**Branch:** <BRANCH> (synced)
**Open questions:** <list>
**Next steps:** <list>

Last session: <last Session history entry>

To resume later:  cd <SESSION_CWD> && claude --resume <SESSION_ID>

Ready.
```
