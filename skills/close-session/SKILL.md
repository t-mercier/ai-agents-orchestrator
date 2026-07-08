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

# Relink fallback: a RESUMED session's id is often absent from active-sessions.json (it
# was closed/archived → de-registered), but its managed notes.md still records the id as a
# `session=<id>` history line. Find that notes.md so the close lands in the RIGHT place
# instead of nowhere. Searches each configured category folder via aoconfig.
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

Read `$NOTES_PATH`. Note `category`, `ticket`, `name`, `branch` from the frontmatter.

## Step 4 — Build the summary (from THIS conversation)

From the work done in this session, gather:
- **Decisions made** — date-prefixed (`YYYY-MM-DD:`) one-liners (architecture/approach choices).
- **Files touched** — paths + a one-line note (pull from Edit/Write calls).
- **Open questions** — tick off any now-resolved `[ ]`; append genuinely new ones.
- **Next steps** — a todo-list (`- [ ]` items, ≤7 open items, one line each). Mark completed work as `- [x]` (don't delete). Max 7 open items total.
- **One-line summary** — a concrete result in past tense, 10–15 words (not "worked on X").

Skip noise (don't list every read/grep). **Re-validate Goal** if it's drifted (rewrite in one line if needed).

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

## Step 6 — Append a Session history entry (ALWAYS — this is the close marker)

```bash
NOW=$(date +"%Y-%m-%d %H:%M")
```

**Always** append a closing entry under `## Session history` (Edit tool) — this line is what marks the session **Closed**; without a fresh one, a resumed session lingers as *stale*. Do not skip it as a "no-op" even when nothing new happened.

```
- <NOW> | session=<SESSION_ID> | <one-line summary>
```

- **No new work since the last close?** Still append a brief line, e.g. `- <NOW> | session=<SESSION_ID> | reclosed — no new work since the last close`.
- **Only skip** if the latest existing entry is already a close dated **today** (avoids a same-day duplicate). An older close (a previous day) does not count — append a fresh one.

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

Print a short confirmation: frontmatter refresh result (PR link / ticket updated, or already set), which sections were updated, the Session history line
added, and (if applicable) the vault note written. Remind the user they can resume
later with `/restart-session <slug>` or start fresh.
