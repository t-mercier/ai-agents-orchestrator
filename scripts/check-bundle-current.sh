#!/usr/bin/env bash
# Drift guard for the vendored renderer/xterm-bundle.js.
#
# The bundle is committed (vendored) so a clone runs without a build step, but it
# is generated from build/xterm-entry.js + the xterm dependencies via
# `npm run build:xterm`. It goes stale — silently — whenever one of its inputs
# changes without the committed copy being regenerated:
#   1. build/xterm-entry.js is edited (its imports/exports change),
#   2. an xterm dependency version changes (xterm, @xterm/addon-*, …),
#   3. esbuild's version/flags change.
# Nothing rebuilds it on `npm install` or `cargo tauri build`, so the stale copy
# ships unnoticed. This regenerates it and fails if the committed bundle differs.
#
# Run locally (`npm run check:bundle`) and in CI. Needs node_modules (npm ci).
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build:xterm >/dev/null

if ! git diff --quiet -- renderer/xterm-bundle.js; then
  echo "ERROR: renderer/xterm-bundle.js is out of date with its sources." >&2
  echo "An input changed (build/xterm-entry.js, an xterm dependency, or esbuild)" >&2
  echo "but the committed bundle was not regenerated. Fix with:" >&2
  echo "    npm run build:xterm && git add renderer/xterm-bundle.js" >&2
  echo "then commit the result." >&2
  git --no-pager diff --stat -- renderer/xterm-bundle.js >&2
  exit 1
fi

echo "renderer/xterm-bundle.js is current."
