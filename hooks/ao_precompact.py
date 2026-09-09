#!/usr/bin/env python3
"""PreCompact hook: leave a mark in notes.md before the detail is compacted away.

Compaction is the moment a session forgets. The ao_autosave Stop hook should already have
had /save-session run at 60 % and 80 % of context; this is the last line of defence, and it
does the one thing that needs no model at all — it appends an `(in progress)` line to the
session's history with the transcript path and the moment, so the dashboard keeps the
session in Running and a later resume knows exactly where the conversation lived. The
summary itself is still the model's to write: the systemMessage says so, and the
ao_session_start hook repeats it right after compaction, when tools are available again.

Only for sessions the dashboard knows. Never two auto-checkpoints in a row: if the history's
last line is already one for this session, nothing is added — a real /save-session has to
intervene first. Atomic write (the dashboard polls the file). Silent and exit 0 otherwise.
"""

import json
import os
import sys
import tempfile
import time

ACTIVE_SESSIONS = "~/.claude/active-sessions.json"
HEADING = "## Session history"
MARK = "auto-checkpoint before compaction"


def notes_path_for(session_id, registry):
    entry = (registry or {}).get(session_id) or {}
    return entry.get("notes_path") or None


def checkpoint_line(session_id, transcript_path, when, trigger):
    """The history line, in the exact shape /save-session writes so every reader of
    `session=` / `(in progress)` treats it as one more checkpoint."""
    tail = " | transcript={}".format(transcript_path) if transcript_path else ""
    return "- {} (in progress) | session={}{} | {} ({}; written by the ao_precompact hook — summary still to write)".format(
        when, session_id, tail, MARK, trigger or "auto")


def append_checkpoint(content, line, session_id):
    """New content with `line` at the end of the Session history section, or None when
    there is nothing to do: no such section (not a session notes.md), or the section
    already ends on an auto-checkpoint for this session."""
    lines = content.split("\n")
    try:
        start = next(i for i, l in enumerate(lines) if l.strip() == HEADING)
    except StopIteration:
        return None
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if lines[i].startswith("## "):
            end = i
            break
    last = None
    for i in range(end - 1, start, -1):
        if lines[i].strip():
            last = i
            break
    if last is not None and MARK in lines[last] and "session={}".format(session_id) in lines[last]:
        return None
    insert_at = (last + 1) if last is not None else start + 1
    lines.insert(insert_at, line)
    return "\n".join(lines)


def write_atomic(path, content):
    folder = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".ao_precompact-")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(content)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def run(payload, registry, when):
    session_id = payload.get("session_id") or ""
    path = notes_path_for(session_id, registry)
    if not path or not os.path.isfile(path):
        return None
    with open(path) as f:
        content = f.read()
    line = checkpoint_line(session_id, payload.get("transcript_path") or "", when, payload.get("trigger"))
    updated = append_checkpoint(content, line, session_id)
    if updated is not None:
        write_atomic(path, updated)
    return ("Context compaction is about to run. notes.md got a bare (in progress) checkpoint "
            "line; the summary is still yours — run /save-session at the first opportunity.")


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
        return
    try:
        message = run(payload, registry, time.strftime("%Y-%m-%d %H:%M"))
    except Exception:
        return
    if message:
        print(json.dumps({"systemMessage": message}))


if __name__ == "__main__":
    main()
