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
import json, os, sys, time, re
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
    """Parse a reset time value (ISO string, seconds from now, or epoch seconds).
    Returns epoch milliseconds, or None if unparseable."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        # If it looks like seconds-from-now (< 10^9 or a reasonable relative time),
        # add to current time. If > 10^12, treat as epoch ms. If ~10^9-10^12, treat as epoch seconds.
        if val < 1e6:  # < ~11 days in seconds → likely relative
            return int((time.time() + val) * 1000)
        elif val < 1e10:  # ~10 year range in seconds → epoch seconds
            return int(val * 1000)
        else:  # >= 10^10 → likely epoch ms
            return int(val)
    if isinstance(val, str):
        # Try ISO 8601 parse (e.g., "2026-07-01T12:34:56Z")
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(val.replace('Z', '+00:00'))
            return int(dt.timestamp() * 1000)
        except Exception:
            return None
    return None
# Capture reset times from rate_limits if present.
rate_limits = dig(d, "rate_limits")
rate_limits_raw = rate_limits if isinstance(rate_limits, dict) else None
fiveHourResetsAt = None
sevenDayResetsAt = None
if rate_limits and isinstance(rate_limits, dict):
    for key in ["five_hour", "five-hour"]:
        rl = rate_limits.get(key)
        if rl and isinstance(rl, dict):
            for reset_key in ["resets_at", "resets_in_seconds", "reset_at", "reset_time"]:
                v = rl.get(reset_key)
                if v is not None:
                    parsed = parse_reset_time(v)
                    if parsed is not None:
                        fiveHourResetsAt = parsed
                        break
            if fiveHourResetsAt:
                break
    for key in ["seven_day", "seven-day"]:
        rl = rate_limits.get(key)
        if rl and isinstance(rl, dict):
            for reset_key in ["resets_at", "resets_in_seconds", "reset_at", "reset_time"]:
                v = rl.get(reset_key)
                if v is not None:
                    parsed = parse_reset_time(v)
                    if parsed is not None:
                        sevenDayResetsAt = parsed
                        break
            if sevenDayResetsAt:
                break
out = {
    "model": dig(d, "model.display_name") or None,
    "fiveHourPct": num(dig(d, "rate_limits.five_hour.used_percentage")),
    "sevenDayPct": num(dig(d, "rate_limits.seven_day.used_percentage")),
    "contextPct": num(dig(d, "context_window.used_percentage")),
    "updatedAt": int(time.time() * 1000),
}
if fiveHourResetsAt is not None:
    out["fiveHourResetsAt"] = fiveHourResetsAt
if sevenDayResetsAt is not None:
    out["sevenDayResetsAt"] = sevenDayResetsAt
if rate_limits_raw is not None:
    out["_rateLimitsRaw"] = rate_limits_raw
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
