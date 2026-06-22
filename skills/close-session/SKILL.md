---
name: close-session
description: >-
  Wrap up the active session: resolve its registered notes.md, summarise what
  this session did (Decisions, Files touched, Open questions, Next steps), update
  those sections, and append a Session history entry. If Obsidian is enabled in
  config, distils a short atomic note to the matching vault. Trigger on "/close-session",
  "wrap up", "save session notes", "ferme la session".
allowed-tools: Bash Read Edit Write
argument-hint: ""
---

# /close-session — wrap up the active session

Summarises the current session into its `notes.md` and stamps the Session history.
Nothing is deleted; the session can be resumed later.

## Step 0 — Mode check

If plan mode is active (a `Plan mode is active` system reminder is present): stop and print:

> ⚠️ Plan mode is active — this skill writes files and will be blocked.
> Switch to auto mode, then re-run `/close-session`.

## Step 1 — Resolve the current session ID

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

## Step 2 — Find the registered notes.md

```bash
NOTES_PATH=$(python3 - "$SESSION_ID" <<'PY'
import json, os, sys
sid = sys.argv[1]
p = os.path.expanduser('~/.claude/active-sessions.json')
try: d = json.load(open(p))
except Exception: d = {}
print((d.get(sid) or {}).get('notes_path', ''))
PY
)
```

If `$NOTES_PATH` is empty: stop and tell the user there's no active session registered
for this conversation — run `/start-session` (new) or `/restart-session <slug>` (resume) first.

## Step 3 — Read the notes + frontmatter

Read `$NOTES_PATH`. Note `category`, `ticket`, `name`, `branch` from the frontmatter.

## Step 4 — Build the summary (from THIS conversation)

From the work done in this session, gather:
- **Decisions made** — date-prefixed (`YYYY-MM-DD:`) one-liners (architecture/approach choices).
- **Files touched** — paths + a one-line note (pull from Edit/Write calls).
- **Open questions** — tick off any now-resolved `[ ]`; append genuinely new ones.
- **Next steps** — the updated ordered list of what comes next.
- **One-line summary** — the session in 10–15 words.

Skip noise (don't list every read/grep).

## Step 5 — Update notes.md sections

Use the Edit tool to: append new bullets to **Decisions made** and **Files touched**;
update **Open questions** (tick resolved, add new); replace **Next steps** with the
updated list.

## Step 6 — Append a Session history entry

```bash
NOW=$(date +"%Y-%m-%d %H:%M")
```

Append under `## Session history` (Edit tool):

```
- <NOW> | session=<SESSION_ID> | <one-line summary>
```

## Step 7 — Optional: distil to Obsidian (gated)

Only if a vault is configured for this category's scope:

```bash
VAULT=$(python3 ~/.claude/skills/lib/aoconfig.py vault "<CATEGORY>")
```

If `$VAULT` is non-empty, write a short atomic note `"$VAULT/sessions/<slug>.md"`
(slug = the notes.md parent dir name) with: the title, the Goal, the key Decisions,
the Next steps, and a backlink line `Source: <NOTES_PATH>`. Create the
`"$VAULT/sessions"` directory if needed. If `$VAULT` is empty, skip silently.

## Step 8 — Confirm

Print a short confirmation: which sections were updated, the Session history line
added, and (if applicable) the vault note written. Remind the user they can resume
later with `/restart-session <slug>` or start fresh.
