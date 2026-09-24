#!/usr/bin/env bash
# Anti-secret-leak guard. Scans git-tracked files for likely committed secrets.
# Run locally (`npm run check:secrets`) and in CI before publishing.
# Exit 1 if anything suspicious is found.
set -euo pipefail
cd "$(dirname "$0")/.."

# Patterns for real secret material (not config keys, not placeholders).
# Each pattern targets a token *value* shape, so referencing an env var name
# (e.g. GITHUB_PERSONAL_ACCESS_TOKEN in code) does not trip it.
patterns=(
  'ghp_[A-Za-z0-9]{30,}'                         # GitHub personal access token
  'github_pat_[A-Za-z0-9_]{40,}'                 # GitHub fine-grained PAT
  'xox[baprs]-[A-Za-z0-9-]{10,}'                 # Slack token
  'sk-[A-Za-z0-9]{20,}'                          # OpenAI-style key
  'sk-ant-[A-Za-z0-9-]{20,}'                     # Anthropic key
  'AKIA[0-9A-Z]{16}'                             # AWS access key id
  'ATATT[A-Za-z0-9_-]{20,}'                      # Atlassian/Jira API token
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'           # private key block
)

# Only scan tracked files (ignores node_modules, dist, etc. via .gitignore).
# Excluded: files whose tests hold fake tokens on purpose (secaudit detects them).
exclude=(':(exclude)src-tauri/src/secaudit.rs')

found=0
for pat in "${patterns[@]}"; do
  # -I skips binaries. The pattern goes through -e because one starts with '-'. The exit
  # status is ignored: grep and xargs return non-zero whenever a file does not match, so
  # only the output tells a finding. /dev/null keeps grep off stdin when no file is listed.
  matches=$(git ls-files -z -- . "${exclude[@]}" | xargs -0 grep -InE -e "$pat" -- /dev/null 2>/dev/null || true)
  if [ -n "$matches" ]; then
    echo "❌ Possible secret matching /$pat/:"
    echo "$matches"
    found=1
  fi
done

if [ "$found" -ne 0 ]; then
  echo ""
  echo "Secret-like content found in tracked files. Remove it and rewrite history if already pushed."
  exit 1
fi

echo "✅ No committed secrets detected."
