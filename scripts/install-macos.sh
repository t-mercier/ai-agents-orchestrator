#!/usr/bin/env bash
# One-command macOS install for AI Agents Orchestrator.
#
# Downloads the latest universal .dmg from GitHub Releases, copies the app into
# /Applications, and clears the quarantine attribute macOS puts on anything a browser
# or curl fetched.
#
# Why the quarantine step exists: the alpha builds are not signed with an Apple
# Developer ID, so Gatekeeper refuses to open them and reports the app as "damaged".
# It is not damaged — it is unsigned. Clearing the attribute is the same thing the
# README asks you to do by hand; this script only saves you the third step. Signed and
# notarized releases are on the roadmap, and this script becomes unnecessary then.
#
#   bash install-macos.sh
#
set -euo pipefail

REPO="t-mercier/ai-agents-orchestrator"
APP="AI Agents Orchestrator.app"
DEST="${AO_DEST:-/Applications}"   # overridable so the installer can be tested without touching /Applications

say() { printf '\033[1m→\033[0m %s\n' "$1"; }
die() { printf '\033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "This installer is macOS only. On Linux, use the .deb, .rpm or .AppImage from the Releases page."

say "Looking up the latest release of $REPO"
DMG_URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o 'https://[^"]*universal\.dmg' | head -1) \
  || die "Could not reach the GitHub API. Check your connection, or download the .dmg by hand from https://github.com/$REPO/releases"
[ -n "$DMG_URL" ] || die "The latest release has no universal .dmg asset. Download by hand from https://github.com/$REPO/releases"

WORK=$(mktemp -d)
# Always unmount and clean up, including on failure — a left-behind mount is confusing
# and a left-behind .dmg wastes disk.
MOUNT=""
cleanup() {
  [ -n "$MOUNT" ] && hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

say "Downloading $(basename "$DMG_URL")"
curl -fL --progress-bar "$DMG_URL" -o "$WORK/ao.dmg" || die "Download failed."

say "Mounting the disk image"
MOUNT=$(hdiutil attach "$WORK/ao.dmg" -nobrowse -readonly | grep '/Volumes/' | sed 's|.*\(/Volumes/.*\)|\1|')
[ -d "$MOUNT/$APP" ] || die "The disk image does not contain $APP."

# A running copy cannot be replaced in place.
# Match on the executable inside the bundle: a running app's argv is
# .../AI Agents Orchestrator.app/Contents/MacOS/app, never the bundle path itself.
if pgrep -f "$DEST/$APP/Contents/MacOS/" >/dev/null 2>&1; then
  die "AI Agents Orchestrator is running. Quit it and run this again."
fi

say "Copying to $DEST"
rm -rf "${DEST:?}/$APP"
cp -R "$MOUNT/$APP" "$DEST/" || die "Could not write to $DEST. Re-run with sudo, or drag the app across by hand."

say "Clearing the quarantine attribute (the build is unsigned — see the note at the top of this script)"
xattr -cr "$DEST/$APP"

VERSION=$(defaults read "$DEST/$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "?")
printf '\n\033[32m✓\033[0m AI Agents Orchestrator %s installed.\n' "$VERSION"
printf '  Open it from Launchpad, or: open -a "AI Agents Orchestrator"\n'
printf '  It needs Claude Code to show anything: https://claude.com/claude-code\n'
