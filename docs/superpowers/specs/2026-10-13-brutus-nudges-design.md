# Brutus nudges — he speaks first when something needs you

**Status:** design approved in conversation, 2026-10-13 · **Target:** 0.23.0 (new capability → minor)
· **Builds on:** `2026-09-23-brutus-design.md`

## The Context

Brutus answers questions about your sessions, but only when asked, so in practice he is rarely
asked. What she wants is an assistant who brings you up to date the way a person would: when you
arrive in the morning, when you come back from a call, or when something moves on a case during
the day — "by the way, X is still waiting on your answer, you still have the capture to take for
FEAT-1842, and six sessions have not moved in a while, want me to list them?"

The app already knows most of this. A session that waits on you has the `waiting` status that
feeds the *Needs you* banner. Each `notes.md` has a `## Next steps` checklist, which is where "the
capture to take" lives. PR states sit in the `prstatus.rs` cache and ticket states in each
session's `ticketStates`, both already read for Brutus's dashboard. What is missing is someone who
watches them and speaks.

### The design in one paragraph

The app collects the facts itself, with no model. A small renderer module decides, at three
moments, whether there is something worth saying that has not been said already. Only then does
one Haiku run turn the facts into a short message in Brutus's name and style; if that run fails,
the app writes the message from templates. The message appears as a speech bubble next to
Brutus's avatar, inside the app only. Brutus stays read-only.

## When he speaks

| Moment | Detected as | What he says |
|---|---|---|
| **Morning arrival** | The first time AO comes to the foreground on a calendar day, after 05:00, with at least 4 h since the last visit | A full recap of everything still open: agents waiting on you, your 👤 tasks, the count of stale sessions |
| **Back from a pause** | AO comes to the foreground after at least 30 min out of it | Only what changed while you were away: "while you were away, X finished, Y is waiting on you, PR #1851 was merged". Nothing new → silence |
| **A case moves** | While AO is in the foreground: an agent turns `waiting` or finishes its turn, a tracked PR is merged or closed, a ticket changes state | That event. Events within 2 min are grouped into one bubble. While AO is in the background nothing appears; the events wait for the *back from a pause* recap |

"Foreground" is the app's launch plus the window's `focus` event — the pair `app.js` already uses
for the update check. Launch matters: when the first visit of the day is the launch, there is no
`focus` event.
Whether the person is back at the Mac, rather than back in AO, is out of scope: a bubble inside the
app only needs the second.

### Never the same reminder twice

- Every fact has a key: session, kind, and a hash of its content. A fact already said is not said
  again on *back from a pause* or *a case moves*.
- The morning recap may repeat a fact once a day, and only while it is still true. That is the
  answer to "unless I ignored it for a long time".
- A ticked task, an answered agent, or a closed session drops out by itself, because the next fact
  collection no longer contains it.

### Staying in control

- On the bubble: **Open** (or a click on the bubble) · **Not now**, which closes it until the next
  moment. Either way, what the bubble showed counts as said.
- Settings → Assistant gets three entries: **Nudges** on/off (on by default) · **A session is
  stale after** N days (3 by default) · **Do not disturb** from–to (empty by default).

## What the bubble shows

- Up to three lines, then "… and 2 more things". Always in this order: agents waiting on you →
  your 👤 tasks → cases that moved (PRs, tickets, finished agents) → the count of stale sessions.
- Session names are `[[session:<name>]]` chips with their status dot, rendered by the existing
  Brutus renderer: a click scrolls to the card. An unknown name renders as plain text, as today.
- Language: the language Brutus uses with the person, French for her.

Example, morning recap, Concise style:

> Morning! [checkout-redesign] has been waiting on your answer since last night. You still
> have the capture on the Nothing for FEAT-1842, and PR #1851 was merged overnight. Also, 6
> sessions are unfinished and have not moved for more than 3 days — want me to list them?

### What each click does

- **Open** unfolds the recap into Brutus's conversation as a message from him. Replying ("why is X
  waiting?") goes to the real Brutus as usual, with the recap prepended to that message's stdin as
  context, so he knows what he just said. Recap plus reply stay under `check_message`'s 8 000
  characters; the recap is cut first. His Claude Code conversation does not otherwise contain
  it.
- **"Want me to list them?"** is a button. The list renders directly, with no model call: name,
  last activity and first open next step for each stale session, as chips.
- No writes. Ticking a task or closing a session happens in the session. Actions with a
  confirmation remain V2, as in the Brutus spec.

## How it works

### 1. Facts — `collect`, in the renderer, no model

An **open session** is a running session, as listed under Running; closed and archived ones are
not open.

`nudge-model.collect` builds them from the lists the app already reads (`get_sessions`, the
stale sessions of `get_historical_all`, `get_pr_status`). There is no command of its own: an
earlier draft named one `brutus_facts`, and the implementation found every field already in
those lists.

- **`waiting`** — running sessions whose status is `waiting` (`reader.rs`), with their last
  activity. `reader.rs` does not record when the status was entered; "since last night" is read
  from the last activity.
- **`tasks`** — the unticked `- [ ]` lines under `## Next steps` in the `notes.md` of every open
  session. A line containing `👤` is `you`; any other line is `untriaged` unless `triage.json`
  already classifies its hash.
- **`prs`** — the entries of `prstatus::get_pr_status()` for the PRs of open sessions. The cache
  records `open · draft · merged · closed` and no CI result, so "a PR's checks failed" is not a
  trigger in this version.
- **`tickets`** — each open session's `ticketStates`.
- **`stale`** — open sessions without activity for more than the
  configured number of days, using the same last-activity fields as `brutus_home::row`.
- Finished turns are not a fact of their own: `nudge-model` sees a session go from `busy` to
  `idle` between two collections.

Archived sessions and Brutus's own folder (`brutus_home::is_brutus_cwd`) are excluded, as in the
dashboard snapshot.

### 2. Deciding — `renderer/lib/nudge-model.js`

A UMD module like `pins-model.js`, pure and tested with Jest:

```js
decide({ moment, facts, previous, said, now, settings }) → { items, keys, untriaged } | null
```

- `moment` is `morning`, `back` or `moved`; `previous` is the collection at the last visit
  (for `back`) or the last poll (for `moved`), which is how "what changed" is computed.
- It returns the ordered items to say and their keys, or `null` when there is nothing new, nudges
  are off, or the time falls in *Do not disturb*.
- `renderer/nudges.js` calls it on launch and `focus` (morning or back) and from the existing 5 s
  poll (moved, with the 2-minute grouping; a batch that follows a nudge within 5 minutes waits
  until then).
- The history scan runs only for `morning`, `back` and a blur with no recent scan. `moved` uses
  what the poll already has — session statuses, `ticketStates`, the PR states read at most once a
  minute — so the 5 s poll reads no note.

`said` (fact key → last date said), `lastVisit`, `lastFacts` (the collection at the last visit,
the baseline for `back`, kept to the fields `decide` reads and capped at 2 000 facts) and
`pending` (the bubble on screen until it is opened or put away, shown again at the next launch
if the app quit first) persist in `nudges.json` in Brutus's folder,
written by the app, so a restart does not replay the day's reminders. `localStorage` is not used
for them: the two-stores rule puts state that must survive in the backend.

### 3. Writing — `brutus_nudge`, one Haiku run

- The persona comes from a new builder in `brutus_agent.rs`, `nudge_agents_json(name, style)`:
  inline `--agents` JSON with a nudge-only prompt (write one short message from these facts, in
  this name and style, name sessions only as `[[session:…]]` from the facts) and an empty tool
  list. It is not `agents/brutus.md`, whose prompt reads notes and writes `memory.md`.
- Same login-shell runner as `brutus_ask`, with `--model haiku` fixed whatever model Brutus uses,
  `--restricted`, `--strict-mcp-config`, no `--add-dir`, and **no tools at all**. The facts go on
  stdin, never on the command line.
- **Probe before build**, as the Brutus spec did for every flag: confirm on the installed Claude
  Code which flag leaves zero tools (`--tools ""` or equivalent) together with the inline agent's
  empty list, and that `haiku` is accepted as a model alias headless. Falsifier: the same run with
  the tool flag omitted is able to `Read` a file. Added to `scripts/probe-brutus-sandbox.sh`.
- In plain words: this run can do nothing except write text. A note that contains an instruction
  can at worst produce an odd bubble. That is stricter than Brutus himself, who can write his own
  `memory.md`.
- It returns JSON: `{ "message": "...", "triage": { "<line hash>": "you" | "agent" } }`. The
  `you` answers go into `triage.json`, so such a line is sent to Haiku once in its life. An
  `agent` answer holds for the app's current run only: the model reads notes that agents write,
  so its verdict that a line is not the person's must not hide that line for good.
- **Fallback to templates** when the run errors, exceeds 20 s, returns invalid JSON, or names a
  session that is not in the facts. The reminder is never lost; only its wording degrades. Untriaged lines are left out of a
  template message (it says "and N other open steps"), so a failed first run does not dump every
  old checklist into the bubble.
- If a `brutus_ask` run is in progress, the nudge waits for it to end (the single-run rule stays).

### 4. The 👤 convention

The app skills that write `## Next steps` — save-session, close-session, wrap-session,
start-session, restart-session, import-session — gain one line: *mark with `👤` a step that needs
an action from the person (a decision, a capture on a device, a message to send)*. These are the
app's own skills, updated by an app release; the person's own skills are untouched. Existing notes
are not rewritten: their unmarked lines go through Haiku's triage, which fades out as notes are
rewritten under the new convention.

## What does not change

- Brutus is still read-only. The security page's promise holds: the nudge run has no tool and
  writes nothing; the app writes `nudges.json` and `triage.json` in Brutus's own folder.
- No macOS notification and no new network path. The Haiku run is Claude Code, on the person's
  subscription.
- `brutus_ask`, his sandbox, `memory.md`, the dashboard snapshot and `config.json`'s existing keys.
  The three new settings are `assistant.nudges`, `assistant.staleDays`, `assistant.quietHours`.

**One behaviour change worth knowing.** Each nudge that has something to say costs one short Haiku
run. With the three moments and the never-twice rule, that is a handful per day; turning
**Nudges** off brings it to zero.

## Testing

- **Jest (`nudge-model`):** morning gives the full recap; back gives only the delta and `null`
  when nothing changed; moved groups events within 2 minutes; back after a restart uses the persisted `lastFacts`; a fact said is not repeated on back
  or moved; morning repeats a still-true fact at most once a day; a ticked task, answered agent or
  closed session disappears; *Do not disturb* and *Nudges off* return `null`; the order is waiting
  → you → moved → stale.
- **Rust:** `## Next steps` extraction keeps unticked lines only and stops at the next heading;
  `👤` marks `you`; `triage.json` classifications are honoured by hash; the stale threshold;
  archived and Brutus sessions are excluded; `nudge_agents_json` has an empty tool list and no `memory.md`; the nudge run's arguments contain `--model haiku`,
  `--restricted`, `--strict-mcp-config`, no tool and no `--add-dir`, and never the facts; the
  template fallback for each failure (error, timeout, invalid JSON, unknown session). Each
  assertion gets a falsifier, as elsewhere in this repo.
- **Playwright:** the bubble renders on a stubbed morning; **Open** unfolds the recap into the
  conversation; "want me to list them?" renders the list; **Not now** closes it and a second focus
  inside 30 min does not reopen it.

## Out of scope

- A "checks failed" trigger: it needs `prstatus.rs` to record CI results first.
- macOS notifications, and detecting that the person is back at the Mac rather than in AO.
- Brutus acting on what he reminds you of (V2 actions).
- Rewriting existing notes to add `👤`.
