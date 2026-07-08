---
name: save-session
description: >-
  Checkpoint the active session WITHOUT closing it: resolve its registered notes.md,
  summarise what this session did so far (Decisions, Files touched, Open questions,
  Next steps), update those sections, and append an "(in progress)" Session history
  entry. The session stays open. Useful mid-session, or right before context compaction.
  Trigger on "/save-session", "save session", "checkpoint", "sauvegarde la session".
allowed-tools: Bash Read Edit Write
argument-hint: ""
---

# /save-session — checkpoint the active session (stays open)

Persists what's been learned/decided so far into `notes.md` without ending the session —
so nothing is lost to context compaction. Unlike `/close-session`, it marks the entry
`(in progress)` and does NOT wrap the session up.

## Step 0 — Mode check

If plan mode is active (a `Plan mode is active` system reminder is present): stop and print:

> ⚠️ Plan mode is active — this skill writes files and will be blocked.
> Switch to auto mode, then re-run `/save-session`.

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

# Relink fallback: a RESUMED session's id is often absent from active-sessions.json (it
# was closed/archived → de-registered), but its managed notes.md still records the id as a
# `session=<id>` history line. Find that notes.md so the checkpoint lands in the RIGHT
# place instead of nowhere. Searches each configured category folder via aoconfig.
if [ -z "$NOTES_PATH" ] && [ -n "$SESSION_ID" ]; then
  while IFS= read -r cat; do
    [ -z "$cat" ] && continue
    base=$(python3 ~/.claude/skills/lib/aoconfig.py base "$cat" 2>/dev/null)
    [ -z "$base" ] && continue
    hit=$(grep -rl "session=$SESSION_ID" "$base"/*/notes.md 2>/dev/null | head -1)
    [ -n "$hit" ] && { NOTES_PATH="$hit"; break; }
  done < <(python3 ~/.claude/skills/lib/aoconfig.py categories 2>/dev/null)
fi
```

If `$NOTES_PATH` is empty: stop and tell the user there's no active session registered
for this conversation — run `/start-session` (new) or `/restart-session <slug>` (resume) first.

## Step 3 — Read the notes + frontmatter

Read `$NOTES_PATH`. Note its existing sections (Goal, Decisions made, Files touched,
Open questions, Next steps, Session history).

## Step 4 — Build the summary (from THIS conversation, so far)

From the work done in this session up to now, gather:
- **Decisions made** — date-prefixed (`YYYY-MM-DD:`) one-liners (architecture/approach choices).
- **Files touched** — paths + a one-line note (pull from Edit/Write calls).
- **Open questions** — tick off any now-resolved `[ ]`; append genuinely new ones.
- **Next steps** — the updated ordered list of what comes next.
- **One-line summary** — the session so far in 10–15 words.

Skip noise (don't list every read/grep).

## Step 5 — Frontmatter refresh (auto-attach PR / ticket)

Deterministic source: `gh pr view --json url -q .url` on the current branch (session's repo). If it returns a valid GitHub PR URL (`https://github.com/owner/repo/pull/N`) → use it.
Fallback: if no `gh`/repo, use the PR Claude created/manipulated in THIS conversation (scan the conversation for any GitHub PR URL).

Update `pr_link:` in the frontmatter (Edit tool) **only if empty or different**. NEVER overwrite a value with empty.

If a ticket matching `^[A-Za-z][A-Za-z0-9]*-[0-9]+$` was created/identified in the session and `ticket:` is empty:
1. Uppercase it.
2. Update `ticket:` in the frontmatter.
3. Patch `active-sessions.json` by reading the current entry for `SESSION_ID` and MERGING: set only `ticket`, preserve `notes_path`, `category`, `name`, `started_at` (do NOT replace the whole entry).

The `prPill` icon fills automatically once the frontmatter is right.

## Step 5b — Update notes.md sections

Use the Edit tool to: append new bullets to **Decisions made** and **Files touched**;
update **Open questions** (tick resolved, add new); replace **Next steps** with the
updated list.

## Step 6 — Append an "(in progress)" Session history entry

```bash
NOW=$(date +"%Y-%m-%d %H:%M")
```

Append under `## Session history` (Edit tool) — flagged **`(in progress)`** so the
dashboard keeps the session in Running (a checkpoint, NOT a close):

```
- <NOW> (in progress) | session=<SESSION_ID> | <one-line summary>
```

Do NOT write a close-style entry here — that's `/close-session`'s job. `/save-session`
only checkpoints; the session stays open.

## Step 7 — Confirm

Print a short confirmation: frontmatter refresh result (PR link / ticket updated, or already set), which sections were updated + the `(in progress)` history
line added. Remind the user the session is still open — run `/close-session` when done,
or just keep working.
