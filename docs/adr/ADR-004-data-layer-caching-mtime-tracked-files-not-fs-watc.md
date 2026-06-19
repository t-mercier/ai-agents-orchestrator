# ADR-004 — Data layer caching: mtime-tracked files (not fs.watch), 5s TTL invalidation on poll

**Status:** APPROVED

## Context

Current reader.js rescans entire ~/.claude tree every 5s poll: readJsonl scans all running-session .jsonl files (O(lines)), scanAllNotesMd reads ALL notes.md from 6 category dirs (O(all-closed)), buildTranscriptMtimeIndex walks all projects/ folders (O(projects)). At 50+ closed sessions with 1MB+ transcripts, this is 500+ file I/O ops per poll (~50ms). Proposals for fs.watch() directory invalidation are alluring but fs.watch is fundamentally fragile: (1) macOS FSEvents can miss updates or deliver duplicates, (2) adds file descriptor overhead (~0.5KB per watched dir), (3) watch doesn't survive app suspend/resume on macOS (major laptop bug), (4) false cache coherency (might serve stale if mtime check races file write).

## Decision

Add simple file mtime cache in data/reader.js: per-sessionId cache stores {goal, activity, mtime, timestamp}. On poll, check if (now - timestamp > 5s OR file mtime changed). Re-read only if stale. Reject fs.watch() for directory-level invalidation as macOS-unreliable + file descriptor leaks.

## Consequences

Add ~40 lines to reader.js: mtime-cache Map<sessionId, {goal, activity, branch, mtime, timestamp}>. Invalidation logic: if (now - timestamp > 5000ms OR fs.statSync(notesPath).mtime > cached.mtime) then re-read else return cached. Cost per poll: one fs.stat() call (~1ms) instead of 500+ file reads (~50ms). Result: 90% I/O reduction, zero watch listener cleanup complexity, no macOS sleep bugs, clear semantics (time-based TTL). Downside: max 5s stale data (if Claude Code writes notes.md, app might not see it for up to 5s). Acceptable because: (1) human perception of 'last activity' is minute-scale, (2) app polls every 5s anyway (max stale = poll interval), (3) user can manually refresh if urgent (add 'Refresh Now' button in detail panel for <1s re-poll).


## Alternatives rejected

(1) fs.watch() for directory-level invalidation: macOS unreliable (missed/duplicate events), FD leaks on heavy workload (100+ sessions), breaks on system sleep. (2) Content-hash versioning: adds 80 lines, reads 100 bytes per file to verify hash, only marginal benefit over mtime (race window same size). (3) No caching (status quo): polled I/O thrashing; acceptable for <20 sessions, unacceptable at 50+ sessions (UI lag).

