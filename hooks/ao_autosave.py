#!/usr/bin/env python3
"""Stop hook: make the checkpoint happen without anyone asking for it.

/save-session writes the session's notes.md — decisions, files, open questions, a history
line. It only ever ran when someone typed it, and the moment it matters most (context
nearly full, a compaction about to erase the detail) is the moment nobody remembers to.

This hook runs when the model finishes a turn. When one of two conditions holds it answers
`{"decision": "block", "reason": …}`, which Claude Code feeds back to the model as the next
thing to do — so the model runs /save-session itself, then stops. Verified: a blocked Stop
makes the model act on the reason; on the second Stop `stop_hook_active` is set and this
hook stays silent, so it cannot loop.

The two conditions, both from real figures rather than guesses:
  1. context: the statusline cache the dashboard already maintains carries each session's
     real context percentage (`sessions.<id>.contextPct`) — not a transcript byte count,
     which lies for every model that is not 1M. Once at 60 %, once again at 80 %.
  2. time: notes.md untouched for 30 minutes while the transcript kept moving. Never more
     than once per 30 minutes.

Only for sessions the dashboard knows (present in active-sessions.json with a notes path):
an unmanaged session has nothing to checkpoint into. Silent and exit 0 on every other path.
"""

import json
import os
import sys
import time

ACTIVE_SESSIONS = "~/.claude/active-sessions.json"
CACHE = "~/.claude/statusline-cache.json"
STATE_DIR = "~/.claude/hooks-state/ao_autosave"

CONTEXT_TIERS = (60, 80)
STALE_SECONDS = 30 * 60
REPEAT_SECONDS = 30 * 60


def notes_path_for(session_id, registry):
    entry = (registry or {}).get(session_id) or {}
    return entry.get("notes_path") or None


def context_pct(cache, session_id):
    """The session's real context percentage from the statusline cache, or None."""
    try:
        value = ((cache or {}).get("sessions") or {}).get(session_id, {}).get("contextPct")
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def decide(context, notes_mtime, transcript_mtime, state, now):
    """Pure: (reason or None, new_state).

    `state` is {"tiers": [tiers already announced], "last": epoch of the last reason}.
    Crossing 80 % straight from below 60 % marks both tiers — one reason, not two."""
    tiers = set(state.get("tiers") or [])
    last = float(state.get("last") or 0)

    if context is not None:
        # A compaction drops the figure back to 20-30 %. The tiers were "once each" so a
        # session hovering at 61 % is not nagged every turn — not so that the second climb
        # to 60 % passes in silence. Below the lowest tier, they re-arm.
        if context < CONTEXT_TIERS[0]:
            tiers = set()
        due = [t for t in CONTEXT_TIERS if context >= t and t not in tiers]
        if due:
            tiers.update(t for t in CONTEXT_TIERS if context >= t)
            reason = ("Context is at {}% — run /save-session now to checkpoint notes.md, then stop."
                      .format(context))
            return reason, {"tiers": sorted(tiers), "last": now}

    if (notes_mtime and transcript_mtime and transcript_mtime > notes_mtime
            and now - notes_mtime >= STALE_SECONDS and now - last >= REPEAT_SECONDS):
        minutes = int((now - notes_mtime) // 60)
        reason = ("notes.md was last checkpointed {} min ago and the conversation has moved "
                  "since — run /save-session now, then stop.".format(minutes))
        return reason, {"tiers": sorted(tiers), "last": now}

    return None, state


def mtime(path):
    try:
        return os.path.getmtime(path) if path else None
    except OSError:
        return None


def load_json(path, default):
    try:
        with open(os.path.expanduser(path)) as f:
            return json.load(f)
    except Exception:
        return default


def main():
    # The dashboard's own headless runs (wrap, import, /sync-refs) export this. Blocking an
    # agent-in-a-pipe into a /save-session after its close line would be noise.
    if os.environ.get("AO_HEADLESS"):
        return
    try:
        payload = json.loads(sys.stdin.read())
    except Exception:
        return
    if payload.get("stop_hook_active"):
        return                                      # we asked; the model complied; stop.
    session_id = payload.get("session_id") or ""
    notes = notes_path_for(session_id, load_json(ACTIVE_SESSIONS, {}))
    if not notes or not os.path.isfile(notes):
        return
    state_dir = os.path.expanduser(STATE_DIR)
    state_file = os.path.join(state_dir, session_id + ".json")
    state = load_json(state_file, {})
    now = time.time()
    try:
        reason, new_state = decide(
            context_pct(load_json(CACHE, {}), session_id),
            mtime(notes),
            mtime(payload.get("transcript_path") or ""),
            state if isinstance(state, dict) else {},
            now,
        )
    except Exception:
        return
    if not reason:
        return
    try:
        os.makedirs(state_dir, exist_ok=True)
        with open(state_file, "w") as f:
            json.dump(new_state, f)
    except Exception:
        return                                      # cannot remember we asked → do not ask
    print(json.dumps({"decision": "block", "reason": reason}))


if __name__ == "__main__":
    main()
