#!/usr/bin/env bash
# ao-statusline.sh — feed the ai-agents-orchestrator dashboard's usage bar.
#
# Claude Code hands the rate-limit + context data to the `statusLine` command on stdin and
# nowhere else — it's never written to disk. This wrapper captures that stdin, writes it to
# ~/.claude/statusline-cache.json (which the dashboard reads, read-only), then delegates to
# your real statusline command so your terminal statusline is unchanged.
#
# Setup — point Claude Code's statusLine at this wrapper, passing your real statusline
# command as the argument (in ~/.claude/settings.json):
#
#   "statusLine": {
#     "type": "command",
#     "command": "/ABS/PATH/ao-statusline.sh /ABS/PATH/your-statusline.sh"
#   }
#
# If you don't have a statusline of your own, drop the argument — the wrapper just writes
# the cache and prints nothing. Failures never break your statusline (cache write is
# best-effort). The dashboard only READS the cache; it never writes your config.
set -u
INPUT="$(cat)"
CACHE="$HOME/.claude/statusline-cache.json"

# Best-effort cache write. INPUT is passed via env (AO_INPUT), NOT stdin: `python3 -`
# reads its PROGRAM from stdin (this heredoc), so a piped stdin would be discarded.
AO_INPUT="$INPUT" python3 - "$CACHE" 2>/dev/null <<'PY' || true
import json, os, sys, time
try:
    d = json.loads(os.environ.get("AO_INPUT", "{}"))
except Exception:
    sys.exit(0)
def num(v):
    try: return round(float(v))
    except Exception: return None
def dig(o, path):
    for k in path.split('.'):
        o = o.get(k) if isinstance(o, dict) else None
    return o
def parse_reset_time(val):
    if val is None: return None
    if isinstance(val, (int, float)):
        if val < 1e6:   return int((time.time() + val) * 1000)
        elif val < 1e10: return int(val * 1000)
        else:            return int(val)
    if isinstance(val, str):
        try:
            from datetime import datetime
            return int(datetime.fromisoformat(val.replace('Z', '+00:00')).timestamp() * 1000)
        except Exception:
            return None
    return None
def reset_for(rl, *keys):
    for key in keys:
        r = rl.get(key) if isinstance(rl, dict) else None
        if isinstance(r, dict):
            for rk in ["resets_at", "resets_in_seconds", "reset_at", "reset_time"]:
                p = parse_reset_time(r.get(rk))
                if p is not None: return p
    return None

# Load previous cache; migrate a legacy flat object into the keyed shape.
prev = {}
try:
    with open(sys.argv[1]) as f: prev = json.load(f)
    if not isinstance(prev, dict): prev = {}
except Exception:
    prev = {}
if "global" not in prev and "sessions" not in prev and prev:
    prev = {"global": {k: prev[k] for k in
            ("fiveHourPct","sevenDayPct","fiveHourResetsAt","sevenDayResetsAt","updatedAt") if k in prev},
            "sessions": {}}
g_prev = prev.get("global") if isinstance(prev.get("global"), dict) else {}
sessions = prev.get("sessions") if isinstance(prev.get("sessions"), dict) else {}

now = int(time.time() * 1000)
rl = dig(d, "rate_limits")
def keepg(newv, key): return newv if newv is not None else g_prev.get(key)
g = {
    "fiveHourPct": keepg(num(dig(d, "rate_limits.five_hour.used_percentage")), "fiveHourPct"),
    "sevenDayPct": keepg(num(dig(d, "rate_limits.seven_day.used_percentage")), "sevenDayPct"),
    "updatedAt": now,
}
fh = reset_for(rl, "five_hour", "five-hour")
sd = reset_for(rl, "seven_day", "seven-day")
fh = fh if fh is not None else g_prev.get("fiveHourResetsAt")
sd = sd if sd is not None else g_prev.get("sevenDayResetsAt")
if fh is not None: g["fiveHourResetsAt"] = fh
if sd is not None: g["sevenDayResetsAt"] = sd

# Per-session model + context (merge-preserve), keyed by session_id when present.
sid = dig(d, "session_id")
if isinstance(sid, str) and sid:
    s_prev = sessions.get(sid) if isinstance(sessions.get(sid), dict) else {}
    model = dig(d, "model.display_name") or s_prev.get("model")
    ctx = num(dig(d, "context_window.used_percentage"))
    ctx = ctx if ctx is not None else s_prev.get("contextPct")
    sessions[sid] = {"model": model, "contextPct": ctx, "updatedAt": now}

out = {"global": g, "sessions": sessions}
p = sys.argv[1]
tmp = p + ".tmp"
with open(tmp, "w") as f:
    json.dump(out, f)
os.replace(tmp, p)
PY

# Delegate to your real statusline command (if provided), preserving its output verbatim.
if [ "$#" -ge 1 ] && [ -n "$1" ]; then
  if [ -x "$1" ]; then printf '%s' "$INPUT" | "$1"; else printf '%s' "$INPUT" | bash "$1"; fi
fi
