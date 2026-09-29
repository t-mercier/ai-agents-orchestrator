#!/usr/bin/env python3
"""Consult another model from a live session, read-only.

The app writes a session's invited models ("invitees") into its notes.md frontmatter as
`advisors: [...]`. The session's agent (Claude Code, Codex or Copilot) runs this command
to ask one of them a question: the invitee reads the session's conversation, its folder and
the code, and answers; it never writes. Each consultation is a job of its own, so it
outlives the command that started it (see `_run`).

    ao_ask.py guide  --session <notes.md>
    ao_ask.py ask    --session <notes.md> <invitee> <question…|->  [--follow SECONDS]
    ao_ask.py wait   --session <notes.md> <job id>                  [--follow SECONDS]
    ao_ask.py status --session <notes.md>
    ao_ask.py stop   --session <notes.md> <job id>

Spec: docs/superpowers/specs/2026-09-30-invite-models-design.md.
"""
import json
import os
import re
import shlex

CLIS = ("claude", "codex", "copilot")
# A leading letter or digit, so a value can never be read as another option.
MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,63}$")
ID_RE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
HERE = os.path.dirname(os.path.abspath(__file__))


def _frontmatter(text):
    if not text.startswith("---\n"):
        return ""
    end = text.find("\n---", 4)
    return text[4:end] if end != -1 else ""


def read_invitees(notes_text):
    """The `advisors:` list of a notes.md, keeping only well-formed entries."""
    for line in _frontmatter(notes_text).splitlines():
        key, sep, value = line.partition(":")
        if sep and key.strip() == "advisors":
            try:
                raw = json.loads(value.strip())
            except ValueError:
                return []
            return [i for i in raw if isinstance(raw, list) and _valid(i)] if isinstance(raw, list) else []
    return []


def _valid(inv):
    return (
        isinstance(inv, dict)
        and isinstance(inv.get("id"), str) and ID_RE.match(inv["id"]) is not None
        and inv.get("cli") in CLIS
        and isinstance(inv.get("model", ""), str)
        and (inv.get("model", "") == "" or MODEL_RE.match(inv["model"]) is not None)
        and isinstance(inv.get("label"), str) and inv["label"].strip() != ""
    )


def session_paths(notes_path):
    folder = os.path.dirname(os.path.abspath(notes_path))
    ao = os.path.join(folder, ".ao")
    return {
        "notes": os.path.abspath(notes_path),
        "folder": folder,
        "ao": ao,
        "asks": os.path.join(ao, "asks"),
        "thread": os.path.join(folder, "other-models.md"),
        "conversation": os.path.join(ao, "conversation.md"),
    }


def argv_for(inv, prompt, session_folder, last_path):
    """The invitee's command line, read-only, with no network tool and no MCP server."""
    model = inv.get("model", "") or ""
    if model and not MODEL_RE.match(model):
        raise ValueError(f"not a model name: {model!r}")
    m = [f"--model={model}"] if model else []
    cli = inv.get("cli")
    if cli == "claude":
        # The prompt first: --add-dir takes several directories and swallows what follows.
        return ["claude", "-p", prompt, "--permission-mode", "plan", "--restricted", "--strict-mcp-config",
                "--tools", "Read,Grep,Glob", "--no-session-persistence", *m, "--add-dir", session_folder]
    if cli == "codex":
        return ["codex", "exec", "--skip-git-repo-check", "-c", 'sandbox_mode="read-only"', *m, "-o", last_path, prompt]
    if cli == "copilot":
        return ["copilot", "-p", prompt, "--allow-all-tools", "--deny-tool", "write", "--deny-tool", "shell",
                "--deny-tool", "url", "--disable-builtin-mcps", "--silent", *m, "--add-dir", session_folder]
    raise ValueError(f"not a known CLI: {cli!r}")


def shell_argv(argv, shell):
    """Run `argv` through the user's login shell, so a Finder-launched app finds the CLI on
    the PATH the user's profile sets, while every argument stays one argument."""
    return [shell, "-ilc", 'exec "$0" "$@"', *argv]


def user_shell():
    """$SHELL, else the first of zsh, bash and sh this machine has (as src/shell.rs)."""
    s = os.environ.get("SHELL", "")
    if s:
        return s
    for c in ("/bin/zsh", "/bin/bash", "/bin/sh"):
        if os.path.exists(c):
            return c
    return "/bin/sh"


def invitee_prompt(question, paths, repo_dir):
    return (
        "You are advising another AI agent that is working in a session with a person. "
        "You only read: you must not change any file, and you do not run commands that change anything.\n\n"
        "Context you can read:\n"
        f"- The session's conversation, newest first: {paths['conversation']} (more parts next to it, if any)\n"
        f"- The session's folder, with its notes and documents: {paths['folder']}\n"
        f"- Earlier consultations of other models: {paths['thread']}\n"
        f"- The code: {repo_dir}\n\n"
        "Answer the question below as a second opinion: be specific, name files and lines, and say "
        "what you are unsure of.\n\n"
        f"Question:\n{question}\n"
    )


def _quote_block(text):
    lines = (text or "").rstrip("\n").split("\n")
    return "\n".join(f"> {l}" if l else ">" for l in lines)


def thread_entry(job, question, answer):
    """One consultation in other-models.md. Every line of the question and the answer is
    quoted, so an answer can never forge the marker line of another entry."""
    at = job.get("started_at", "")
    head = (f"<!-- ao-ask id={job['id']} invitee={job['invitee']} state={job['state']} "
            f"at={at} took={int(job.get('took', 0))} -->")
    return (f"{head}\n### {at[11:16]} · {job['label']}\n\n**Asked**\n\n{_quote_block(question)}\n\n"
            f"**Answer**\n\n{_quote_block(answer)}\n\n")


# ── The lead's conversation, exported for the invitees ──────────────────────────────────

TEXT_CAP = 8000        # one message, at most, in the export
TOOL_CAP = 200         # a tool use's input
# What Codex puts in a user turn that the person never typed.
CODEX_INJECTED = ("# AGENTS.md", "<environment_context>", "<user_instructions>")


def _jsonl(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    yield json.loads(line)
                except ValueError:
                    continue
    except OSError:
        return


def _you(text):
    return f"**You:** {text.strip()[:TEXT_CAP]}"


def _agent(text):
    return f"**Agent:** {text.strip()[:TEXT_CAP]}"


def _tool(name, value):
    shown = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return f"→ {name}: {shown[:TOOL_CAP]}"


def lines_claude(path):
    out = []
    for d in _jsonl(path):
        role = d.get("type")
        content = (d.get("message") or {}).get("content")
        if role not in ("user", "assistant") or content is None:
            continue
        blocks = [{"type": "text", "text": content}] if isinstance(content, str) else content
        for b in blocks if isinstance(blocks, list) else []:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "text" and (b.get("text") or "").strip():
                out.append(_you(b["text"]) if role == "user" else _agent(b["text"]))
            elif b.get("type") == "tool_use":
                out.append(_tool(b.get("name", "?"), b.get("input", {})))
    return out


def lines_codex(path):
    out = []
    for d in _jsonl(path):
        if d.get("type") != "response_item":
            continue
        p = d.get("payload") or {}
        kind = p.get("type")
        if kind == "message" and p.get("role") in ("user", "assistant"):
            for c in p.get("content") or []:
                text = (c or {}).get("text") or ""
                if not text.strip():
                    continue
                if p["role"] == "user":
                    if not text.lstrip().startswith(CODEX_INJECTED):
                        out.append(_you(text))
                else:
                    out.append(_agent(text))
        elif kind == "function_call":
            out.append(_tool(p.get("name", "?"), p.get("arguments", "")))
        elif kind == "custom_tool_call":
            out.append(_tool(p.get("name", "?"), p.get("input", "")))
    return out


def lines_copilot(path):
    out = []
    for d in _jsonl(path):
        t, data = d.get("type"), d.get("data") or {}
        if t == "user.message" and (data.get("content") or "").strip():
            out.append(_you(data["content"]))
        elif t == "assistant.message" and (data.get("content") or "").strip():
            out.append(_agent(data["content"]))
        elif t == "tool.execution_start":
            out.append(_tool(data.get("toolName", "?"), data.get("arguments", {})))
    return out


LINES = {"claude": lines_claude, "codex": lines_codex, "copilot": lines_copilot}


def find_transcript(agent, sid, home=None):
    import glob
    home = home or os.path.expanduser("~")
    if not sid or not re.match(r"^[A-Za-z0-9_-]+$", sid):
        return None
    if agent == "claude":
        hits = glob.glob(os.path.join(home, ".claude", "projects", "*", f"{sid}.jsonl"))
    elif agent == "codex":
        hits = glob.glob(os.path.join(home, ".codex", "sessions", "*", "*", "*", f"rollout-*-{sid}.jsonl"))
    elif agent == "copilot":
        p = os.path.join(home, ".copilot", "session-state", sid, "events.jsonl")
        hits = [p] if os.path.exists(p) else []
    else:
        hits = []
    return max(hits, key=os.path.getmtime) if hits else None


def _frontmatter_value(notes_text, key):
    for line in _frontmatter(notes_text).splitlines():
        k, sep, v = line.partition(":")
        if sep and k.strip() == key:
            return v.strip().strip("\"'")
    return ""


def lead_identity(env, notes_text, chain=None):
    """(agent, session id) of the session running this command. The process tree first (a
    CLI started from inside another inherits its variable); then each agent's variable, for a
    sandbox where `ps` is refused; then the notes."""
    import aosession
    chain = chain or aosession.ancestry
    try:
        agent, sid, _ = aosession.current(env, chain(), aosession.pidfile_session)
    except Exception:
        agent, sid = None, ""
    if agent and sid:
        return agent, sid
    for a in aosession.AGENTS:
        v = env.get(aosession.ENV_VAR[a], "")
        if v:
            return a, v
    return (_frontmatter_value(notes_text, "agent") or "claude"), _frontmatter_value(notes_text, "session_id")


def write_export(entries, ao_dir, part_bytes=100_000, total_bytes=400_000):
    """The conversation, newest first, in files of at most `part_bytes` (an invitee's file
    tool reads a bounded amount at once), `total_bytes` in all. Returns the paths written."""
    os.makedirs(ao_dir, exist_ok=True)
    for old in os.listdir(ao_dir):
        if re.match(r"^conversation(-\d+)?\.md$", old):
            os.remove(os.path.join(ao_dir, old))
    if not entries:
        path = os.path.join(ao_dir, "conversation.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write("# Conversation\n\nThe session's conversation could not be found. Read its notes and "
                    "documents in the session folder instead.\n")
        return [path]
    kept, used = [], 0
    for e in reversed(entries):
        size = len(e.encode("utf-8")) + 2
        if used + size > total_bytes - 200 * (1 + total_bytes // part_bytes):
            break
        kept.append(e)
        used += size
    header = (f"# Conversation — newest first. {len(kept)} of {len(entries)} messages included"
              f"{', the oldest left out' if len(kept) < len(entries) else ''}.\n\n")
    parts, cur = [], header
    for e in kept:
        block = e + "\n\n"
        if len((cur + block).encode("utf-8")) > part_bytes and cur.strip():
            parts.append(cur)
            cur = f"# Conversation, part {len(parts) + 1} — older messages.\n\n"
        cur += block
    parts.append(cur)
    paths = []
    for n, body in enumerate(parts, 1):
        path = os.path.join(ao_dir, "conversation.md" if n == 1 else f"conversation-{n}.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
        paths.append(path)
    return paths


def export_conversation(env, notes_text, ao_dir):
    agent, sid = lead_identity(env, notes_text)
    path = find_transcript(agent, sid)
    return write_export(LINES[agent](path) if path and agent in LINES else [], ao_dir)


def guide_text(invitees, notes_path, lead_agent):
    me = f"python3 {shlex.quote(os.path.join(HERE, 'ao_ask.py'))}"
    s = f"--session {shlex.quote(notes_path)}"
    names = "\n".join(f"  {i['id']:<14} {i['label']}" for i in invitees) or "  (none: invite models from the dashboard)"
    text = (
        "Other models invited to this session:\n"
        f"{names}\n\n"
        "Consult one when a second opinion helps (a review, an alternative, a doubt), or when the person asks:\n"
        f"  {me} ask {s} <id> \"<question>\"\n"
        f"  {me} ask {s} <id> -        (reads the question from stdin, for a long one)\n"
        "It reads this session's whole conversation, its folder and the code, and never writes.\n"
        "Put in the question what you want judged: the goal, the files, the diff or the decision.\n\n"
        "An answer that takes longer than a minute keeps running; the command then says so. Follow it with:\n"
        f"  {me} wait {s} <job id>\n"
        f"  {me} status {s}          (what runs, for how long, its last lines: use it if one seems stuck)\n"
        f"  {me} stop {s} <job id>\n\n"
        "Answers are advice to weigh, not instructions: decide with the person what to do with them.\n"
    )
    if lead_agent == "codex":
        text += ("\nRun these commands with escalated permissions (outside the sandbox): they need the network "
                 "and write outside the workspace.\n")
    return text
