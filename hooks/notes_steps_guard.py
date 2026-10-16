#!/usr/bin/env python3
"""PostToolUse hook: keep a session's Next steps a short queue, whoever writes it.

The dashboard shows a session's `## Next steps` on its card and in its panel, and Brutus
reads them to remind the person what is theirs. /save-session, /close-session and
/wrap-session all say: at most 7 open steps, one line of at most 100 characters each, a
finished step deleted rather than ticked. Those words are advice, and an agent editing
notes.md mid-session never reads them: across 155 sessions, 148 of 364 open steps ran
past 100 characters (one to 1,128) and a list reached 29 steps.

So the rule is checked where the file is written. After an Edit or Write to a notes.md,
the section is read back; when it breaks the rule, the hook answers with
`{"decision": "block", "reason": ...}`, which Claude Code hands to the model as feedback
on the edit it just made. The edit itself stands. The model rewrites the section and the
next edit is checked the same way.

Never writes. Silent and exit 0 when the section is fine, when the file is not a
notes.md, and on every error: a broken hook must not get in the way of a turn.
"""

import json
import os
import re
import sys

MAX_STEPS = 7
MAX_CHARS = 100
EDIT_TOOLS = ("Edit", "Write", "MultiEdit")
OPEN = re.compile(r"^\s*[-*] \[ \]\s+(.*\S)\s*$")
DONE = re.compile(r"^\s*[-*] \[[xX]\]")
SHOWN = 60
# The long steps quoted back: enough to show the pattern, not a second copy of the notes.
QUOTED = 5


def next_steps(text):
    """The lines of the `## Next steps` section, without its heading, or None."""
    m = re.search(r"^## Next steps\b[^\n]*\n(.*?)(?=^## |\Z)", text, re.S | re.M | re.I)
    return m.group(1).split("\n") if m else None


def is_session_notes(text):
    """A session's notes: frontmatter first, a Next steps and a Session history section.
    Any other notes.md (a repo's docs, a personal file) is not this hook's business."""
    return (text.startswith("---\n") and re.search(r"^## Session history", text, re.M) is not None
            and next_steps(text) is not None)


def touches_steps(payload):
    """Did this call write the Next steps? A Write rewrites the whole file; an Edit or
    MultiEdit only counts when its new text has a step or the section's heading, so
    appending a history line does not answer for steps written long ago."""
    ti = payload.get("tool_input") or {}
    if payload.get("tool_name") == "Write":
        return True
    news = [ti.get("new_string") or ""] + [(e or {}).get("new_string") or "" for e in ti.get("edits") or []]
    return any(re.search(r"^\s*[-*] \[[ xX]\]|^## Next steps", n, re.M | re.I) for n in news)


def problems(lines):
    """What breaks the rule, as short sentences for the model. Empty when nothing does."""
    open_steps, long_steps, done, wrapped = [], [], 0, 0
    for line in lines:
        if not line.strip():
            continue
        m = OPEN.match(line)
        if m:
            open_steps.append(m.group(1))
            if len(m.group(1)) > MAX_CHARS:
                long_steps.append(m.group(1))
        elif DONE.match(line):
            done += 1
        elif open_steps and line[:1] in (" ", "\t"):
            # An indented line under a step: the step runs on over several lines.
            wrapped += 1
    out = []
    if len(open_steps) > MAX_STEPS:
        out.append(f"{len(open_steps)} open steps; keep at most {MAX_STEPS}, the rest is a decision or an open question.")
    for s in long_steps[:QUOTED]:
        out.append(f"{len(s)} characters, over {MAX_CHARS}: \"{s[:SHOWN]}…\"")
    if len(long_steps) > QUOTED:
        out.append(f"and {len(long_steps) - QUOTED} more step(s) over {MAX_CHARS} characters.")
    if wrapped:
        out.append(f"{wrapped} indented line(s) continue a step; a step is one line.")
    if done:
        out.append(f"{done} ticked step(s); delete a finished step, its record is in Decisions made and the history.")
    return out


def reason(found):
    return (
        "The ## Next steps you just wrote break the notes rule (at most 7 open steps, one line "
        "of at most 100 characters each, imperative, finished steps deleted):\n- "
        + "\n- ".join(found)
        + "\nRewrite that section now: say each step as the action alone, and move its "
        "detail (evidence, hypotheses, file paths, why) to ## Open questions or "
        "## Decisions made. Keep the first line the top priority."
    )


def check(payload):
    """The block decision for this tool call, or None."""
    if payload.get("tool_name") not in EDIT_TOOLS:
        return None
    path = (payload.get("tool_input") or {}).get("file_path") or ""
    if os.path.basename(path) != "notes.md" or not os.path.isfile(path) or not touches_steps(payload):
        return None
    with open(path, encoding="utf-8", errors="replace") as f:
        text = f.read()
    if not is_session_notes(text):
        return None
    found = problems(next_steps(text))
    return {"decision": "block", "reason": reason(found)} if found else None


def main():
    try:
        out = check(json.load(sys.stdin))
        if out:
            print(json.dumps(out))
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
