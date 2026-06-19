# REVIEW session PR link — Design

**Date:** 2026-06-15
**Status:** approved (brainstorm) → ready for plan

## Goal

For `REVIEW`-category sessions, attach the GitHub PR being reviewed so the dashboard
shows a one-click GitHub icon to open it. The link can be set when creating a session
(`+New`) **and** added/edited on an existing session from the app.

## Why

Tim's REVIEW sessions (e.g. William's PRs) carry only a PR *number* in the session
name today (`name: … (PR 35)`) — no URL anywhere. The GitHub action icon (`prPill`)
already exists and renders from `s.prLink`, but nothing populates `prLink`. Most
REVIEW sessions already exist (created via the `/start` skill in a terminal, not the
`+New` form), so a `+New`-only field would not help them — hence the in-app editor.

## Architecture

Single source of truth: a `pr_link:` line in each session's `notes.md` frontmatter.
Three flows touch it:

1. **Create** (`+New`, REVIEW only) — the form passes the URL through `start_session`
   (Rust) into the `claude /start …` command; the `/start` skill writes `pr_link:`
   into the new `notes.md` frontmatter. The app itself writes nothing here (the skill
   is the writer, consistent with ADR-001).

2. **Edit in-app** (any REVIEW session) — a new Rust command `set_pr_link(notes_path,
   url)` rewrites the `pr_link:` frontmatter line in place (add / replace / clear).
   This is the app's **second** bounded source-of-truth write (the first being the
   archive write). It reuses the archive write's safety pattern: the target path must
   resolve under a configured root, the URL is validated, and the write is atomic
   (temp + rename). Documented in an ADR (folded into resolving the existing 013→014
   number clash — see Open items).

3. **Read** (`reader.rs`) — `pr_link` is parsed from frontmatter for both running and
   historical sessions and emitted as `prLink`, which the existing `prPill` renders.

## Components

### Frontmatter key
- `pr_link: <url>` — a GitHub PR URL. Empty / absent = no link.

### URL validation (shared shape, enforced in Rust; mirrored in JS for fast UX)
- Must match `^https://github\.com/[^/\s]+/[^/\s]+/pull/\d+(\b|/|#|\?).*$` (host
  `github.com`, an `owner/repo`, `/pull/<number>`). Trailing query/anchor allowed.
- Anything else is rejected with an inline error; nothing is written.

### `renderer/app.js`
- **+New form:** show the `#ns-pr` field **only** when the selected category is
  `REVIEW`. The category `<select>` `change` handler toggles the field's visibility
  (same mechanism as the existing scope toggle). The repo field stays (optional).
- On submit, when REVIEW, validate the PR URL (if non-empty) and pass `prLink` to
  `window.api.startSession({…, prLink})`. Non-REVIEW: omit it.
- **In-app editor:** a small popover input (reuse the column-picker popover pattern
  added 2026-06-14: fixed-position element, outside-click / Esc to dismiss). It holds
  one URL `<input>` + Save + (when a link exists) Remove. On Save it validates then
  calls `window.api.setPrLink(notesPath, url)`; on success it refreshes the detail
  panel (and the session list) so `prPill` updates.

### `renderer/ui.js`
- `prPill(s.prLink)` unchanged (opens the PR).
- For REVIEW sessions in the detail Actions toolbar:
  - **no link** → render an **`＋ Add PR link`** button (`data-pr-edit="<notesPath>"`).
  - **link present** → render `prPill` (opens PR) **plus** a small **✎** button
    (`data-pr-edit="<notesPath>"`) that opens the same popover to edit / remove.
- The `[data-pr-edit]` click is handled in the delegated handler → opens the popover.
- Non-REVIEW sessions: no PR control changes.

### `src-tauri/src/lib.rs`
- `start_session` gains a `pr_link: String` param (trimmed; validated if non-empty;
  forwarded into the `/start` command only when present).
- New command `set_pr_link(notes_path: String, url: String) -> Result<(), String>`:
  - Reject if `url` non-empty and fails the PR-URL validator.
  - Resolve `notes_path`, require it to be a `notes.md` **under a configured root**
    (same confinement guard as `archive_session`).
  - Rewrite the frontmatter: replace an existing `pr_link:` line, insert one if
    absent (before the closing `---`), or set it empty when `url` is empty (clear).
  - Atomic write (temp + rename). Pure frontmatter-rewrite helper is unit-tested.

### `src-tauri/src/reader.rs`
- Historical: add `"prLink": fv(&fm, "pr_link")` to the emitted object.
- Running: also surface `pr_link` from the session's `notes.md` frontmatter (the
  running path already reads the notes file for goal/next-steps — extend it to also
  pull `pr_link`), taking precedence over the (vestigial) transcript `prLink`.

### `renderer/lib/tauri-api.js`
- Add `setPrLink(notesPath, url)` → `invoke('set_pr_link', {notesPath, url})`.
- Extend `startSession` to pass `prLink`.

### `/start` skill (`~/.claude/skills/start/SKILL.md` + repo copy)
- Accept an optional PR link param. When provided (or when category is REVIEW and the
  caller passed one), write `pr_link: <url>` into the new `notes.md` frontmatter.

## Data flow

```
+New (REVIEW)            →  start_session(prLink)  →  claude /start  →  notes.md (pr_link:)
in-app ✎ / ＋Add PR link →  set_pr_link(path,url)   →  atomic rewrite →  notes.md (pr_link:)
                                                                            │
reader.rs parse_frontmatter(pr_link) → prLink → prPill (GitHub icon, opens PR)
```

## Error handling

- Invalid PR URL → inline error in the form / popover; no write attempted.
- `set_pr_link` outside a configured root, or path not a `notes.md` → `Err`, surfaced
  to the user; nothing written.
- Write failure (I/O) → `Err`; the existing frontmatter is left intact (atomic rename).
- Backfill of pre-existing sessions is manual-via-app (the editor) by design; no
  auto-derivation from the PR number (explicitly out of scope).

## Testing

- Rust unit tests: the frontmatter-rewrite helper (add / replace / clear / preserve
  other keys / no trailing `---` corruption) and the PR-URL validator (accept/reject
  table). Confinement guard reuses archive tests' approach.
- JS: validator mirrored in `app.js`; if extracted to a pure helper, a small jest test.
- GUI: `+New` REVIEW shows the field; create writes `pr_link`; ✎ adds/edits/removes on
  an existing session; icon opens the PR; non-REVIEW unchanged.

## Out of scope (YAGNI)

- Deriving the repo/branch or the PR URL from the PR number or repo path.
- Making the launched `claude` auto-review the PR.
- A PR field for non-REVIEW categories.

## Open items

- ADR: this adds the app's 2nd source-of-truth write. Fold its documentation into the
  pending 013→014 ADR renumber (public archive ADR-013 clashes with the personal
  shared-config ADR-013).
