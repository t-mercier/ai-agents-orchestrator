#!/usr/bin/env python3
"""SessionStart hook: the two habits, said once, at the moment they can be acted on.

`/learn` says "use PROACTIVELY" in its own description, and CLAUDE.md files that say
"write knowledge notes as you learn" exist on some machines and not on others. This puts
the instruction in front of the model at the start of every session the dashboard tracks,
so learning does not depend on whose CLAUDE.md the session happened to load.

The same hook fires after a compaction (`source: compact`), which is the one moment the
ao_precompact hook cannot use: tools are available again. If notes.md has not been
checkpointed for 30 minutes at that point, the model is told to run /save-session first.
The age comes from the last history line that ao_precompact did not write: that hook has
just touched the file, so its modification time always reads as fresh.

Reads only. Silent and exit 0 on every failure.
"""

import json
import os
import re
import sys
import time

try:
    from ao_autosave import BLOCKING_TIER, CONTEXT_TIERS
except Exception:                                # installed without its sibling
    CONTEXT_TIERS, BLOCKING_TIER = (75, 90), 90

ACTIVE_SESSIONS = "~/.claude/active-sessions.json"
STALE_SECONDS = 30 * 60
HEADING = "## Session history"
# Must match ao_precompact.MARK; kept as a copy so each hook runs on its own.
PRECOMPACT_MARK = "auto-checkpoint before compaction"
STAMP = re.compile(r"^\s*-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\b")

LEARN = ("Run /learn the moment something durable emerges — a preference or correction just "
         "stated, a stable fact about the environment or its conventions, a gotcha with its "
         "workaround — and do not wait for the close. A reusable procedure is a skill "
         "(/skill-propose), not a note.")
SAVE = ("/save-session checkpoints notes.md. A Stop hook advises it at {}% context, requires "
        "it at {}%, and advises it after 30 minutes without a checkpoint; when it does, run "
        "it — it is the checkpoint, not a suggestion.").format(CONTEXT_TIERS[0], BLOCKING_TIER)


def notes_path_for(session_id, registry):
    entry = (registry or {}).get(session_id) or {}
    return entry.get("notes_path") or None


def last_checkpoint(content, fallback):
    """Pure: epoch of the last Session history line not written by ao_precompact, read in
    local time as /save-session writes it; `fallback` when there is no such line."""
    lines = content.split("\n")
    try:
        start = next(i for i, l in enumerate(lines) if l.strip() == HEADING)
    except StopIteration:
        return fallback
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    for line in reversed(lines[start + 1:end]):
        if PRECOMPACT_MARK in line:
            continue
        match = STAMP.match(line)
        if match:
            try:
                return time.mktime(time.strptime(match.group(1), "%Y-%m-%d %H:%M"))
            except (ValueError, OverflowError):
                continue
    return fallback


def context_for(notes_path, source, notes_mtime, now):
    """Pure: the additionalContext to inject."""
    parts = []
    if notes_path:
        parts.append("This session is tracked by AI Agents Orchestrator; its notes.md is {}.".format(notes_path))
        if source == "compact" and notes_mtime and now - notes_mtime >= STALE_SECONDS:
            parts.append("Context was just compacted and notes.md has not been checkpointed for "
                         "{} minutes — run /save-session now, before anything else."
                         .format(int((now - notes_mtime) // 60)))
        parts.append(LEARN)
        parts.append(SAVE)
    else:
        parts.append(LEARN)
        parts.append("If /start-session registers this session with AI Agents Orchestrator, " + SAVE[0].lower() + SAVE[1:])
    return " ".join(parts)


def main():
    if os.environ.get("AO_HEADLESS"):           # the dashboard's own headless runs; see ao_autosave
        return
    try:
        payload = json.loads(sys.stdin.read())
    except Exception:
        return
    try:
        with open(os.path.expanduser(ACTIVE_SESSIONS)) as f:
            registry = json.load(f)
    except Exception:
        registry = {}
    try:
        path = notes_path_for(payload.get("session_id") or "", registry)
        if path and not os.path.isfile(path):
            path = None
        checkpoint = None
        if path:
            with open(path) as f:
                checkpoint = last_checkpoint(f.read(), os.path.getmtime(path))
        text = context_for(path, payload.get("source") or "", checkpoint, time.time())
    except Exception:
        return
    print(json.dumps({
        "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": text}
    }))


if __name__ == "__main__":
    main()
