#!/usr/bin/env python3
"""SessionStart hook: the two habits, said once, at the moment they can be acted on.

`/learn` says "use PROACTIVELY" in its own description, and CLAUDE.md files that say
"write knowledge notes as you learn" exist on some machines and not on others. This puts
the instruction in front of the model at the start of every session the dashboard tracks,
so learning does not depend on whose CLAUDE.md the session happened to load.

The same hook fires after a compaction (`source: compact`), which is the one moment the
ao_precompact hook cannot use: tools are available again. If notes.md has not been
checkpointed for 30 minutes at that point, the model is told to run /save-session first.

Reads only. Silent and exit 0 on every failure.
"""

import json
import os
import sys
import time

ACTIVE_SESSIONS = "~/.claude/active-sessions.json"
STALE_SECONDS = 30 * 60

LEARN = ("Run /learn the moment something durable emerges — a preference or correction just "
         "stated, a stable fact about the environment or its conventions, a gotcha with its "
         "workaround — and do not wait for the close. A reusable procedure is a skill "
         "(/skill-propose), not a note.")
SAVE = ("/save-session checkpoints notes.md. A Stop hook asks for it at 60% context and "
        "after 30 minutes without a checkpoint; when it does, run it — it is the checkpoint, "
        "not a suggestion.")


def notes_path_for(session_id, registry):
    entry = (registry or {}).get(session_id) or {}
    return entry.get("notes_path") or None


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
        mtime = os.path.getmtime(path) if path else None
        text = context_for(path, payload.get("source") or "", mtime, time.time())
    except Exception:
        return
    print(json.dumps({
        "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": text}
    }))


if __name__ == "__main__":
    main()
