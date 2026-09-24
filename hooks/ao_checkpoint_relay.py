#!/usr/bin/env python3
"""UserPromptSubmit hook: hand the model the checkpoint advice the Stop hook left for it.

ao_autosave advises a /save-session at 75% of context and after 30 minutes without a
checkpoint. From a Stop hook that advice can only be a systemMessage, which Claude Code
shows to the user and never to the model, so the model never acted on it. ao_autosave
therefore also stores it; this hook injects it, once, as context for the next prompt.

Silent on any failure: a reminder that cannot be delivered must never block a prompt.
"""
import json
import os
import sys

STATE_DIR = "~/.claude/hooks-state/ao_autosave"


def main():
    if os.environ.get("AO_HEADLESS"):
        return
    try:
        payload = json.loads(sys.stdin.read())
    except Exception:
        return
    session_id = payload.get("session_id") or ""
    if not session_id or "/" in session_id:
        return
    path = os.path.join(os.path.expanduser(STATE_DIR), session_id + ".json")
    try:
        with open(path) as f:
            state = json.load(f)
    except Exception:
        return
    advice = state.pop("pending", None) if isinstance(state, dict) else None
    if not advice:
        return
    try:
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(state, f)
        os.replace(tmp, path)
    except Exception:
        return                                      # cannot clear it → do not repeat it forever
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": f"Left for you by the Stop hook after your last reply: {advice}",
        }
    }))


if __name__ == "__main__":
    main()
