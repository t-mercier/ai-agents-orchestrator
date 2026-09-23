#!/usr/bin/env python3
"""PreToolUse hook: the app's skills are the app's. A write to one is refused.

The 14 skills AI Agents Orchestrator ships write the notes.md the dashboard reads. Edit one
to save somewhere else and the dashboard stops seeing the session, the auto-save hook asks
for checkpoints that land nowhere, the PR never attaches — quietly. And every release would
overwrite the edit anyway. So they are not customisable, by decision: want different
behaviour, make a skill of your own (copy the app's under another name and change that).

This hook is where the decision holds against the agent: an Edit / Write / MultiEdit /
NotebookEdit aimed under `~/.claude/skills/<app skill>/`, `lib/`, `.ao-base/` or the
install manifest is denied with the reason and the alternative. App-owned is decided the
way the app decides it — the skill has a pristine copy under `.ao-base/`. A user's own
skills (any other name) are never in scope.

Bash writes (`sed -i`, `>`) are not inspected here: the files are also read-only on disk,
and the app restores its version at the next sync. Silent and exit 0 on every other path.
"""

import json
import os
import sys

SKILLS_DIR = "~/.claude/skills"
BASE_DIR = ".ao-base"
SHARED_LIB = "lib"
MANIFEST = ".ao-install-manifest.json"
TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")


def target_path(payload):
    """The file a write tool is about to touch, or None for tools that write nothing."""
    if (payload.get("tool_name") or "") not in TOOLS:
        return None
    inp = payload.get("tool_input") or {}
    return inp.get("file_path") or inp.get("notebook_path") or None


def owned_skill(path, skills_dir, app_owned):
    """The app skill `path` falls under, or None. `app_owned(name)` says whether a
    top-level entry of the skills folder belongs to the app — injected so the rule is
    testable without a real ~/.claude."""
    if not path:
        return None
    real = os.path.realpath(os.path.expanduser(path))
    root = os.path.realpath(os.path.expanduser(skills_dir))
    if real == root:
        return None
    if not real.startswith(root + os.sep):
        return None
    first = real[len(root) + 1:].split(os.sep)[0]
    if first in (BASE_DIR, SHARED_LIB, MANIFEST):
        return first
    return first if app_owned(first) else None


def reason_for(name):
    if name in (BASE_DIR, SHARED_LIB, MANIFEST):
        return ("~/.claude/skills/{} belongs to AI Agents Orchestrator (its pristine copies, "
                "shared helper and install manifest). Nothing here is meant to be edited.".format(name))
    return ("/{0} is one of AI Agents Orchestrator's own skills — the dashboard depends on what it "
            "writes, and every release restores it. Do not edit it. If different behaviour is "
            "wanted, create a NEW skill of your own (e.g. copy ~/.claude/skills/{0}/ to "
            "~/.claude/skills/{0}-mine/, rename `name:` in its frontmatter, and change that one)."
            .format(name))


def decide(payload, skills_dir, app_owned):
    """Pure: the denial reason, or None to let the call through."""
    name = owned_skill(target_path(payload), skills_dir, app_owned)
    return reason_for(name) if name else None


def main():
    try:
        payload = json.loads(sys.stdin.read())
    except Exception:
        return
    root = os.path.expanduser(SKILLS_DIR)

    def app_owned(name):
        return os.path.isdir(os.path.join(root, BASE_DIR, name))

    try:
        reason = decide(payload, root, app_owned)
    except Exception:
        return
    if reason:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }))


if __name__ == "__main__":
    main()
