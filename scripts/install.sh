#!/usr/bin/env bash
# Install the bundled session skills + seed the shared config.
#
#   bash scripts/install.sh              # install (won't overwrite existing skills)
#   bash scripts/install.sh --force      # replace this app's skills (yours untouched)
#   bash scripts/install.sh --with-hooks # print the settings.json lines that ENABLE the hooks
#                                        (the scripts themselves are copied by every run)
#
# Copies skills/* → ~/.claude/skills/, writes a default config if none exists, and
# creates the category folders. Never touches your session data.
set -euo pipefail
shopt -s nullglob

usage() {
  cat <<'USAGE'
Install the bundled session skills + seed the shared config.

  bash scripts/install.sh                 install (keeps skills you already have)
  bash scripts/install.sh --force         replace THIS APP'S skills with this checkout's
                                          (your own are never in scope; a copy of one of
                                          the 14 that you had changed is archived first)
  bash scripts/install.sh --with-hooks    print the settings.json lines that ENABLE the two
                                          hooks (never edits the file). The scripts are
                                          copied by every run, flag or not.
  bash scripts/install.sh --all           everything: --force + --with-hooks

Only the 14 skills this app ships are ever touched, by name. Every other skill in
~/.claude/skills/ is invisible to this script. The flags combine, and re-running is safe.
USAGE
}
FORCE=0; HOOKS=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --with-hooks) HOOKS=1 ;;
    --all) FORCE=1; HOOKS=1 ;;
    -h|--help) usage; exit 0 ;;
    # A typo'd flag used to be dropped in silence — `--with-hook` installed no hook and
    # said nothing, which is the worst outcome for an option you must know about to use.
    *) echo "unknown option: $arg" >&2; echo >&2; usage >&2; exit 2 ;;
  esac
done
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_SRC="$HERE/skills"
SKILLS_DST="$HOME/.claude/skills"
CONFIG_DIR="$HOME/.config/ai-agents-orchestrator"
CONFIG="$CONFIG_DIR/config.json"

echo "AI Agents Orchestrator — installing skills + config"
echo

# 1. Shared helper (always refreshed — not user-customised)
mkdir -p "$SKILLS_DST/lib"
cp "$SKILLS_SRC/lib/"*.py "$SKILLS_DST/lib/"
echo "installed: lib/ (config helper)"

# 2. Skills (don't clobber a user's customised skill without --force)
STALE=(); ARCHIVED=()
for d in "$SKILLS_SRC"/*/; do
  name="$(basename "$d")"
  [ "$name" = "lib" ] && continue
  dst="$SKILLS_DST/$name"
  if [ -e "$dst" ] && [ "$FORCE" -ne 1 ]; then
    echo "skip (exists): /$name  — use --force to overwrite"
    # Skipping an IDENTICAL copy is a no-op; skipping a CHANGED one silently leaves the
    # user on an old version, which is how a shipped fix quietly fails to arrive.
    diff -rq "$d" "$dst" >/dev/null 2>&1 || STALE+=("$name")
  else
    # Back up before overwriting, the way the app's sync does. "Hand-edited" is dst
    # differing from the pristine .ao-base snapshot; with no snapshot to compare against
    # (a pre-.ao-base install) fall back to "differs from what we are about to write",
    # which over-archives at worst. An untouched copy is not archived — that would bury
    # the real backups under one per run.
    if [ -e "$dst" ]; then
      base="$SKILLS_DST/.ao-base/$name"
      ref="$d"; [ -d "$base" ] && ref="$base"
      if ! diff -rq "$ref" "$dst" >/dev/null 2>&1; then
        stamp="$(date +%s)"
        mkdir -p "$SKILLS_DST/.archive"
        cp -R "$dst" "$SKILLS_DST/.archive/$name.pre-sync-$stamp"
        echo "  backed up your version → ~/.claude/skills/.archive/$name.pre-sync-$stamp"
        ARCHIVED+=("$name")
      fi
    fi
    rm -rf "$dst"; cp -R "$d" "$dst"; echo "installed skill: /$name"
    # Mirror the pristine snapshot the app's installer keeps (src-tauri/src/skills.rs):
    # the app's launch sync compares each skill against .ao-base/<name> to tell "edited
    # by hand" (back it up first) from "just stale" (overwrite plainly). A skill this
    # script wrote without refreshing its base would look hand-edited to the app forever.
    rm -rf "$SKILLS_DST/.ao-base/$name"
    mkdir -p "$SKILLS_DST/.ao-base"
    cp -R "$d" "$SKILLS_DST/.ao-base/$name"
  fi
done

# Stamp the same marker the app's own installer writes (src-tauri/src/skills.rs), so
# whichever ran LAST — this script or the app's Settings button — leaves a record the
# other side can compare against. The date is written only when nothing above is stale: a
# STALE entry means the tree does NOT fully match this checkout, and claiming this
# checkout's date here would tell a later, older app build "you'd be going backward" when
# you wouldn't. The checkout PATH is recorded every time, stale or not — it is how the app
# later notices that a `git pull` moved skills/ or hooks/ past what is installed, and
# offers to re-run this script. Only this script can know that path; the app cannot.
epoch=""
if [ ${#STALE[@]} -eq 0 ]; then
  epoch="$(git -C "$HERE" log -1 --format=%ct -- skills hooks 2>/dev/null || true)"
fi
AO_MANIFEST="$SKILLS_DST/.ao-install-manifest.json" AO_REPO="$HERE" AO_EPOCH="$epoch" python3 - <<'PY' 2>/dev/null || true
import json, os
path = os.environ["AO_MANIFEST"]
try:
    with open(path) as f:
        m = json.load(f)
    if not isinstance(m, dict):
        m = {}
except Exception:
    m = {}
m["repo"] = os.environ["AO_REPO"]
if os.environ["AO_EPOCH"]:
    m["bundle_epoch"] = int(os.environ["AO_EPOCH"])
with open(path, "w") as f:
    json.dump(m, f)
PY

# 3. Seed the config if absent (the app's Settings edits the same file)
mkdir -p "$CONFIG_DIR"
if [ ! -f "$CONFIG" ]; then
  cat > "$CONFIG" <<'JSON'
{
  "version": 2,
  "roots": [
    { "name": "Work",  "path": "~/work", "vaultPath": "" },
    { "name": "Perso", "path": "~", "vaultPath": "" }
  ],
  "categories": [
    { "name": "FEAT",   "color": "#7df0c0", "root": "Work" },
    { "name": "BUG",    "color": "#ff9eb1", "root": "Work" },
    { "name": "REVIEW", "color": "#d9a86e", "root": "Work" },
    { "name": "CHORE",  "color": "#ffe17a", "root": "Work" },
    { "name": "TEST",   "color": "#cdd0d6", "root": "Work" },
    { "name": "PERSO",  "color": "#8fd9ff", "root": "Perso" }
  ],
  "knowledge": { "enabled": false },
  "ticketBaseUrl": ""
}
JSON
  echo "wrote default config: $CONFIG"
else
  echo "config exists (kept): $CONFIG"
fi

# 4. Create each category's folder (so /start-session has somewhere to write)
echo "creating category folders:"
python3 "$SKILLS_DST/lib/aoconfig.py" categories | while IFS= read -r cat; do
  [ -z "$cat" ] && continue
  base="$(python3 "$SKILLS_DST/lib/aoconfig.py" base "$cat")"
  mkdir -p "$base" && echo "  $base"
done

# 5. The hooks. Copying the scripts is inert — a hook nothing references never runs — so
# it happens unconditionally, exactly like the skills. WIRING them is the part that is not
# inert, so the settings.json entry is printed for you to paste: this installer never edits
# the file that decides which code Claude Code runs on your machine.
# ($HOOKS only decides whether the entries are printed; --with-hooks is kept as an alias
# for that, since the README and muscle memory both still reach for it.)
mkdir -p "$HOME/.claude/hooks"
for h in ao_autosave ao_precompact ao_session_start pr_attach learn_nudge; do
  cp "$HERE/hooks/$h.py" "$HOME/.claude/hooks/$h.py"
done
echo "installed hooks: ~/.claude/hooks/{ao_autosave,ao_precompact,ao_session_start,pr_attach,learn_nudge}.py"
echo "  Sessions started from the app run all five already (they ride in its --settings file)."
echo "  Enabling them in settings.json extends that to sessions you start from a terminal."
if [ "$HOOKS" -eq 1 ]; then
  mkdir -p "$HOME/.claude/hooks"
  cp "$HERE/hooks/pr_attach.py" "$HOME/.claude/hooks/pr_attach.py"
  echo
  echo "installed hook script: ~/.claude/hooks/pr_attach.py"
  echo "  To enable it, add this PostToolUse group to ~/.claude/settings.json (the matcher is a"
  echo "  regex: gh in a Bash call, or the GitHub MCP server's create tool):"
  echo '    { "matcher": "Bash|mcp__.*__create_pull_request", "hooks": [ { "type": "command", "command": "IN=$(cat); printf '"'"'%s'"'"' \"$IN\" | python3 \"$HOME/.claude/hooks/pr_attach.py\" 2>/dev/null; true" } ] }'
  echo "  It attaches a PR to the session notes the moment \`gh pr create\`/\`edit\`/\`reopen\` or the MCP"
  echo "  tool returns its URL."
  echo
  cp "$HERE/hooks/learn_nudge.py" "$HOME/.claude/hooks/learn_nudge.py"
  echo "installed hook script: ~/.claude/hooks/learn_nudge.py"
  echo "  To enable it, add this to the UserPromptSubmit hooks in ~/.claude/settings.json:"
  echo '    { "hooks": [ { "type": "command", "command": "python3 \"$HOME/.claude/hooks/learn_nudge.py\" 2>/dev/null; true" } ] }'
  echo "  It nudges the model to check /learn or /skill-propose the moment a message reads"
  echo "  like a standing preference or correction (\"always\", \"from now on\", \"ne ... plus\"...)."
  echo
  echo "installed hook scripts: ~/.claude/hooks/ao_autosave.py, ao_precompact.py, ao_session_start.py"
  echo "  To enable them, add to the Stop, PreCompact and SessionStart hooks respectively:"
  echo '    { "hooks": [ { "type": "command", "command": "python3 \"$HOME/.claude/hooks/ao_autosave.py\" 2>/dev/null; true" } ] }'
  echo '    { "hooks": [ { "type": "command", "command": "python3 \"$HOME/.claude/hooks/ao_precompact.py\" 2>/dev/null; true" } ] }'
  echo '    { "hooks": [ { "type": "command", "command": "python3 \"$HOME/.claude/hooks/ao_session_start.py\" 2>/dev/null; true" } ] }'
  echo "  Auto-save at 60%/80% of context and after 30 min without a checkpoint; a history line"
  echo "  before each compaction; the /learn habit stated at every session start."
  echo "  (The first-run setup in the app writes these for you, with a preview and a backup.)"
fi

echo
if [ ${#ARCHIVED[@]} -gt 0 ]; then
  echo "↳ ${#ARCHIVED[@]} skill(s) you had changed were backed up before being replaced:"
  printf '    /%s\n' "${ARCHIVED[@]}"
  echo "  Copies are in ~/.claude/skills/.archive/ — nothing was lost."
  echo
fi
if [ ${#STALE[@]} -gt 0 ]; then
  echo "⚠ ${#STALE[@]} installed skill(s) are OLDER than this version and were kept:"
  printf '    /%s\n' "${STALE[@]}"
  echo "  Their updates did NOT arrive. If you have not customised them, re-run:"
  echo "    bash scripts/install.sh --force"
  echo
fi
if [ "$HOOKS" -eq 0 ]; then
  echo "→ The two hooks are copied but not ENABLED — enabling one means adding a line to"
  echo "  ~/.claude/settings.json, which this installer will not do for you. Re-run with"
  echo "  --with-hooks (or --all) to print the exact lines to paste, or enable them from"
  echo "  the app: Settings → first-run setup, last step, shows the diff and backs the file up."
  echo "    pr_attach.py   attaches a PR to the session notes the moment \`gh pr create\` opens it"
  echo "    learn_nudge.py nudges /learn when your own wording states a preference or correction"
  echo
fi
echo "✓ Done. Edit categories/colors/paths in the app's Settings (⚙), or in $CONFIG."
echo "→ Note: nothing here uses or creates a git worktree — a session's folder holds its"
echo "  notes, not a checkout. If you happen to work with worktrees anyway, the Superpowers"
echo "  plugin (unrelated to this app) has skills for them:"
echo "    https://github.com/obra/superpowers"
printf 'Skills available now:'
for d in "$SKILLS_SRC"/*/; do
  name="$(basename "$d")"
  [ "$name" = "lib" ] && continue
  printf '  /%s' "$name"
done
echo
