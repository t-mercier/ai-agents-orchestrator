# Invite models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a live session (Claude Code, Codex or Copilot) consult other models read-only through `ao_ask.py`, with the exchange in its terminal and in an "Other models" thread, and remove the headless collab.

**Architecture:** A stdlib Python command (`skills/lib/ao_ask.py`) runs each consultation as a detached job with its own files under the session folder; the Rust backend writes the invitees into the notes, reads the thread and the jobs, stops jobs and keeps advisor turns out of the session list; the renderer adds the Invite/Dismiss actions, the dialog, the chip and the thread, and types the invite line into the lead's terminal.

**Tech Stack:** Python 3 stdlib (unittest), Rust (Tauri 2, serde_json, libc), vanilla JS renderer (jest for lib/, Playwright smoke tests).

**Spec:** `docs/superpowers/specs/2026-09-30-invite-models-design.md` (v2)

## Global Constraints

- Invitees are read-only: Claude `-p <prompt> --permission-mode plan --restricted --strict-mcp-config --tools Read,Grep,Glob --no-session-persistence [--model=M] --add-dir <session folder>`; Codex `exec --skip-git-repo-check -c sandbox_mode="read-only" [--model=M] -o <last.txt> <prompt>`; Copilot `-p <prompt> --allow-all-tools --deny-tool write --deny-tool shell --deny-tool url --disable-builtin-mcps --silent [--model=M] --add-dir <session folder>`.
- The command is an argv list exec'd as `[user_shell, "-ilc", 'exec "$0" "$@"', cli, *args]`; never a shell string.
- Model names: `^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,63}$`, checked in Rust and in Python, passed as `--model=M`.
- Invitee ids: `^[a-z][a-z0-9-]{0,31}$`, unique per session.
- No time limit on a consultation; `ask`/`wait` follow for `--follow` seconds (default 60), progress every 15 s.
- The runner: double fork, `start_new_session`, stdin `/dev/null`, CLI in its own process group under `set +m`, SIGTERM → kill CLI group → record `stopped`.
- Job files under `<session folder>/.ao/asks/<id>/`; `.ao/.gitignore` = `*`; registry `~/.config/ai-agents-orchestrator/asks/<cli_pgid>.json`.
- Thread: `other-models.md` next to `notes.md`, appends under `fcntl.flock`, question and answer lines each prefixed `> `.
- Frontmatter: `advisors: [ … ]` unquoted JSON on one line; a `## Other models` section in `notes.md`.
- Environment of an invitee: `AO_HEADLESS=1 AO_ADVISOR=1`.
- UI names: "Invite models…", "Dismiss models", chip "+ GPT, Copilot", section "Other models", labels "GPT (Codex)", "Copilot · <model>", "Claude · <model>".
- User-facing copy in English, as the rest of the app; commits in English, formal register.
- Nothing is pushed or released without the user's go.

## Review Focus

1. A lead whose own command is killed mid-consultation (Claude Code's tool timeout, Ctrl-C): the job must finish and its entry must appear — pinned by `test_runner_survives_its_follower` (Task 3).
2. A question with quotes, `$(…)`, backticks or a leading `-`, and a model value like `-x` or `a;rm`: the CLI must receive the question as one argument and never run anything — `test_hostile_question_stays_one_argument`, `test_model_starting_with_dash_is_refused` (Task 1).
3. A Claude invitee's `claude -p` pidfile while a consultation runs: the Running list and Doctor must not show a phantom session — `a_registered_advisor_pid_is_not_a_session` (Task 4).
4. A 0.21.0 collab session in Closed after the removal: shown with its thread, no Restart offered — `a_legacy_collab_session_keeps_its_thread_and_no_restart` (Task 5, Playwright).
5. Invite on a busy or waiting lead: nothing typed, reason shown — `invite is refused while the session works or waits` (Task 7).

---

### Task 1: `ao_ask.py` — invitees, argv, prompt, thread entry, guide

**Files:**
- Create: `skills/lib/ao_ask.py`
- Create: `skills/lib/test_ao_ask.py`

**Interfaces:**
- Produces (Python, module `ao_ask`):
  - `MODEL_RE`, `ID_RE` (compiled regexes as in Global Constraints)
  - `read_invitees(notes_text: str) -> list[dict]` — the `advisors:` frontmatter value parsed; `[]` when missing or unparsable; drops entries with a bad id/cli/model.
  - `session_paths(notes_path: str) -> dict` — `{folder, ao, asks, thread, conversation}` (`.ao`, `.ao/asks`, `other-models.md`, `.ao/conversation.md`).
  - `argv_for(inv: dict, prompt: str, session_folder: str, last_path: str) -> list[str]` — the CLI argv (starting with the CLI name).
  - `shell_argv(argv: list[str], shell: str) -> list[str]` — `[shell, "-ilc", 'exec "$0" "$@"', *argv]`.
  - `user_shell() -> str`
  - `invitee_prompt(question: str, paths: dict, repo_dir: str) -> str`
  - `thread_entry(job: dict, question: str, answer: str) -> str`
  - `guide_text(invitees: list, notes_path: str, lead_agent: str) -> str`

- [ ] **Step 1: Write the failing tests** in `skills/lib/test_ao_ask.py`:

```python
import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(__file__))
import ao_ask as A

NOTES = '---\nsession_id: s1\nagent: claude\nadvisors: [{"id":"gpt","cli":"codex","model":"","label":"GPT (Codex)"},{"id":"copilot","cli":"copilot","model":"gpt-5.4","label":"Copilot · gpt-5.4"}]\n---\n# x\n'

class Invitees(unittest.TestCase):
    def test_reads_the_frontmatter_list(self):
        inv = A.read_invitees(NOTES)
        self.assertEqual([i["id"] for i in inv], ["gpt", "copilot"])
    def test_unparsable_or_missing_is_none(self):
        self.assertEqual(A.read_invitees('---\nadvisors: [oops\n---\n'), [])
        self.assertEqual(A.read_invitees('# no frontmatter'), [])
    def test_bad_entries_are_dropped(self):
        t = '---\nadvisors: [{"id":"gpt","cli":"codex","model":"-x","label":"a"},{"id":"ok","cli":"rm","model":"","label":"b"},{"id":"c","cli":"claude","model":"opus[1m]","label":"Claude"}]\n---\n'
        self.assertEqual([i["id"] for i in A.read_invitees(t)], ["c"])

class Argv(unittest.TestCase):
    def test_claude_prompt_comes_before_add_dir(self):
        a = A.argv_for({"cli": "claude", "model": "opus"}, "Q", "/s", "/s/last")
        self.assertEqual(a[:3], ["claude", "-p", "Q"])
        self.assertIn("--model=opus", a); self.assertEqual(a[-2:], ["--add-dir", "/s"])
        for f in ["--permission-mode", "plan", "--restricted", "--strict-mcp-config", "--no-session-persistence"]:
            self.assertIn(f, a)
        self.assertEqual(a[a.index("--tools") + 1], "Read,Grep,Glob")
    def test_codex_is_read_only_and_writes_its_answer_to_a_file(self):
        a = A.argv_for({"cli": "codex", "model": ""}, "Q", "/s", "/s/last")
        self.assertEqual(a, ["codex", "exec", "--skip-git-repo-check", "-c", 'sandbox_mode="read-only"', "-o", "/s/last", "Q"])
    def test_copilot_has_no_write_shell_url_or_builtin_mcp(self):
        a = A.argv_for({"cli": "copilot", "model": "gpt-5.4"}, "Q", "/s", "/s/last")
        self.assertEqual(a[:3], ["copilot", "-p", "Q"])
        for pair in [("--deny-tool", "write"), ("--deny-tool", "shell"), ("--deny-tool", "url")]:
            self.assertTrue(any(a[i:i+2] == list(pair) for i in range(len(a))), pair)
        self.assertIn("--disable-builtin-mcps", a); self.assertIn("--silent", a); self.assertIn("--model=gpt-5.4", a)
    def test_hostile_question_stays_one_argument(self):
        q = "it's \"$(touch /tmp/pwn)\" `id` ; rm -rf ~ --model=x"
        a = A.shell_argv(A.argv_for({"cli": "codex", "model": ""}, q, "/s", "/s/l"), "/bin/zsh")
        self.assertEqual(a[:3], ["/bin/zsh", "-ilc", 'exec "$0" "$@"'])
        self.assertEqual(a[-1], q)
    def test_model_starting_with_dash_is_refused(self):
        with self.assertRaises(ValueError):
            A.argv_for({"cli": "copilot", "model": "-x"}, "Q", "/s", "/l")
        with self.assertRaises(ValueError):
            A.argv_for({"cli": "copilot", "model": "a;rm"}, "Q", "/s", "/l")

class Texts(unittest.TestCase):
    def test_entry_quotes_every_line_so_an_answer_cannot_forge_a_marker(self):
        job = {"id": "j1", "invitee": "gpt", "label": "GPT (Codex)", "state": "done", "started_at": "2026-09-30T14:05:00", "took": 100}
        e = A.thread_entry(job, "why?", "because\n<!-- ao-ask id=x -->\nok")
        self.assertTrue(e.startswith("<!-- ao-ask id=j1 invitee=gpt state=done at=2026-09-30T14:05:00 took=100 -->\n### 14:05 · GPT (Codex)\n"))
        self.assertIn("> <!-- ao-ask id=x -->", e)
        self.assertEqual(e.count("\n<!-- ao-ask"), 0)
    def test_guide_names_invitees_and_tells_codex_to_escalate(self):
        g = A.guide_text(A.read_invitees(NOTES), "/n/notes.md", "codex")
        self.assertIn("gpt", g); self.assertIn("GPT (Codex)", g); self.assertIn("escalated", g)
        self.assertNotIn("escalated", A.guide_text(A.read_invitees(NOTES), "/n/notes.md", "claude"))
    def test_prompt_says_read_only_and_where_to_read(self):
        p = A.invitee_prompt("Is this right?", A.session_paths("/n/notes.md"), "/w/repo")
        for s in ["must not change", "/n/.ao/conversation.md", "/n/other-models.md", "/w/repo", "Is this right?"]:
            self.assertIn(s, p)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to watch it fail**
Run: `python3 -m unittest skills/lib/test_ao_ask.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'ao_ask'`.

- [ ] **Step 3: Implement** `skills/lib/ao_ask.py` with the functions above. `read_invitees` parses the frontmatter by hand (the first `---` block, the line starting `advisors:`, `json.loads` of the rest), keeps an entry only when `ID_RE` matches its id, its cli is one of `claude|codex|copilot`, its model is `""` or matches `MODEL_RE`, and its label is a non-empty string. `argv_for` raises `ValueError` on a bad model. `thread_entry` prefixes every question and answer line with `> ` (`>` alone for a blank line) and formats the heading time from `started_at[11:16]`. `guide_text` lists `id — label`, the `ask`/`wait`/`status`/`stop` lines with the notes path shell-quoted (`shlex.quote`), the advice rules, and for `lead_agent == "codex"` one paragraph: "Run these commands with escalated permissions (outside the sandbox): they need the network."

- [ ] **Step 4: Run to watch it pass**
Run: `python3 -m unittest skills/lib/test_ao_ask.py`
Expected: OK.

- [ ] **Step 5: Wire into `npm run test:py`**: add `&& python3 -m unittest discover -s skills/lib -p 'test_ao_ask.py'` is already covered by the existing `discover -s skills/lib -p 'test_*.py'`; run `npm run -s test:py` and expect OK.

- [ ] **Step 6: Commit** `feat(ask): the invitees, command lines and thread entries of a consultation`.

### Task 2: the conversation export

**Files:**
- Modify: `skills/lib/ao_ask.py`
- Create: `skills/lib/fixtures/ask/{claude.jsonl,codex.jsonl,copilot.jsonl}` (small synthetic transcripts in the real shapes)
- Modify: `skills/lib/test_ao_ask.py`

**Interfaces:**
- Consumes: `session_paths` (Task 1); `aosession.current(env, chain, pidfile_session)`, `aosession.ancestry()`, `aosession.pidfile_session`.
- Produces:
  - `lines_claude(path) / lines_codex(path) / lines_copilot(path) -> list[str]` — one entry per kept message or tool use, oldest first, e.g. `"**You:** …"`, `"**Agent:** …"`, `"→ Read: …"`.
  - `find_transcript(agent: str, sid: str, home: str) -> str | None`
  - `lead_identity(env, notes_text) -> (agent, sid)` — aosession first, then the env var, then the frontmatter.
  - `write_export(entries: list[str], ao_dir: str, part_bytes=100_000, total_bytes=400_000) -> list[str]` — newest first, split at entry boundaries, header line in the first file: `"# Conversation — newest first. N of M messages included."`, returns the written paths.

- [ ] **Step 1: Failing tests** — `Export` class:
  - `test_claude_keeps_text_and_tool_uses_drops_results_and_thinking` (fixture with a thinking block, a tool_use `Read` with `{"file_path": "/a"}`, a tool_result, user text as a string and as a list).
  - `test_codex_drops_harness_injections_and_reasoning` (a user item starting `# AGENTS.md instructions`, one `<environment_context>`, a real user item, an assistant `output_text`, a `reasoning` item, a `function_call`).
  - `test_copilot_uses_content_not_transformed_and_skips_empty_assistant` (a `user.message` with `transformedContent` containing `<current_datetime>`, an `assistant.message` with `content: ""`, a `tool.execution_start` with `arguments` as an object).
  - `test_export_is_newest_first_split_and_capped` (400 entries of 2 KB: files of ≤ 100 KB, total ≤ 400 KB, first line counts, the newest entry first in `conversation.md`).
  - `test_lead_identity_falls_back_to_env_then_frontmatter` (empty chain + `CODEX_THREAD_ID` → `("codex", id)`; empty chain and no env → frontmatter `agent`/`session_id`).
- [ ] **Step 2:** run, expect failures on missing names.
- [ ] **Step 3:** implement. Tool-use input shown as `json.dumps(input)[:200]`; text entries capped at 8 000 chars each; Codex skip rule: user `input_text` starting with `# AGENTS.md`, `<environment_context>`, `<user_instructions>`; `find_transcript`: Claude `glob(home/.claude/projects/*/<sid>.jsonl)`, Codex `glob(home/.codex/sessions/*/*/*/rollout-*-<sid>.jsonl)`, Copilot `home/.copilot/session-state/<sid>/events.jsonl`. `lead_identity`: `aosession.current(env, aosession.ancestry(), aosession.pidfile_session)`; if no sid, `ENV_VAR[agent]` for each agent whose variable is set (Claude first); else frontmatter.
- [ ] **Step 4:** run, expect OK.
- [ ] **Step 5: Commit** `feat(ask): export the lead's conversation for the invited models, newest first`.

### Task 3: jobs — `_run`, `ask`, `wait`, `status`, `stop`

**Files:**
- Modify: `skills/lib/ao_ask.py` (add `main`)
- Create: `skills/lib/fixtures/ask/bin/{claude,codex,copilot}` (fake CLIs: print their argv to a file named by `$AO_FAKE_LOG`, then behave per `$AO_FAKE_MODE`: `answer` prints "PAPAYA" after 1 s; `slow` sleeps 8 s then answers; `fail` prints `Error: Model "x" from --model flag is not available.` to stderr and exits 1; `stdin` reads stdin and prints what it got; for codex also writes the answer to its `-o` path)
- Modify: `skills/lib/test_ao_ask.py`

**Interfaces:**
- Produces:
  - CLI: `ao_ask.py guide|ask|wait|status|stop --session <notes> …` and the private `_run <job_dir>`.
  - `new_job(paths, inv, question, cwd) -> dict` — creates `.ao/.gitignore`, the job dir and `job.json` (`state: "starting"`), writes `question.md`.
  - `spawn_runner(job_dir) -> None` — double fork; the grandchild `os.setsid()`, stdin `/dev/null`, execs `sys.executable ao_ask.py _run <job_dir>`.
  - `run_job(job_dir)` — the runner body: writes the export, builds argv, starts the CLI with `preexec_fn=os.setpgrp` inside `bash -c 'set +m; exec "$@"' _ <shell argv>`… (simplest correct form: `subprocess.Popen(shell_argv(...), start_new_session=False, preexec_fn=os.setpgid(0,0))`), records `runner_pid`, `cli_pgid`, writes the registry file, waits, reads the answer (`last.txt` for codex, else `out.log`), sets `state` done/failed (failed when exit ≠ 0 or the answer is empty; `reason` = the last error line, the JSON `message` for Codex), appends the entry under `flock`, removes the registry file. SIGTERM handler: `os.killpg(cli_pgid, SIGTERM)`, 2 s later `SIGKILL`, `state: stopped`, append an entry saying it was stopped.
  - `read_job(job_dir) -> dict` — adds `state: "lost"` when `runner_pid` is dead and state is `running`.
  - `follow(job_dir, seconds, out)` — prints the header, a progress line every 15 s, then the framed answer (escape sequences removed: `re.sub(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07', '', s)`) or the "still running — run: … wait <id>" line.
  - `REGISTRY = ~/.config/ai-agents-orchestrator/asks` (overridable by `AO_ASK_REGISTRY` for tests).

- [ ] **Step 1: Failing tests** — `Jobs` class, each with `PATH` prefixed by the fake bin dir, `SHELL=/bin/sh`, a temp session folder and `AO_ASK_REGISTRY` in a temp dir:
  - `test_ask_prints_the_framed_answer_and_writes_the_thread`
  - `test_a_failing_cli_is_recorded_failed_with_its_reason`
  - `test_stop_is_recorded_stopped_and_kills_the_cli`
  - `test_runner_survives_its_follower` (start `ask --follow 1` on `slow`, it returns "still running"; kill its process group; 10 s later `job.json` is `done` and the entry is in the thread)
  - `test_wait_picks_up_a_job_already_started`
  - `test_stdin_is_dev_null` (`stdin` mode prints an empty input)
  - `test_a_dead_runner_is_lost` (write a `job.json` with `state: running` and a dead pid)
  - `test_registry_holds_the_cli_group_while_it_runs_and_is_emptied_after`
  - `test_status_lists_jobs_with_quiet_seconds`
- [ ] **Step 2:** run, expect failures.
- [ ] **Step 3:** implement (as in Interfaces).
- [ ] **Step 4:** run, expect OK; run `npm run -s test:py`.
- [ ] **Step 5: Commit** `feat(ask): run a consultation as a detached job the lead can follow, wait on and stop`.

### Task 4: backend — invitees in the notes, thread, stop, advisor turns filtered

**Files:**
- Create: `src-tauri/src/advisors.rs`
- Modify: `src-tauri/src/lib.rs` (mod, commands, handler), `src-tauri/src/reader.rs` (advisors field; pidfile filter), `src-tauri/src/doctor.rs` (filter), `src-tauri/src/skills.rs` (`pub(crate) fn ensure_lib() -> Result<(), String>`)
- Modify: `renderer/lib/tauri-api.js` (wrappers)

**Interfaces:**
- Produces (Rust):
  - `advisors::Invitee { id, cli, model, label }` (serde)
  - `advisors::validate(list: &[Invitee]) -> Result<(), String>`
  - `advisors::notes_with(content: &str, list: &[Invitee], guide_cmd: &str) -> String` — sets or removes the `advisors:` line and the `## Other models` section.
  - `advisors::thread(notes_path: &str) -> serde_json::Value` — `{ entries: [{id, invitee, state, at, took, heading, question, answer}], jobs: [{id, invitee, label, state, startedAt, quietSecs}] }`, bounded.
  - `advisors::registered_groups() -> Vec<i32>` — pgids in the registry whose `runner_pid` is alive.
  - Tauri commands: `advisors_set(notes_path: String, advisors: Vec<Invitee>) -> Result<(), String>`, `other_models(notes_path: String) -> Value`, `advisor_stop(notes_path: String, id: String) -> Result<(), String>`.
  - Renderer wrappers: `api.advisorsSet(notesPath, advisors)`, `api.otherModels(notesPath)`, `api.advisorStop(notesPath, id)`.
  - Reader: every session JSON gains `advisors: [...]` (parsed with `serde_json::from_str` of the frontmatter value; `[]` when absent; `advisorsUnreadable: true` when present and unparsable).
- [ ] **Step 1: Failing tests** in `advisors.rs`: `validate_accepts_opus_1m_and_refuses_a_dash_model`, `notes_with_writes_one_unquoted_line_and_the_section`, `notes_with_an_empty_list_removes_both`, `thread_parses_marked_entries_only_and_bounds_them`, `a_dead_runner_is_lost`, `stop_refuses_a_pid_that_is_not_its_runner`; in `reader.rs`: `the_session_carries_its_advisors`, `a_registered_advisor_pid_is_not_a_session`; in `doctor.rs`: `a_registered_advisor_turn_is_not_a_lost_session`.
- [ ] **Step 2:** `cargo test advisors` etc., expect failures.
- [ ] **Step 3:** implement. `advisors_set` calls `skills::ensure_lib()` (extract `SHARED_LIB` into `~/.claude/skills/lib` via `extract_into`), validates, `atomic_write`s. The guide command in the section: `python3 ~/.claude/skills/lib/ao_ask.py guide --session '<notes>'` (via `pty::shell_quote`). `advisor_stop` reads `job.json`, checks `ps -o command= -p <runner_pid>` contains `ao_ask.py _run` and the job dir, then `libc::kill(pid, SIGTERM)`. Reader/doctor: where they skipped `collab::engine::turn_groups()`, also skip `advisors::registered_groups()` (the collab part goes in Task 5).
- [ ] **Step 4:** run cargo tests and clippy `-D warnings`, expect green.
- [ ] **Step 5: Commit** `feat(advisors): write invited models to the notes, read their thread, stop a consultation`.

### Task 5: remove the headless collab, keep 0.21.0 sessions readable

**Files:**
- Delete: `src-tauri/src/collab/` (whole module; `TURN_MARK` moves to `reader.rs` as a const)
- Modify: `src-tauri/src/lib.rs`, `reader.rs`, `doctor.rs`, `renderer/index.html`, `renderer/app.js`, `renderer/ui.js`, `renderer/lib/tauri-api.js`, `renderer/style.css`
- Delete: `scripts/smoke/collab.spec.js`; Modify: `scripts/smoke/agents.spec.js`, `scripts/smoke/app-update.spec.js`
- Test: `scripts/smoke/legacy-collab.spec.js` (new)

- [ ] **Step 1: Failing test** `legacy-collab.spec.js`: a fixture closed session with `collab: 'cross-review'` and `collabThread` shows a read-only "Collab thread" section, no Stop, and its menu's Restart row is disabled with a reason; ＋New's Agent select has no "Collab" option.
- [ ] **Step 2:** run, expect failure on the Collab option.
- [ ] **Step 3:** remove everything listed in the spec's "Removed" section; keep the reader's `collab`/`collabThread` for historical sessions, `restart_refusal`, the UI guards, `collabSection` reduced to the read-only thread, and the `TURN_MARK` import check. Remove `reader::live_claude_cwds` if unused (clippy tells).
- [ ] **Step 4:** `cargo clippy --all-targets -- -D warnings`, `cargo test`, `npx jest`, `npx playwright test` all green.
- [ ] **Step 5: Commit** `refactor(collab): remove the headless collab; 0.21.0 collab sessions stay readable`.

### Task 6: `renderer/lib/other-models.js`

**Files:** Create `renderer/lib/other-models.js`, `__tests__/other-models.test.js`; add the script tag in `renderer/index.html`.

**Interfaces — Produces (window.CSMOtherModels):**
- `CLIS = ['claude', 'codex', 'copilot']`, `MODEL_RE`
- `label(cli, model) -> string` — `claude` → `Claude · <model>` (model shown as the CLAUDE_MODELS label when known), `codex` → `GPT (Codex)` or `GPT · <model> (Codex)`, `copilot` → `Copilot` or `Copilot · <model>`.
- `withIds(rows) -> invitees` — ids `claude-<model-slug>`, `gpt`, `copilot`, suffixed `-2`, `-3` on repeats.
- `chip(invitees) -> string` — `+ GPT, Copilot` (short names, deduplicated, max 3 then `+N`).
- `inviteLine(invitees, notesPath) -> string` and `dismissLine() -> string`.
- `pasteThenEnter(text) -> [string, string]` — `['\x1b[200~' + text + '\x1b[201~', '\r']`.
- `entriesForDisplay(thread) -> [{heading, question, answer, state, folded}]` — latest two unfolded.
- [ ] Steps: failing jest tests for each function (ids unique, `opus[1m]` valid, label forms, chip dedupe, invite line contains the shell-quoted path and every label, paste framing, folding); implement; `npx jest`; commit `feat(ui): the model for inviting models into a session`.

### Task 7: UI — Invite/Dismiss, dialog, send, chip, thread

**Files:** Modify `renderer/ui.js`, `renderer/index.html` (dialog `#invite-models-modal`), `renderer/style.css`, `renderer/app.js` (`SHORTCUT_ACTIONS`: `inviteModels`, `dismissModels` with session labels "Invite models…", "Dismiss models"); Test `scripts/smoke/invite-models.spec.js`; fixture additions in `scripts/screenshots/fixture.js` (`advisors_set`, `other_models`, `advisor_stop`, `agents_available`).

- [ ] **Step 1: Failing Playwright tests**:
  - `invite is refused while the session works or waits` (busy fixture session: the menu row disabled with the "working" reason; no `pty_input` call).
  - `the dialog offers the installed CLIs with a model each, and the notice`.
  - `Invite writes the invitees, then pastes the line and presses Enter` (checks `advisors_set` args; two `pty_input` calls, the first bracketed, the second `\r`).
  - `a session with invitees shows the chip and the Other models thread; Stop stops a running one`.
  - `Dismiss clears the invitees and tells the terminal`.
  - `a Codex session can invite models` (the pinned-skill refusal of non-Claude sessions does not apply).
- [ ] **Step 2:** run, expect failures.
- [ ] **Step 3:** implement: menu rows in `sessionMenuRows` (`data-invite-models`, `data-dismiss-models`), the same in the actions bar; the dialog built from `window.api.agentsAvailable()` and `window.CLAUDE_MODELS`, suggestions from `localStorage['csm.inviteModels']`; on Invite: `advisorsSet` → on ok, `ptyInput(key, paste)` then after 200 ms `ptyInput(key, '\r')`; external terminal (no key): show the line with a Copy button. The **Other models** section polls `otherModels` when the detail pane shows a session with invitees (every 5 s, with the existing refresh).
- [ ] **Step 4:** `npx playwright test`, `npx jest` green.
- [ ] **Step 5: Commit** `feat(ui): invite other models into a session and follow their answers`.

### Task 8: ＋New's Invite models row

**Files:** Modify `renderer/index.html`, `renderer/app.js`; Test in `scripts/smoke/invite-models.spec.js`.

- [ ] Failing test `a new session with models picked gets the invitation once it is idle, and a reload keeps it pending`; implement (row with the same picker collapsed; after `start_session` resolves, `advisorsSet(notesPath, list)` and `sessionStorage['csm.pendingInvite:' + notesPath] = line`; on each refresh, a session that is `idle` with a terminal and a pending line gets it pasted once and the key removed); run; commit `feat(ui): invite models when starting a session`.

### Task 9: the restart-session skill, docs, changelog

**Files:** Modify `skills/restart-session/SKILL.md` (Step that parses sections: add "Other models"; Step 7 prints its guide line when present), `README.md` (a short "Other models" part in the features list, the what not the how), `CHANGELOG.md` `[Unreleased]` (Added: invite models; Removed: the headless collab), `docs/index.html` only if it names the collab.
- [ ] Update, run `npm run -s test:py` (skills tests) and commit `docs: invite models in the README, the changelog and restart-session`.

### Task 10: proofs on the real CLIs

- [ ] From this session (a Claude Code lead): write invitees for Claude haiku, Codex and Copilot into a scratch notes file with the real `advisors_set` logic (a `cargo test`-free path: call `ao_ask.py` with a hand-written frontmatter), then `ao_ask.py ask` each with a question needing two file reads in the scratch folder; record answers, times, that the repo stayed clean, and that no phantom session appears in `~/.claude/sessions` filtered by the registry.
- [ ] Probe Claude plan mode with a multi-read question (`--output-format json` once, to see whether `result` carries the text).
- [ ] Read one real `codex exec` rollout's `session_meta.originator`; if distinct, add the skip in `codex::find_started` with a test; ledger the ruling otherwise.
- [ ] Record the results in the spec's "Probed" table; commit `docs(spec): record the proofs of invite models on the real CLIs`.

## Self-review

- Spec coverage: user flow 1–8 → Tasks 6–8; ao_ask → 1–3; export → 2; notes/thread → 1, 3, 4; backend → 4; renderer → 6–8; removed/legacy → 5; errors → tests in 1–5, 7; proofs → 10; restart-session → 9. Codex escalation → guide (Task 1) and the error message in `ask` (Task 3: when the CLI fails with a resolver error, `reason` says "run with escalated permissions").
- Types: `Invitee {id, cli, model, label}` in Rust, the same keys in Python and JS.
