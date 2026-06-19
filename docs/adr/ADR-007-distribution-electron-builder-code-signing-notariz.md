# ADR-007 — Distribution: electron-builder + code-signing + notarization in v1.0, auto-update deferred to v1.1

**Status:** APPROVED

## Context

Current app is dev-only (npm start). For OSS distribution on macOS 10.15+, users expect signed .dmg; unsigned .app gets Gatekeeper hard-block. electron-builder handles codesign + notarization with 100-line config. GitHub Actions CI provides macOS runners (arm64 on latest, x64 on macos-13). Auto-update (electron-updater) adds 5 lines of main.js + requires version management, staged rollout complexity (not critical for v1.0). Homebrew adds 1 file + 1 CI job (trivial once DMG works). v1.0 priority: get DMG working, notarized, distributable. v1.1 priority: convenience (auto-update, brew install).

## Decision

v1.0 ships code-signed, Apple-notarized .dmg via electron-builder in GitHub Actions CI. Users download .dmg, Gatekeeper approves due to notarization signature. v1.1 adds electron-updater background auto-update + Homebrew cask convenience (deferring these to v1.1 reduces v1.0 scope + validation risk). Homebrew tap optional in v1.0 if demand high (1 file + 1 CI job, low effort once DMG working).

## Consequences

Add electron-builder.config.js (~100 lines): build targets [dmg, zip], code-sign config (Developer ID cert + password from GitHub Secrets), notarize hook (Apple notarization service via electron-notarize). Add .github/workflows/release.yml (~80 lines): on git tag v*, build, sign, notarize, publish to GitHub Releases. Requires GitHub Secrets: APPLE_ID (email), APPLE_ID_PASSWORD (app-specific password), APPLE_TEAM_ID (from Apple Developer account). Per-arch build (arm64+x64) handled by electron-builder's native.buildFor or via matrix build jobs. Cost: one-time 3-4 hour setup, recurring 15-20 min per release (GitHub Actions runtime ~10 min, notarization wait ~5-10 min). Benefit: signed .dmg that users safely download (no Gatekeeper warnings), professional distribution, community trust.


## Alternatives rejected

(1) Ship unsigned for v1.0: users see Gatekeeper warnings 'Unknown developer', must manually allow via System Preferences (confuses non-technical users, poor UX). (2) Defer all packaging to v1.1: v1.0 stays dev-only (npm start), community can't easily test or adopt. (3) Add auto-update in v1.0: complicates release workflow (must manage version numbers, update channel, staged rollout); not justified for initial release. (4) Skip notarization: users on macOS 12+ get hard Gatekeeper blocks; unacceptable for any distribution.

