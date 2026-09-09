---
name: skill-propose
description: >-
  Capture procedural knowledge as a skill — a new one, or a targeted patch to an existing
  one. Use PROACTIVELY, in flight: the moment the user corrects your approach, or the same
  output goes through a SECOND rewrite pass, stop and consider whether the skill that
  produced it is the defect. Do not wait for the session to close. With the user present on
  that second correction, show the verbatim change (or a scope card for a new skill) and
  apply it on their yes, logging it to ~/.claude/skills-applied.log; otherwise stage it in
  ~/.claude/skills-pending/ for /skills-review. Fires only when the session actually taught
  something reusable; stays silent otherwise. Trigger on "/skill-propose", "propose a
  skill", "fais-en une skill", "capture ça en skill", "on pourrait pas améliorer la skill ?".
allowed-tools: Bash Read Write Edit
argument-hint: "[a hint about what to capture]"
---

# /skill-propose — stage a skill from what this session learned

Turns *how we got there* into a reusable skill. This is the **procedural** twin of the
knowledge distil: `/distil` promotes decisions and facts (declarative) to the notes, this
promotes workflows (procedural) to `skills/`.

**Two hard rules, no exceptions:**

1. **NEVER change `~/.claude/skills/` without the user seeing the exact change first.**
   A skill is an instruction that shapes every future session; a wrong one is a silent,
   persistent regression. What they see is the verbatim wording, never a summary — a yes
   on a description they have not read is the thing this rule exists to prevent. With them
   present, Step 3c shows it and applies on their yes; otherwise the proposal goes to
   `~/.claude/skills-pending/` and `/skills-review` promotes it. Either way the change is
   appended to `~/.claude/skills-applied.log`, which is how it gets undone.
2. **Stay silent when nothing qualifies.** A proposal at every invocation is how you end
   up with forty half-overlapping skills. If no criterion below fires, say so in one
   line and stop. That is a success, not a failure.

## Step 0 — Mode check

If plan mode is active (a `Plan mode is active` system reminder is present): stop and print:

> ⚠️ Plan mode is active — this skill writes files and will be blocked.
> Switch to auto mode, then re-run `/skill-propose`.

## Step 1 — Does anything qualify?

Look back over THIS session. A candidate exists only if at least one of these fired:

1. **A complex task succeeded** — roughly 5+ tool calls of real work, not a lookup.
2. **You hit errors or dead ends, then found the path that works.** The valuable part is
   the dead end, not the destination: "X looks right but fails because Y, do Z instead".
3. **The user corrected your approach.** The strongest signal there is — it encodes a
   preference or a constraint you did not know and would otherwise breach again.
   **Twice on the same artifact is the loudest version of it, and it does not wait for the
   session to end.** A second rewrite pass of one output means the first attempt followed
   the instructions available and was still wrong — so the instructions are what is
   missing. Say it at that moment, not at the close: three passes that end in a shrug teach
   nothing, and the user should not have to be the one to ask.
4. **You discovered a non-trivial workflow** — an ordering, a gate, a flag that is not
   discoverable from the code or the docs.

**Then find where the defect actually lives.** If the corrected output came from a skill,
that skill is the first suspect, and the proposal is a patch to it — not a new skill, and
not a note. Quote the passage that led you into the mistake and say what it fails to
cover: "outcome first" is not enough for a finding whose impact *is* the argument, and a
rule that is right but unreachable at the moment of writing is a rule that does not exist.
A skill that produced three rejected drafts and gets no patch will produce a fourth.

Then apply the **reusability test**, which overrides all four: would this help in a
*future, different* session? If it is specific to one repo's current state, it belongs in
that session's `notes.md`. If it is a fact rather than a procedure, it belongs in memory
or the vault. Only a repeatable *procedure* becomes a skill.

**Nothing qualified** → print one line ("Nothing worth a skill this session — <reason>.")
and stop. Do not manufacture a candidate.

## Step 2 — Patch an existing skill before creating a new one

This step is what keeps the skill set from inflating. List what already exists:

```bash
python3 - ~/.claude/skills/*/SKILL.md <<'PY'
import pathlib, re, sys
for a in sys.argv[1:]:
    p = pathlib.Path(a)
    # Most skills use a folded scalar (`description: >-`), so the text continues on the
    # following indented lines — a plain grep would only ever return ">-".
    m = re.search(r'^description:[ \t]*(.*?)(?=^[A-Za-z_-]+:|^---)', p.read_text(), re.M | re.S)
    d = ' '.join((m.group(1) if m else '').split()).lstrip('>|-').strip()
    print(f"{p.parent.name:28s} {d[:150]}")
PY
```

Read the full `SKILL.md` of anything that looks adjacent. Then decide — and the *bar
matters more than the reading*.

**The wrong bar is pairwise distinctness.** "This has a different trigger from that one" is
almost always true and almost always irrelevant; it is how you end up with forty
micro-skills. (Hermes' curator states this as a hard rule: *"Pairwise distinctness is the
wrong bar."*)

**The right bar:** *what umbrella class does this serve — and would a human maintainer
write this as N separate skills, or as ONE skill with N labeled subsections?* When the
answer is the latter, do not create; patch the umbrella and add a labeled section.

Three outcomes, in order of preference:

1. **An existing skill is already the umbrella** → propose a **patch** adding a labeled
   subsection for what you just learned. The common case, and the preferred one.
2. **Several existing skills plus this one clearly form a class, and none is broad enough
   to be the umbrella** → say so in your report and stop. Creating a new sibling makes the
   cluster worse; consolidating a cluster is a curation job, not a proposal job.
3. **No class exists — this is genuinely its own territory** → propose a new skill (Step 3a).

### App-owned skills: the patch is product feedback

Before staging a patch, check whether the target is one of the app's own lifecycle
skills:

```bash
[ -d ~/.claude/skills/.ao-base/<target-slug> ] && echo "app-owned"
```

An app-owned skill is **not patched — ever.** The dashboard depends on what these
skills write (`notes.md`, the registry), a patched one breaks it silently, the files are
read-only, the `ao_skill_guard` hook refuses the edit and `patch_apply.py` refuses the
target. So the proposal changes shape: it becomes a **new skill of the user's own**.

- Name it `<target>-<short suffix>` (e.g. `save-session-mine`), or the name the user
  gives. Seed it from the app's copy (`cp -R ~/.claude/skills/<target>
  ~/.claude/skills/<new-name>`), set `name:` in its frontmatter to the new name, then
  apply the change **to that copy** — which is theirs, so the ordinary rules below apply.
- Say plainly in the report that `/<target>` stays exactly the app's version and that the
  new skill is the one to invoke for the changed behaviour.
- If the change reads like **the product's default is wrong or incomplete**, say that too:
  it belongs upstream (the app's repo, or an issue there) — the personal skill covers the
  user meanwhile.

### The name is a tell

If the natural name contains a ticket number, a feature codename, a specific error string,
or reads like a session artefact (`audit-…`, `diagnosis-…`, `salvage-…`, `fix-…-2026`), it
is **not** a skill: it is a subsection or a `references/` file under a class-level skill.
Rename it to the class, or downgrade the proposal to a patch.

### Keep the trigger in the first ~60 characters

The skills index a future session sees truncates `description:`. Whatever comes after the
first ~60 characters may never be read before the load decision. Write it as
`Use when <trigger>. <one-line behaviour>.` — trigger first, capability second.

## Step 3a — Draft a NEW skill proposal

Slug: lowercase, hyphens. Write `~/.claude/skills-pending/<slug>/SKILL.md`:

```markdown
---
name: <slug>
description: >-
  <what it does + WHEN to use it — this line is all a future session sees before
  deciding to load the skill, so make the trigger conditions explicit.>
allowed-tools: <only what it needs>
origin: agent-proposed
source_session: <SESSION_ID>
proposed_at: <YYYY-MM-DD HH:MM>
version: 0.1.0
---

# <title>

<One paragraph: the problem this solves and when it applies.>

## <Steps / rules — the actual procedure>

<Concrete and ordered. Name exact commands, paths, flags. Include the FAILURE mode you
hit and why the naive approach breaks — that is the part worth keeping.>
```

Rules for the content:

- **Write the trigger, not just the capability.** `description:` is the only thing a
  future session reads before choosing to load it.
- **Keep the why.** "Do X" ages badly; "do X because Y fails when Z" survives.
- **No secrets, tokens, absolute paths under a private tree, or client names.**
- **One proposal per invocation.** If several candidates exist, stage the highest-value
  one and mention the others in your report so the user can ask for them.

## Step 3b — Draft a PATCH proposal

Write `~/.claude/skills-pending/<target-slug>.patch.md` — a document, not an applied
change. **Wrap `old_string` / `new_string` in at least FIVE backticks**, never three:
the replacement almost always contains its own ```` ``` ```` blocks, and a three-backtick
wrapper ends at the first inner closing fence — silently truncating the replacement and
writing a broken skill. `lib/patch_apply.py` refuses a three-backtick wrapper outright.

````markdown
---
target: <existing skill slug>
origin: agent-proposed
source_session: <SESSION_ID>
proposed_at: <YYYY-MM-DD HH:MM>
kind: patch
---

## Why
<What went wrong or was missing, in two lines. Reference what happened this session.>

## Change 1
`old_string:`
`````
<exact text from the target SKILL.md — must match uniquely, verbatim>
`````
`new_string:`
`````
<replacement, which may freely contain ``` fenced blocks>
`````
````

Keep patches **minimal and targeted** — one or two focused replacements. A full rewrite
is not a patch: if the skill needs rewriting, say so in `## Why` and let the user decide.

Then **verify the proposal mechanically** before you report it — do not eyeball the
anchors:

```bash
python3 ~/.claude/skills/lib/patch_apply.py check ~/.claude/skills-pending/<slug>.patch.md
```

It parses the blocks, resolves the target and requires every `old_string` to match
**exactly once**. If it prints `REFUSED`, fix the proposal — never hand a proposal to the
user that its own applier rejects.

## Step 3c — The fast path: propose it here, apply it on a yes

**When this applies:** the user is present in a live session (not a headless `/wrap-session`
or a background run) and Step 1 fired on **criterion 3, the second time** — they corrected
the same thing twice, or one output went through a second rewrite pass. That is the moment
the missing instruction is obvious to both of you and the context is still in their head.

Then do NOT stage and point at `/skills-review`. Staging is right when nobody is there to
answer; when they are, a deferred review means reading a diff next week with no memory of
why it was written, which is worse review, not safer review.

**This is a mode, not a step after 3a/3b.** The file those steps wrote is the draft: on a
yes it is applied and removed, and on anything else it stays exactly where it is — and that
is the staged proposal. Nothing here writes a second artifact.

**What replaces the gate.** The gate before becomes a cheap undo after — so the two things
below are not optional:

- the change goes through `patch_apply.py`, which re-checks every anchor at write time and
  writes atomically. Never hand-edit a skill on this path.
- every application appends to `~/.claude/skills-applied.log`, which holds the diff. That
  log is the revert, and the confirmation line must tell the user it exists.

### A patch to an existing skill

Say it in the conversation, in this shape and nothing longer:

1. **What you noticed** — one sentence, naming the skill and the passage that let the
   mistake through. Not "I could improve X": *"Second time you've had to tell me the
   detail must not restate its own headline — `timothee-writing-style` says compress but
   never says that."*
2. **The exact change** — the passage as it reads now, and what it would read instead.
   Verbatim, both sides, in a short block. **Never a summary**: a "go" on a description
   they have not read is exactly what the staged review existed to prevent, and skipping
   the review does not make it acceptable.
3. **One direct question** — "Patch it?" Plain prose, no `AskUserQuestion` dialog: the
   ceremony is the thing being removed.

On a clear yes, write the patch to `~/.claude/skills-pending/<slug>.patch.md` as Step 3b
describes, then apply it exactly as `/skills-review` Step 3 does — `check`, capture the
`diff`, `apply`, append the diff to the log, delete the patch file. The pending file is a
temporary artifact here, not a proposal waiting for anyone.

**An ambiguous answer is a no.** "ok", "mmh", a reply that moves to another subject, or a
yes that arrives with a change to what you proposed — none of those are the go-ahead. Stage
it and say so, or re-ask with the correction folded in. Applying on a maybe is how this path
loses the right to exist.

### A new skill

A new skill is a larger commitment than a patch: its `description:` decides when it loads
in **every** future session, so a badly scoped one starts firing in places nobody asked
for. It still goes on the fast path, but the user validates the **scope** first, the way
they would approve a plan — not the finished file.

Present a scope card, this and no more:

```
Name        <slug>
Fires when  <the description's trigger, in the words that will actually be in it>
Covers      <two or three bullets — the procedure it encodes>
Does not    <what it deliberately leaves out, and where that belongs instead>
```

Then one question: "Scope look right?" On a clear yes, write the full skill straight to
`~/.claude/skills/<slug>/SKILL.md` per Step 3a — keeping the `origin: agent-proposed` /
`source_session:` / `version:` frontmatter, which is what tells them later what they wrote
and what was proposed. Append to `~/.claude/skills-applied.log`, in the header shape the
log already uses — `/skills-review` lists the last entries with `grep '^==='`, so a line
that does not start that way is invisible in the timeline rather than merely untidy:

```bash
printf '=== %s  create  %s\n%s\n\n' "$(date +'%Y-%m-%d %H:%M')" "<slug>" \
  "created by /skill-propose (fast path) → ~/.claude/skills/<slug>/SKILL.md" \
  >> ~/.claude/skills-applied.log
```

If they change the scope in their answer, that is not a no — fold in the correction and
re-present the card once. Two rounds, then stage it and stop.

### Reporting on the fast path

One line after applying: what changed, the path, and the revert. *"Patched
`timothee-writing-style` (Compression section) — `~/.claude/skills/timothee-writing-style/`.
Diff is in `~/.claude/skills-applied.log` if you want it back."*

Say plainly that it is **active now**, and that a skill only reaches a session that starts
after the write — the one you are in keeps the version it loaded.

If the target is a skill bundled in a repo (the session skills in `ai-agents-orchestrator`,
say), name that too: the repo copy now differs from the installed one, and a `--force`
install will silently revert the patch.

## Step 4 — Report (staged proposals only)

When Step 3c did not apply — nobody was there to answer, or the answer was not a clear yes
— the proposal is staged and this is the report. Two or three lines, no ceremony:

- what was staged (new skill or patch to which skill), and its path;
- **which criterion fired** — the user needs this to judge whether it was worth it;
- `Review with /skills-review.`

Never claim the skill is active. It is not, until approved.
