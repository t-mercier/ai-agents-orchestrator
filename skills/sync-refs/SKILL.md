---
name: sync-refs
description: >-
  Bring a session's tickets and pull requests back in line with reality — run UNATTENDED by
  the dashboard's Sync button. Reads the tracker for each ticket's current status and asks
  `gh` for the pull requests that belong to this session's work, then rewrites the
  frontmatter. Touches nothing else. Trigger on "/sync-refs <notes_path>".
allowed-tools: Bash Read Edit
argument-hint: "<notes_path>"
---

# /sync-refs — realign a session's tickets and PRs

The dashboard's **Sync** button, run with `--print`, so **nothing may ask a question**.

It exists because two facts drift on their own: a ticket's status changes in the tracker,
and a pull request gets opened long after the session's notes were last written. The app
cannot read either — it holds no tracker credentials, and it does not know which branches
belong to a session. An agent does, through MCP and `gh`.

Deliberately NOT here: summarising, closing, distilling, editing prose. This rewrites two
frontmatter keys and stops.

## Arguments

```
/sync-refs <notes_path>
```

`<notes_path>` is not an existing file → print one line saying so and stop. Never guess a
path: the wrong notes.md would be rewritten with another session's references.

## Step 1 — Read the frontmatter

Read `<notes_path>` and note:

- `ticket:` + `tickets:` — every ticket this session is about.
- `ticket_states:` — what we believed last time.
- `pr_link:` + `pr_links:` — the pull requests already attached.
- `branch:` — the branch last recorded, useful but not authoritative.

No tickets and no PRs → nothing to sync. Say so in one line and stop.

## Step 2 — Ticket statuses, from the tracker — ONE query

**One** tracker call for all the tickets, never one per ticket: the Atlassian MCP
`searchJiraIssuesUsingJql` (or the tracker's equivalent) with

```
key in (GOSDK-201341, GOSDK-221110, NAV-206836)      # every ticket from Step 1
fields: key, status
```

Transcripts of this skill showed the drift this rule removes: one run made a single JQL
call, the next made a `getJiraIssue` call per ticket. Same result, N times the cost, and
N chances to hit a rate limit.

Use the tracker's own wording — `Ready For Review`, `Triaged`, `Aborted` — never a
normalised version of it: the dashboard derives its colour from the word but shows the word
itself, and a project's vocabulary is the useful part.

Rewrite `ticket_states:` in full:

```yaml
ticket_states:
  - GOSDK-201341: Ready For Review
  - GOSDK-221110: Aborted
```

**Replace, do not append.** A status is a snapshot, and this is exactly the key whose stale
value is worse than none — an old "Triaged" shown as current is what makes the board lie.
Drop the entry for a ticket the tracker cannot answer for, rather than keeping the last
known value.

If no tracker MCP is available, leave `ticket_states:` **untouched** and say so in the
confirmation. Silently wiping the statuses because a tool was missing would look like every
ticket lost its status.

## Step 3 — Pull requests, from `gh` — a fixed sequence

A session's PRs are the ones whose branch names one of its tickets — that is the convention
the branches follow (`fix/GOSDK-221743-…`, `test/GOSDK-201341-…`).

The repositories to search are the ones already appearing in `pr_link:` / `pr_links:`, plus
the git repository of the current directory when it is one. **One `gh pr list` per
repository, the filtering done locally by `jq`** — never a `gh` call per ticket, and
`< /dev/null` on every `gh` inside a loop (gh reads the loop's stdin and truncates it: a
run once got 15 of 57 PRs that way):

```bash
TICKETS='GOSDK-201341|GOSDK-221110'            # the session's ticket ids, `|`-joined
for repo in owner/repo-a owner/repo-b; do
  gh pr list --repo "$repo" --state all --limit 60 --json number,url,headRefName,title < /dev/null \
    | jq -r --arg t "$TICKETS" '.[] | select(.headRefName | test($t)) | .url'
done
```

**No repository known at all** (no PR attached, and the current directory is not a
checkout — the dashboard's Sync runs from the session folder, which usually is not one):
do not skip. Search by ticket instead, across everything the account can see — one call,
all tickets. No `--state` flag: search does not have `--state all`, and its default already
returns open and closed.

```bash
gh search prs "GOSDK-201341 OR GOSDK-221110" --author @me --limit 30 --json url,title < /dev/null
```

GitHub's search reads titles and bodies, not branch names, so this catches a PR whose
title or description names the ticket (`Implements: <TICKET>`) and misses one that only
names it in the branch. Keep a result when its `title` names one of the session's ticket
ids; treat the rest as noise, not as the session's. This is the fallback, not the rule —
when a repo IS known, the branch-name rule above stays authoritative.

Add every PR kept, by either route, that is not already listed — keeping the existing
`pr_link:` as the primary (a session's first PR stays its headline) and writing the rest
as `pr_links:` entries.

**Append only. Never remove a PR link**, whatever `gh` says: a link the user attached by
hand is a deliberate act, and a branch can be deleted while its PR still matters. Pruning
is the dashboard's editor, on purpose.

**The whole sync is those calls and no others**: one read of the file, one JQL, one
`gh pr list` per known repo (or one `gh search prs`), one edit, one line of confirmation.
A run that needs more than that is a run that went wrong — say so rather than improvise.

## Step 4 — Confirm in one line

Print what changed: how many ticket statuses were refreshed, which PRs were newly attached,
or that nothing moved. **In English**, whatever language the surrounding session uses — this
line is app UI, not conversation. One line: the app shows it as-is.

Worth flagging when it happens: a ticket the tracker redirected to another key (a moved
project). Name both keys — the status is real but it no longer belongs to the id in the
notes, and only the user can decide what to do about that.
