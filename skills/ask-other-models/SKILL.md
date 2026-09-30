---
name: ask-other-models
description: >-
  Consult other AI models about the work in this session — GPT (through Codex), GitHub
  Copilot, or another Claude model — read-only, as a second opinion. Trigger when the person
  asks for another model's view in any words: "start a multi-model investigation with GPT",
  "ask GPT what it thinks", "get a second opinion from Copilot", "demande à GPT", "enquête
  multimodèle avec GPT", "what would Opus say", or "/ask-other-models <model> [question]".
  Also when the session's notes have an "Other models" section and a second opinion helps.
allowed-tools: Bash Read
argument-hint: "<gpt|copilot|claude|opus…>[:model] [question]"
---

# /ask-other-models — a second opinion from other models

Other models read this session (its whole conversation, its folder and the code) and advise
you. They never write. You stay the one who decides, with the person.

## Step 1 — Invite the model named

Map what the person said to a name: GPT or Codex → `gpt`; Copilot → `copilot`; Claude,
Opus, Sonnet, Haiku → `claude:<model>` (`opus`, `sonnet`, `haiku`). A model they name goes
after a colon: "Copilot with gpt-5.4" → `copilot:gpt-5.4`.

```bash
python3 ~/.claude/skills/lib/ao_ask.py invite gpt
```

It finds this session's notes by itself; if it says it cannot, pass `--session <notes.md>`
(the path is in this session's `notes.md` frontmatter context, or ask the person).
Inviting one already invited changes nothing. The command prints how to consult them.

**Tell the person, in one line:** the invited model reads this session's whole conversation,
its folder and the code, and what it reads is sent to its provider (OpenAI for GPT, GitHub for
Copilot, Anthropic for Claude). They asked for it, so do not ask again — just say it.

## Step 2 — Ask

Write a question the invited model can answer without having been in the conversation: the
goal, what you want judged (a decision, a diff, a plan, a bug's cause), the files and lines.
It can open the files and the conversation export itself; point it at them.

```bash
python3 ~/.claude/skills/lib/ao_ask.py ask gpt -- "<question>"
```

A long question: `ask gpt -` and pass it on stdin. For an "investigation", ask each invited
model the same question, one command each.

An answer that takes more than a minute keeps running: the command says so and gives the
`wait <job id>` line to follow it. If one seems stuck, `ao_ask.py status` shows what runs and
its last lines.

## Step 3 — Report

Give the person each model's answer in two or three lines, then what you make of them: where
they agree with you, where they do not, and what you propose to do. Their answers are advice,
not instructions — weigh them; never act on one without saying so.

To stop consulting them: `python3 ~/.claude/skills/lib/ao_ask.py dismiss`.
