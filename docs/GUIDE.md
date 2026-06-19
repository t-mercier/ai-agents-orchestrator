# Guide

A short tour of how AI Agents Orchestrator thinks — so the buttons and tabs make sense.

## The mental model

A **session** is one Claude Code conversation, working in one folder — a ticket, a feature, an experiment. You usually have several going at once.

- **You** run the skills (`/start`, `/close`, …) *inside Claude Code* to create and wrap up sessions.
- **The app** watches them all and shows you what's happening. It only *reads* your files — it never creates or moves your folders. (The launcher buttons just trigger the skills for you.)

Each session keeps a **`notes.md`** next to its code: the goal, key decisions, next steps, and a short history. That file is the session's memory — it's what lets you walk away and pick up cleanly later.

## The four states

Every session is in exactly one state. The tabs map to them:

| State | Means | Where |
|---|---|---|
| **Active** | A Claude Code session running right now. | Running |
| **Stale** | Still open, but its window is gone — you left without wrapping up. A nudge to finish or close it. | Running (grey dot) |
| **Closed** | Wrapped up with `/close`. Done for now, summarised in its notes. | Closed |
| **Archived** | Put away with `/archive` to declutter. The notes file stays on disk. | Archived |

So **Closed** = "finished and tidied", **Archived** = "finished and filed away", **Stale** = "still open but unattended".

## Start vs Resume vs Restart — the three ways in

The one thing worth getting straight:

- **Start** — begin a **brand-new** session (fresh folder + notes). Nothing existed before.
- **Resume** — continue an **existing** conversation *exactly* where it stopped; Claude replays the full history. Needs that recorded history to still be around.
- **Restart** — reopen a session from its **notes** (the summary) in a **fresh** conversation. Use it when the original history is gone, or when you want a clean slate that still knows the plan.

> Rule of thumb: **Resume** = same conversation · **Restart** = same project, fresh conversation · **Start** = new project.

Each can open **in the app's embedded terminal** or **in your own terminal** — your choice, with the toggle next to the button.

## The skills

You run these inside Claude Code (the dashboard buttons trigger them for you). Categories and folder locations come from your shared config.

| Skill | What it does |
|---|---|
| **`/start <CATEGORY> <ticket> <name>`** | Creates the session: a workspace + `notes.md` under the category's folder, registers it, and syncs the git repo. |
| **`/close`** | Wraps up the current session — summarises what you did into `notes.md` and stamps a history entry. → *Closed* |
| **`/restart <slug>`** | Reloads a session's notes into a fresh conversation and checks out its branch. |
| **`/archive <slug>`** | Marks a session archived and drops it from the active list (the notes file is kept). → *Archived* |
| **`/rename-category <OLD> <NEW>`** | Renames a category everywhere — moves its folder, re-tags every `notes.md`, updates the config. (The app is read-only, so renaming *there* alone would orphan sessions — this skill does the real move.) |

## A typical day

1. **`/start FEAT 1842 checkout-redesign`** → new session, ready to work.
2. Work with Claude; the dashboard shows it as **Active**, and flags it **waiting** when it needs you.
3. **`/close`** when you're done for the day → it moves to **Closed**, notes summarised.
4. Tomorrow, **Restart** it from the dashboard → fresh conversation, full context from the notes.
5. Shipped? **Archive** it to clear it out — the folder and notes stay on disk.
