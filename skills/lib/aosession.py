#!/usr/bin/env python3
"""Which session is this? The agent CLI running this skill, and its session id.

Each CLI exports its session id to the shell commands it runs: Claude Code as
CLAUDE_CODE_SESSION_ID, Codex as CODEX_THREAD_ID, Copilot as COPILOT_AGENT_SESSION_ID.
Those variables are inherited by a CLI started from inside another one, so the variable
alone can name the wrong session. The nearest ancestor process that is one of the three
CLIs decides which variable is read. For Claude Code its pidfile
(~/.claude/sessions/<pid>.json) comes first and the variable is only the fallback.

    aosession.py current                          -> "<agent> <session_id> <pid>", or nothing
    aosession.py register <notes_path> [<name>]   -> writes the live-session state file

Staged for the plan that runs the app skills inside Codex and Copilot: no skill calls it
yet, and nothing reads the state file it writes.
"""
import json
import os
import subprocess
import sys
import time

AGENTS = ("claude", "codex", "copilot")
ENV_VAR = {"claude": "CLAUDE_CODE_SESSION_ID", "codex": "CODEX_THREAD_ID", "copilot": "COPILOT_AGENT_SESSION_ID"}
STATE_DIR = os.path.expanduser("~/.config/ai-agents-orchestrator/state")
PIDFILES = os.path.expanduser("~/.claude/sessions")


def agent_of(comm, env):
    """The agent a `ps -o comm=` value names, or None."""
    comm = comm.strip()
    head = comm.split()[0] if comm else ""
    base = head.rsplit("/", 1)[-1]
    if base == "codex":
        return "codex"
    if base == "copilot":
        return "copilot"
    if base == "claude" or "/claude/versions/" in comm:
        return "claude"
    # An npm install of Claude Code runs as `node`; so do the wrappers of the other two,
    # which is why a bare node is only trusted inside Claude Code.
    if base == "node" and env.get("CLAUDECODE") == "1":
        return "claude"
    return None


def nearest_agent(chain, env):
    """(agent, pid) of the nearest CLI in `chain`, a list of (pid, comm), nearest first."""
    for pid, comm in chain:
        agent = agent_of(comm, env)
        if agent:
            return agent, pid
    return None, None


def current(env, chain, pidfile_session):
    """(agent, session_id, pid). `pidfile_session(pid)` reads a Claude pidfile's id or None."""
    agent, pid = nearest_agent(chain, env)
    if agent:
        # Claude Code: its pidfile first. Every managed session is keyed by that id, and
        # whether the variable follows `--resume` or `/clear` has not been checked.
        sid = (pidfile_session(pid) or "") if agent == "claude" else ""
        sid = sid or env.get(ENV_VAR[agent], "")
        return agent, sid, pid
    for pid, _ in chain:
        sid = pidfile_session(pid)
        if sid:
            return "claude", sid, pid
    return None, "", None


def register(state_dir, agent, pid, session_id, cwd, notes_path, name):
    """Write <state_dir>/<pid>.json, atomically. Returns its path."""
    if agent not in AGENTS:
        raise ValueError(f"unknown agent: {agent}")
    os.makedirs(state_dir, exist_ok=True)
    path = os.path.join(state_dir, f"{int(pid)}.json")
    data = {"v": 1, "agent": agent, "pid": int(pid), "session_id": session_id, "cwd": cwd,
            "notes_path": notes_path, "name": name,
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)
    return path


def ancestry(pid=None):
    """[(pid, comm)] from this process's parent upwards."""
    out, pid = [], os.getppid() if pid is None else pid
    while pid and pid > 1 and len(out) < 40:
        r = subprocess.run(["ps", "-o", "ppid=,comm=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
        if not r:
            break
        ppid, _, comm = r.partition(" ")
        out.append((pid, comm.strip()))
        try:
            pid = int(ppid)
        except ValueError:
            break
    return out


def pidfile_session(pid):
    try:
        with open(os.path.join(PIDFILES, f"{int(pid)}.json")) as f:
            return json.load(f).get("sessionId") or None
    except (OSError, ValueError, TypeError):
        return None


def main(argv):
    agent, sid, pid = current(os.environ, ancestry(), pidfile_session)
    if len(argv) >= 2 and argv[1] == "current":
        if sid:
            print(agent, sid, pid)
        return 0
    if len(argv) >= 3 and argv[1] == "register":
        if not sid or agent == "claude":
            return 0   # Claude Code sessions are read from its own pidfiles.
        register(STATE_DIR, agent, pid, sid, os.getcwd(), argv[2], argv[3] if len(argv) > 3 else "")
        return 0
    print(__doc__.strip(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
