#!/usr/bin/env bash
# statusline-usage-piggyback.sh — feed the ai-agents-orchestrator dashboard's usage bar.
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
#     "command": "/ABS/PATH/statusline-usage-piggyback.sh /ABS/PATH/your-statusline.sh"
#   }
#
# If you don't have a statusline of your own, drop the argument — the wrapper just writes
# the cache and prints nothing. Failures never break your statusline (cache write is
# best-effort). The dashboard only READS the cache; it never writes your config.
set -u
INPUT="$(cat)"
CACHE="$HOME/.claude/statusline-cache.json"

# Best-effort cache write (python parses the stdin JSON; any error is swallowed).
printf '%s' "$INPUT" | python3 - "$CACHE" 2>/dev/null <<'PY' || true
import json, os, sys, time
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
def num(v):
    try: return round(float(v))
    except Exception: return None
def dig(o, path):
    for k in path.split('.'):
        o = o.get(k) if isinstance(o, dict) else None
    return o
out = {
    "model": dig(d, "model.display_name") or None,
    "fiveHourPct": num(dig(d, "rate_limits.five_hour.used_percentage")),
    "sevenDayPct": num(dig(d, "rate_limits.seven_day.used_percentage")),
    "contextPct": num(dig(d, "context_window.used_percentage")),
    "updatedAt": int(time.time() * 1000),
}
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
