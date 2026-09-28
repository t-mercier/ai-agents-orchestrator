Inventory: every place the app assumes Claude Code, and how to split it for Codex and Copilot

Repo root: /Users/timothee.mercier/my_projects/agents-orchestrator (every path below is relative to it). This was read-only; I edited nothing.

**Coverage.** I read these in full: reader.rs up to line 1947 (only grepped its test tail), lib.rs, pty.rs, hooks.rs, skills.rs, statusline.rs, ctxbudget.rs, brutus.rs, brutus_agent.rs, onboarding.rs, pinned.rs, doctor.rs (grepped its test tail), all 7 hooks/*.py, scripts/ao-statusline.sh, and the frontmatter of all 14 SKILL.md files. For secaudit.rs, config.rs, prstatus.rs, terminal.rs, git.rs, skills/lib/*.py, rename.py, the skill bodies, the renderer JS/HTML, tests and fixtures, I read targeted sections found by grep.

**Labels.**
- **SHARED**: works for all three tools as-is. Sometimes this needs a path change or an extra field; that is noted.
- **ADAPTER**: needs one implementation per tool.
- **CLAUDE-ONLY**: keep it for Claude; the other adapters return None or no-op.

## 0. Findings that change the design

1. **Nothing records which tool a closed session belongs to.** The planned state file only exists while the process runs. Resume, Restart, wrap and headless skill runs on a closed or stale session must still know which CLI to launch. So `agent:` has to be added in two places:
   - notes.md frontmatter, written by `/start-session`, `/import-session` and `/restart-session`. The frontmatter template is at `skills/start-session/SKILL.md:160-169`.
   - every `active-sessions.json` entry (`start-session/SKILL.md:225-235`).
   The consumers that need it:
   - `reader.rs:1660-1665` (effective session id taken from the frontmatter)
   - `lib.rs:281-308` (open_in_terminal), `lib.rs:611-641` (restore_session), `lib.rs:1233-1260` (wrap_session)
   - `pinned.rs:106-134` (run_skill), `prstatus.rs:291-302` (sync_refs), `onboarding.rs:125-153` (headless import)
   - `pty.rs:171-201` (pty_spawn)

   A missing value should default to `claude`, for backward compatibility. `active-sessions.json` is owned by this app even though it lives under `~/.claude` (`reader.rs:145-150`, `lib.rs:939,968,983`), so it is SHARED. Moving it is optional.

2. **The per-launch settings injection does not port.** `launch_settings_arg` (`lib.rs:39-91`) writes `launch-settings.json` (a statusLine wrapper plus the unwired hooks) and passes `--settings`. It is called from `lib.rs:290,503,632` and `pty.rs:182,193`. Copilot has no `--settings` flag. Codex only has `-c` and `--profile`. So "inject hooks per launch without touching the global config" is CLAUDE-ONLY.
   - For Codex and Copilot, installing hooks has to be a global write: `~/.codex/hooks.json` (or `config.toml [hooks]`) and `~/.copilot/hooks/*.json`.
   - That write should go through the same preview, backup and atomic-write steps as `hooks.rs:342-395`.
   - Codex also requires the user to trust hooks before they run (research gap 8), or the launch must pass `--dangerously-bypass-hook-trust`.

3. **Skills are invoked as `/name`, which is not portable. It happens in two ways:**
   - As a prompt argument to the CLI: `lib.rs:488` (`/start-session`), `lib.rs:628` (`/restart-session`), `lib.rs:1259` (`/wrap-session`), `onboarding.rs:21-25` (`/import-session`), `prstatus.rs:301` (`/sync-refs`), `pinned.rs:132` (`/{skill}`), `pty.rs:199` (`/restart-session`).
   - As keystrokes typed into the embedded terminal: `renderer/terminal.js:371` (`'/close-session\r'`), `renderer/lib/skill-launch-model.js:33` (`'/'+name+'\r'`) and `:35` (`prompt: '/'+name`), `renderer/ui.js:1382` (ptyInput of that string).

   Codex invokes a skill as `$name` and does no `$ARGUMENTS` substitution (gap 9). The skills that read `$ARGUMENTS` would lose their arguments there: `import-session/SKILL.md:30`, `restart-session/SKILL.md:23-25,70`, `start-session/SKILL.md:33`, `skills-review/SKILL.md:27`. Skills that take positional arguments in prose also need the literal text after the name: `archive-session:30`, `rename-category:30-32`, `sync-refs`, `wrap-session:27-36`.

   One adapter function, `skill_invocation(name, args) -> String`, covers every call site. The skills must also be rewritten to read "the text after the skill name" rather than `$ARGUMENTS`.

4. **The skills find their own session id through Claude's pidfiles. This is the deepest Claude coupling in `skills/`.**
   - They walk up the parent pids of the running process and match them against `~/.claude/sessions/<pid>.json`: `start-session/SKILL.md:66-107` (with a fallback to cwd plus `status=='busy'` at 96-107), `close-session:40-56`, `save-session:46`, `import-session:59`, `restart-session:103`, `learn:71`, `route:50`, and `rename-category/rename.py:18,136` (live ids).
   - "Step 9 rename" writes `name` straight into Claude's pidfile: `start-session:275-288`, `restart-session:299-311`. `restart-session:45` reads `cwd` from the same pidfile.

   Recommendation: name the app's state file `<pid>.json` in the app's own directory, so the parent-pid walk stays identical and only the directory changes. Move the walk and the rename into a `skills/lib/aosession.py` helper (`current` / `rename`), and have the skills call it. That removes the Claude-only pidfile patch.

5. **Status sources need a decision.** Claude's pidfile emits `idle | busy | waiting | shell` (`reader.rs:914`; the renderer reads it at `ui.js:242`, `board.js:52-55`, `app.js:406,1154,1366-1370`, `lib/brutus-model.js:15`, `lib/skill-launch-model.js:25`).
   - Hooks cannot produce `shell`.
   - `waiting` needs the PermissionRequest hook on Codex, and the `notification` hook (`permission_prompt`, `agent_idle`) on Copilot.
   - For Claude, you must choose one of two options:
     - (a) keep reading `~/.claude/sessions/<pid>.json` as the source of truth, and treat the state file as a supplement;
     - (b) switch Claude to the hook-written state file too, and add a PermissionRequest/Notification hook for `waiting`.
   - The mtime override that turns a stale `idle` into `busy` (`reader.rs:909-926`) becomes SHARED once `transcript_path` comes from the state file.

6. **Copilot drops or ignores several of the hooks' output channels** (gap 6):
   - UserPromptSubmit `additionalContext`, dropped by Copilot: `ao_checkpoint_relay.py:44-49`, `learn_nudge.py:128-133`.
   - `systemMessage`, which has no Copilot equivalent: `ao_autosave.py:177`, `ao_precompact.py:114`, `pr_attach.py:178`.
   - Stop `decision: block` (`ao_autosave.py:172`): unverified on Copilot's `agentStop`.
   - Checks against Claude tool names, so ADAPTER: `ao_skill_guard.py:28,33-36` (Edit/Write/MultiEdit/NotebookEdit, `file_path`/`notebook_path`) and `pr_attach.py:39-42,51-53` (`Bash` `tool_input.command`, `mcp__…__create_pull_request`, `tool_response`).
   - `ao_autosave.py:54-60` reads `contextPct` from the statusline cache. Codex has no custom status line, so the percentage must come from `token_count` events in its rollout file (gap 7).

7. **Filters for background runs and Brutus.** Three filters would collapse into one state-file `kind` field, set from the `AO_HEADLESS` variable: `kind == "bg"` (`reader.rs:677,851`), `background: true` (`doctor.rs:780`) and `is_brutus_cwd` (`reader.rs:502,860`, `brutus_home.rs:196-203`). Brutus runs with `--restricted` and his own `--settings` (`brutus.rs:28-56`), so the shared hook never fires for him and he is excluded without extra work. I'd keep `is_brutus_cwd` as a defensive check.

## 1. Session discovery and status

- `reader.rs:24-44` `alive(pid)`: kill(pid,0) plus an identity check. ADAPTER. It must become `alive(pid, agent)`, because the IDENTITY cache (`:50`) is keyed by pid only.
- `reader.rs:65-83` `identify()`: calls `ps -o comm=`, then `args=`. SHARED mechanism; the matching predicate is ADAPTER.
- `reader.rs:89-106` `is_session_comm` / `is_session_process`: matches `claude`, `node` and `/claude/versions/`. ADAPTER: Codex is `codex`, a node or Rust binary; Copilot is `copilot` or node.
- `reader.rs:108-139` the `Transcript` struct (git_branch, pr_link, pr_urls, last_activity(_at), cwd, launch_cwd, found, mtime, continued_in): SHARED type, filled by the adapter.
- `reader.rs:145-150` `load_active_sessions()` reads `~/.claude/active-sessions.json`: SHARED (the app's registry).
- `reader.rs:155-206` PR URL extraction and pick over raw text: SHARED.
- `reader.rs:211-317` `read_transcript`: scans `~/.claude/projects/*/<sid>.jsonl` and folds `gitBranch`, `prLink`, `cwd` (first and last), `type=continued-in`, `type=assistant` → `message.content[].text` + `timestamp`. ADAPTER. Codex: `session_meta.payload.{cwd,git.branch}`, `turn_context`, `event_msg`. Copilot: `events.jsonl`, `session.start.data.context` (unverified). The (len, mtime) cache at `:13-20,222-228,308-315` is SHARED.
- `reader.rs:322-327` `resolve_session_cwd` uses the transcript's first cwd as the resume key: ADAPTER. Codex resumes from a different cwd with an interactive prompt, so pass `-C`. Copilot resumes in its saved cwd.
- `reader.rs:333-357` `resolve_slug_cwd` / `restart_dir`: SHARED.
- `reader.rs:362-376` `is_title_noise` (`<command-name>`, `system-reminder`, "Base directory for this skill", "Caveat:", "Continue from where you left off", "[Request interrupted"): ADAPTER, since these are Claude harness markers.
- `reader.rs:383-454` `discover_meta_lines` / `discover_meta` (`isSidechain`, `type=user`, `message.content`, `<command-name>`/`<command-message>`): ADAPTER.
- `reader.rs:459-483` `managed_session_ids`: SHARED.
- `reader.rs:492-548` `sorted_unmanaged`, `select_unmanaged_page`, `discover_sessions_page`: SHARED, but rows should gain an `agent` field.
- `reader.rs:552-589` `scan_unmanaged_rows` walks `~/.claude/projects/**`: ADAPTER. Codex: `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`, or the sqlite `threads` table. Copilot: `~/.copilot/session-state/<id>/`.
- `reader.rs:592-772` notes, frontmatter and links helpers (extract_section, NotesMeta, merge_links, root_for_notes_path, space_root_for_notes, session_dir, resolve_pr_links, link_fields): SHARED.
- `reader.rs:656-691` `running_session_ids` reads `~/.claude/sessions/*.json`, checks `kind`, `pid`, `sessionId`, and `alive`: ADAPTER. It moves to the state directory, which then makes it SHARED.
- `reader.rs:782-801` `live_session_of` / `follow_continued` (`continued-in` hops): CLAUDE-ONLY; the other adapters return None.
- `reader.rs:803-1004` `get_sessions`:
  - `:808` reaps finished embedded terminals first (`pty.reap_exited`): SHARED.
  - `:815-827` builds a sessionId → status map from the pidfiles: ADAPTER; becomes SHARED once it reads the state files.
  - `:830-862` iterates pidfiles and reads `sessionId`, `kind`, `pid`, `cwd`: ADAPTER; SHARED via the state files.
  - `:877-884` git branch comes from live git, falling back to the transcript's `gitBranch`: SHARED.
  - `:889` `data.name` is the name from the pidfile: this should become the state file's `name`.
  - `:909-926` stale `idle` overridden to `busy` when the transcript mtime is under 10 s old: SHARED.
  - `:916-923` follows continued sessions: CLAUDE-ONLY.
  - `:952` `entrypoint` (`cli` / `claude-desktop`): CLAUDE-ONLY.
  - `:954` `updatedAt` from the pidfile: taken from the state file.
  - `:973-1003` `recover_unregistered`: SHARED.
- `reader.rs:1011-1019` `notes_records_session` and `is_resumable_sid` (UUID-ish, 32 characters or more, hex and dashes): SHARED. Codex and Copilot ids are UUIDs too. The comment at 1015 says "real Claude session id".
- `reader.rs:1036-1068` `pick_resumable_sid` / `latest_resumable_sid`: SHARED, but the `read_transcript` inside must route through the session's adapter.
- `reader.rs:1075-1084` `transcript_path(sid)`: ADAPTER.
- `reader.rs:1088-1186` `user_text`, `preview_ends`, `head_until_user_turn`, `preview_session` (reads `type=user` lines): ADAPTER for parsing a turn, SHARED for the head/tail bounded read.
- `reader.rs:1188-1190` `has_transcript`: ADAPTER via `transcript_path`.
- `reader.rs:1241-1611` frontmatter parsing, history state, `reopened_after_close` (uses transcript mtime) and `is_wrapped_up`: SHARED.
- `reader.rs:1617-1769` `scan_historical`: SHARED once transcript lookup goes through the adapter chosen by the frontmatter `agent`. The comments at `:1708-1718` say "Resume is keyed by the dir `claude` was LAUNCHED from".
- `lib.rs:202-209` `is_valid_session_id` (comment: "A Claude Code sessionId … ~/.claude/projects"): SHARED rule.
- `doctor.rs:724-790` `scan_pidfiles` over `~/.claude/sessions`: ADAPTER, SHARED via the state directory. See also section 7.

## 2. Launch, resume, restart, fork and headless runs

- `pty.rs:18-36` `model_flag()` / `model_flag_from` produce ` --model '<cfg.claudeModel>'`: ADAPTER. Codex uses `-m`, Copilot `--model`, and each tool needs its own model list.
- `pty.rs:163-201` pty_spawn command. ADAPTER:
  - `:176` runs the embedded +New command verbatim;
  - `:183-189` `cd <cwd> && claude --resume <sid> [--model] --permission-mode auto --settings …`;
  - `:194-200` `claude [--model] --permission-mode auto --settings … '/restart-session <slug>'`.
- `pty.rs:202-223` login shell `$SHELL -ilc`, environment scrubbing and `TERM`: SHARED.
- `pty.rs:69-81` `kill_all` on exit: SHARED.
- `lib.rs:39-91` `launch_settings_arg` (reads `~/.claude/settings.json` `statusLine.command`, wraps it with `~/.claude/ao-statusline.sh`, adds `hooks::launch_hooks`, writes `~/.config/ai-agents-orchestrator/launch-settings.json`, returns ` --settings '<file>'`): CLAUDE-ONLY (see finding 2).
- `lib.rs:281-308` `open_in_terminal`: `cd <cwd> && claude --resume <sid> --model --permission-mode auto --settings`. ADAPTER.
- `lib.rs:416-554` `start_session`:
  - `:488-495` builds `/start-session <CAT> [TICKET] <name> [--pr] [--root] [--start-in]`: prompt SHARED, invocation form ADAPTER.
  - `:503-509` `claude --model --permission-mode auto --settings '<prompt>'`: ADAPTER. Copilot needs `-i "<prompt>"` to run a prompt interactively. Codex takes `codex "<prompt>"`.
  - `:512-530` cd / git checkout wrapper: SHARED.
  - `:531-551` embedded variant returns the command and the predicted notesPath: SHARED.
  - The function takes no `agent` parameter today.
- `lib.rs:611-641` `restore_session`: `claude --model --permission-mode auto --settings '/restart-session <slug>'`. ADAPTER.
- `lib.rs:1232-1306` `wrap_session`: `AO_HEADLESS=1 claude --resume <sid> --model --permission-mode acceptEdits -p '/wrap-session <notes> <sid>'`. ADAPTER. Codex: `codex exec resume <id> "<prompt>"` with sandbox and approval flags. Copilot: `copilot --resume=<id> -p "<prompt>" --allow-all-tools`. The comment at `:1224-1226` says "--resume runs under a NEW session id", which is Claude behaviour; the skill already takes the original id as an argument, so that part is SHARED.
- `lib.rs:1216-1219` `WRAP_TIMEOUT`: SHARED.
- `onboarding.rs:18-30,147-153` `import_session_headless`: `claude --resume <sid> --model --permission-mode acceptEdits -p '/import-session …'`. ADAPTER.
- `prstatus.rs:291-302` `sync_refs`: `AO_HEADLESS=1 claude --model --permission-mode acceptEdits -p '/sync-refs <notes>'` (no resume). ADAPTER.
- `prstatus.rs:91-120` `run_within`: SHARED.
- `pinned.rs:106-134` `run_skill`: `AO_HEADLESS=1 claude --model [--resume] --permission-mode acceptEdits -p '/<skill>'`. ADAPTER.
- Flags per tool:
  - `--permission-mode auto` (all interactive launches) maps to Codex `-a on-request -s workspace-write` and Copilot `--allow-all-tools` or `--mode`.
  - `--permission-mode acceptEdits` (all headless runs) maps to Codex `exec -s workspace-write -a never` and Copilot `-p --allow-all-tools`.
- `--session-id`: not used anywhere. `--fork-session`: not used anywhere. No fork feature needs porting.
- `config.rs:254-256,477` the `claudeModel` config key: ADAPTER. Proposal: a per-agent `models: {claude, codex, copilot}` map plus a `defaultAgent` key.
- `terminal.rs:76, 269` `launch_in_terminal` (iTerm/Terminal/Linux): SHARED.
- `terminal.rs:95` `session_tty(pid)`: SHARED.

## 3. Hook installation and what each script reads and writes

- `hooks.rs:36` embeds `../hooks`: SHARED.
- `hooks.rs:40-85` `SHIPPED` (file, event, matcher, description). ADAPTER, because both event and matcher names differ per tool:
  - `ao_skill_guard.py`: PreToolUse, matcher `Edit|Write|MultiEdit|NotebookEdit`.
  - `ao_autosave.py`: Stop.
  - `ao_checkpoint_relay.py`: UserPromptSubmit.
  - `ao_precompact.py`: PreCompact.
  - `ao_session_start.py`: SessionStart.
  - `pr_attach.py`: PostToolUse, matcher `Bash|mcp__.*__create_pull_request`.
  - `learn_nudge.py`: UserPromptSubmit.
  - Codex names are the same events in PascalCase. Copilot names are camelCase (`preToolUse`, `agentStop`, `userPromptSubmitted`, `preCompact`, `sessionStart`, `postToolUse`); using PascalCase names switches it to Claude-shaped payloads, which I'd recommend.
- `hooks.rs:87-93` `hooks_dir()` and `settings_path()` are `~/.claude/hooks` and `~/.claude/settings.json`: ADAPTER. The hook scripts could live once in `~/.config/ai-agents-orchestrator/hooks/` (SHARED) and be referenced from each tool's config.
- `hooks.rs:99-107` `command_for` hard-codes `$HOME/.claude/hooks/<file>`: ADAPTER, or SHARED if the scripts move.
- `hooks.rs:120-171` `walk`, `is_wired`, `pr_attach_sees_mcp`, `gap`: the JSON shape `hooks.<Event>[].{matcher,hooks[].command}` is ADAPTER. Codex hooks.json is Claude-like. Copilot uses `{"version":1,"hooks":{…}}`.
- `hooks.rs:173-192` `read_settings_at`: SHARED for JSON. Codex `config.toml` would need TOML.
- `hooks.rs:196-204` `advisor_model()` reads `advisorModel` from `~/.claude/settings.json`: CLAUDE-ONLY.
- `hooks.rs:208-237` `status` and `install_scripts` copy scripts to `~/.claude/hooks`: ADAPTER, or SHARED with a shared directory.
- `hooks.rs:243-312` `add_group` / `merge_settings` (plus advisorModel at `:302-310`): ADAPTER, with the advisor part CLAUDE-ONLY.
- `hooks.rs:318-329` `launch_hooks`: CLAUDE-ONLY (per-launch injection).
- `hooks.rs:342-417` preview, write and backup (`settings.json.ao-backup-<ts>`): SHARED ceremony, with the target path from the adapter.
- `skills.rs:441,597` call `hooks::install_scripts()` alongside the skills: SHARED.

Per hook script (all read `AO_HEADLESS` except the guard, pr_attach and learn_nudge; all read `~/.claude/active-sessions.json`, which should become the shared registry path):

- **`ao_autosave.py`**
  - Reads stdin `session_id`, `stop_hook_active` (`:133`) and `transcript_path` (`:147`); Copilot only sends `transcriptPath` on `agentStop`.
  - Reads `~/.claude/statusline-cache.json` `sessions.<id>.contextPct` (`:39,54-60`): ADAPTER.
  - Writes `~/.claude/hooks-state/ao_autosave/<sid>.json` (`:40`): SHARED, better moved to the app's config directory.
  - Emits `decision: block` (`:172`) and `systemMessage` (`:177`).
  - Overall ADAPTER, for the output channel and the context source.
- **`ao_checkpoint_relay.py`**: reads the same state (`:15`); emits `hookSpecificOutput.UserPromptSubmit.additionalContext` (`:44-49`). ADAPTER; Copilot drops it, so deliver at sessionStart or postToolUse there.
- **`ao_precompact.py`**
  - Reads `session_id`, `transcript_path` and `trigger` (`:83-89`).
  - Writes an `(in progress) | session=<id> | transcript=<path>` line into notes.md (`:33-38,90-92`): SHARED.
  - Emits `systemMessage` (`:114`).
  - On Copilot, preCompact is fire-and-forget; its `transcriptPath` is available.
- **`ao_session_start.py`**
  - Reads `session_id` and `source` (`== "compact"` at `:76`).
  - Emits `hookSpecificOutput.SessionStart.additionalContext` (`:111-113`); Copilot supports that on sessionStart.
  - Hard-coded text: "run /learn", "/save-session" (`:36-42,84`). ADAPTER for the skill invocation syntax in that text.
  - Also the best place to write the new state file: record the pid (parent of the hook process) and `session_id`. This is the only session-id source Codex offers for interactive runs (gap 3).
- **`ao_skill_guard.py`**: reads `tool_name`, `tool_input.file_path`/`notebook_path` (`:31-36`) and `~/.claude/skills` (`:24`); emits `permissionDecision: deny` (`:89-95`). ADAPTER: tool names, the skills directory per tool, and the deny output format.
- **`pr_attach.py`**: reads `tool_name`, `tool_input.command`, `tool_response`, `session_id` (`:47-70,151`); writes notes.md frontmatter (`:81-125`, SHARED); emits `systemMessage` (`:178`). ADAPTER for tool-name matching and output.
- **`learn_nudge.py`**: reads `prompt` and `session_id` (`:108-109`); writes `~/.claude/hooks-state/learn_nudge/<sid>` (`:33`); emits UserPromptSubmit `additionalContext` (`:128-133`), which Copilot drops. ADAPTER.
- **New shared hook (proposed).** One script, e.g. `hooks/ao_state.py`, registered on SessionStart, UserPromptSubmit, Stop/agentStop, PreToolUse, PermissionRequest/notification and SessionEnd. It writes `<state_dir>/<pid>.json` (schema in section 10).
- `scripts/install.sh:165-226` copies hooks to `~/.claude/hooks` and prints `~/.claude/settings.json` snippets: ADAPTER.

## 4. Skills installation and Claude-specific skill content

- `skills.rs:27` embeds `../skills`: SHARED.
- Every `~/.claude/skills` destination is ADAPTER: `skills.rs:147,169,312,432,455,593`. Codex reads `~/.agents/skills` (plus repo `.agents/skills`). Copilot reads `~/.copilot/skills` or `~/.agents/skills` (the latter is not read if `COPILOT_HOME` is set). `~/.agents/skills` covers both Codex and Copilot, but not Claude.
- `skills.rs:38-237` manifest, `.ao-base`, `lock_files`, epoch, sync and update-from-checkout logic: SHARED, parametrised by destination.
- `skills.rs:311-321` `drifted_skills` (Doctor) and `skills.rs:325-333` `skill_names`: SHARED.
- `pinned.rs:72-101` `list_skills` reads `~/.claude/skills`: ADAPTER. It should list the directory of the selected session's tool.
- `ctxbudget.rs:71-102` `gather()` (`~/.claude/CLAUDE.md`, `~/.claude/skills/*/SKILL.md` descriptions, `~/.claude/projects/*/memory/MEMORY.md`, `~/.claude.json` mcpServers): ADAPTER. Codex: `~/.codex/AGENTS.md`, `config.toml [mcp_servers]`. Copilot: `~/.copilot/copilot-instructions.md`, `mcp-config.json`. Or scope it out as CLAUDE-ONLY.
- `hooks/ao_skill_guard.py:24` `SKILLS_DIR = ~/.claude/skills`: ADAPTER.
- `skills/lib/patch_apply.py:36-37,117,134` and `skills/lib/skill_usage.py:40-45,200-223` use `CLAUDE_HOME` / `~/.claude/skills`: ADAPTER.
- `skills/lib/skill_usage.py:115-165` reads `attributionSkill` from `~/.claude/projects/**.jsonl`: CLAUDE-ONLY. The research does not report an equivalent in the other tools' transcripts.
- `skills/lib/aoconfig.py:37-38` reads `~/.config/ai-agents-orchestrator/config.json`: SHARED. Every skill calls it as `~/.claude/skills/lib/aoconfig.py` (e.g. `archive-session:39`, `close-session:81,191-192,215`, `start-session:38,55`, `import-session:34,79`, `restart-session:71`, `learn:56`, `route:33,89`), and `pr_mine.py` at `close-session:131`, `save-session:132`, `sync-refs:123`, `wrap-session:87`. ADAPTER for the path; or install `lib/` once in a shared directory and reference it absolutely.

Claude-only content inside the SKILL.md files:

- **`allowed-tools:` frontmatter** in all 14 skills (Bash Read Edit Write AskUserQuestion). Claude syntax; Codex and Copilot ignore it or interpret it differently. Harmless but ADAPTER for semantics.
- **`argument-hint:`** in all 14: Copilot supports it (changelog line 948); Codex ignores it.
- **`$ARGUMENTS`**: `import-session:30`, `restart-session:23,25,70`, `start-session:33`, `skills-review:27`. ADAPTER (finding 3).
- **The `AskUserQuestion` tool**: `import-session:11,39,41,110`, `restart-session:10,77,141`, `start-session:11,34,40,132,146`, `skills-review:10,142`. Claude tool name; ADAPTER (fall back to plain-prose questions).
- **Plan-mode check** ("`Plan mode is active` system reminder"): `archive-session:23`, `close-session:23`, `import-session:23`, `save-session:23`, `restart-session:18`, `skill-propose:38`, `skills-curate:46`, and likely `start-session:26`. CLAUDE-ONLY wording, harmless elsewhere.
- **Session-id discovery through `~/.claude/sessions/*.json`**: see finding 4. ADAPTER, SHARED through `aosession.py`.
- **Writes `name` into Claude's pidfile and suggests `/rename`**: `start-session:262-295`, `restart-session:299-311`. CLAUDE-ONLY. Replace with a state-file rename.
- **Text mentioning `claude --resume` or Claude Code**: `import-session:4,7,69,150`, `restart-session:45,56-59,336`, `rename-category:54`. ADAPTER wording.
- **`~/.claude/skills-pending/` and `~/.claude/skills-applied.log`**: `skill-propose:9-10,25-31,80,119,128-129,152,188,224,251,269,296-315`, `skills-review:4-5,16,35,75,85,88,106,113,133,148-214`, `skills-curate:32-38,54-56,106-107,125,136`. The `.archive` and `.ao-base` paths are ADAPTER. `skills-curate:125` greps `~/.claude/CLAUDE.md`: ADAPTER.
- **`rename-category/rename.py:17-18,136`** (`~/.claude/active-sessions.json`, `~/.claude/sessions`): SHARED for the registry, ADAPTER for live ids.
- **`agents/brutus.md`** plus `brutus_agent.rs`: CLAUDE-ONLY.

## 5. Status line, usage, context percentage and cost

- `statusline.rs:14-34` installs `scripts/ao-statusline.sh` to `~/.claude/ao-statusline.sh` at startup (`lib.rs:1468`). ADAPTER. Copilot has `statusLine.command` (its payload has `session_id` and context-window fields, full field list unverified). Codex has none.
- `scripts/ao-statusline.sh:21-105` parses Claude's statusLine JSON (`rate_limits.five_hour/seven_day.used_percentage`, `resets_at`, `session_id`, `model.display_name`, `context_window.used_percentage`) and writes `~/.claude/statusline-cache.json` as `{global, sessions}`. ADAPTER: the parser is per tool; the cache shape can be SHARED if keyed by agent.
- `scripts/ao-statusline.sh:110-114` hands off to the user's own status line: SHARED.
- `lib.rs:1310-1369` `parse_usage`, `usage_view` (fiveHourPct, sevenDayPct, resets, updatedAt from `global`; model and contextPct per session) and `get_usage` reading `~/.claude/statusline-cache.json`. The 5h/7d limits are a Claude-account concept: keep them CLAUDE-ONLY, or agent-scoped `global`. model and contextPct per session are SHARED, with per-tool sources: Codex from `token_count` rollout events (`total_token_usage`, `model_context_window`); Copilot from its statusLine.
- `hooks/ao_autosave.py:39,54-60` reads that cache for its context tiers: ADAPTER, as above.
- `renderer/app.js:1298-1420` usage bar (`model`, 5h, 7d, ctx bars; idle/busy/waiting fill classes at `1366-1370`): ctx is SHARED; 5h/7d are CLAUDE-ONLY and should be hidden for other tools.
- `lib/tauri-api.js:264-266` `getUsage(sessionId)`: SHARED signature.
- Cost: nothing reads it today.

## 6. Brutus (stays Claude-only)

- `brutus.rs:28-56` `claude_args`: `--restricted --agents <json> --agent brutus -p --output-format stream-json --verbose [--resume id] --tools Read,Glob,Grep,Write,Edit --strict-mcp-config --settings <dir>/settings.json --add-dir … --permission-mode dontAsk [--model]`. CLAUDE-ONLY.
- `brutus.rs:65-69` `shell_line` (`exec env AO_HEADLESS=1 claude … < message.txt`): CLAUDE-ONLY.
- `brutus.rs:80-128` `parse_line` (stream-json `system/init`, `assistant` text and tool_use, `result`) and `missing_conversation` ("No conversation found"): CLAUDE-ONLY.
- `brutus.rs:174` error text "Is Claude Code installed and logged in?": CLAUDE-ONLY.
- `brutus.rs:210-218` `resolve_model` (`claudeModel`, else `~/.claude/settings.json` `model`): CLAUDE-ONLY.
- `brutus.rs:271-302` `prepare()` feeds `reader::get_sessions` and historical sessions into `dashboard.md`: SHARED input. Suggest adding an Agent column in `brutus_home.rs:147-188` (`row` / `dashboard_md`) once sessions carry `agent`.
- `brutus_home.rs:25-60` `settings_json` permission rules (`Edit(//…)`, `Read(//**/.env)`…): CLAUDE-ONLY.
- `brutus_home.rs:196-203` `is_brutus_cwd`: SHARED filter.
- `brutus_agent.rs:1-103`: CLAUDE-ONLY.
- `scripts/probe-brutus-sandbox.sh` and `__tests__/probe-brutus-sandbox.test.js`: CLAUDE-ONLY.
- `renderer/brutus.js:195`: comment only.

## 7. Onboarding and import, Doctor, security audit

- `onboarding.rs:18-30` `import_invocation` (`resolve_session_cwd` plus `/import-session …`): ADAPTER.
- `onboarding.rs:40-55` `needs_onboarding` / `finish_onboarding`: SHARED.
- `onboarding.rs:124-196` headless import (`claude --resume … -p`, success judged by the registry entry): ADAPTER for the command, SHARED for the verification.
- `onboarding.rs:67-93,202-223` notes-path prediction and rollback: SHARED.
- `reader.rs:543-589` the discover rows the import picker uses: ADAPTER. It needs to enumerate all three tools and add `agent` to each row.
- `doctor.rs:43-81` `SessionFacts` and `Snapshot` (`stale_pidfiles` described as "~/.claude/sessions/<pid>.json", `continued_in`, `security`, `context`): shared structure. `continued_in` is CLAUDE-ONLY.
- `doctor.rs:141-160,943-959` `KIND_CONTINUED` finding and repair (`live_session_of`, `rekey_registry_entry`): CLAUDE-ONLY.
- `doctor.rs:205-215,915-928` `KIND_PIDFILE_STALE`: deletes files in `~/.claude/sessions` and checks the parent directory. ADAPTER; with the state directory it becomes SHARED, and it should not delete Claude's own pidfiles once the app has its own.
- `doctor.rs:191-203` `KIND_LIVE_UNREGISTERED`: SHARED once it reads the state files.
- `doctor.rs:278` detail text "Claude Code cannot apply a file it cannot read": ADAPTER wording.
- `doctor.rs:374` "Claude Code prunes old transcripts": ADAPTER wording.
- `doctor.rs:724-790` `sessions_dir()` and `scan_pidfiles` (`sessionId`, `background`, `cwd`): ADAPTER, SHARED via the state directory.
- `doctor.rs:792-857` `snapshot()`: uses `reader::alive`, `has_transcript` and `live_session_of`. Routes through the adapters.
- `doctor.rs:328-366` context-bill findings ("CLAUDE.md {} KB…"): tied to ctxbudget, so ADAPTER.
- `secaudit.rs:67-77` `gather()` (`~/.claude/settings.json`, `settings.local.json`, `~/.claude.json`): ADAPTER. Codex: `~/.codex/config.toml` / `hooks.json`. Copilot: `~/.copilot/settings.json`, `hooks/*.json`, `mcp-config.json`.
- `secaudit.rs:81-161` `facts_from` (Claude settings JSON shape: `hooks.<ev>[].hooks[].command`, `permissions.allow/deny`, `env`, `mcpServers`, `projects.<p>.mcpServers`): ADAPTER.
- `secaudit.rs:166-183` `broad_allow` (Claude permission syntax such as `Bash(*)`): ADAPTER. Codex uses `-a/-s` and approval policy; Copilot uses `--allow-tool`.
- `secaudit.rs:186-193` `risky_hook`, `secretish` (`:206-213`) and `unpinned_npx` (`:216-225`): SHARED.
- `secaudit.rs:197-203` `hook_outside_home` hard-codes `.claude/hooks`: ADAPTER.
- `renderer/doctor.js`: no Claude strings found by grep. SHARED.

## 8. Renderer

UI strings, icons and branches:

- `app.js:172-182` `window.CLAUDE_MODELS` (opus[1m], opus, sonnet, haiku, fable): ADAPTER. Needs per-agent model lists.
- `app.js:421` and `ui.js:209-214` `displayCategory`: `entrypoint === 'claude-desktop'` → "Claude Desktop" group. CLAUDE-ONLY.
- `app.js:1161-1191` skills banner ("Install them into ~/.claude/skills", "Open a fresh Claude Code session"): ADAPTER wording and paths.
- `app.js:1240-1264` checkout-update banner ("~/.claude/skills … the copies Claude Code loads"): ADAPTER.
- `app.js:1298-1420` usage bar: section 5.
- `app.js:455-458,702-716` live session ids and `sessionPidFor`: SHARED.
- `app.js:961-965` placeholder card for an embedded +New (`status:'busy'`): SHARED; add `agent`.
- `ui.js:242` status set `waiting|busy|shell`: SHARED, but `shell` is Claude-only.
- `ui.js:330-342,1216-1233` dot classes and WAIT badge from `s.status`: SHARED.
- `board.js:52-55,86,292`: SHARED.
- `ui.js:698-713,890-899,1161-1202,1474-1488,1813-1815` resume and restart buttons (`canResume` = valid sid and `resumable !== false`; the "Transcript gone → can't --resume" comment at 705): SHARED logic. An agent badge or icon is needed on cards (none exists; I found no agent picker anywhere).
- `ui.js:1360-1396` `pinCtxFor` / `runPinnedSkill` (typed `/name\r`, or `runSkill`): ADAPTER, for invocation syntax (finding 3).
- `ui.js:1608,1624` skill picker text "Reading ~/.claude/skills…": ADAPTER.
- `ui.js:1994-2020` Close and Sync handlers (wrap_session, sync_refs): SHARED calls, but the backend must pick the tool.
- `terminal.js:196-203` Shift+Enter sends a bracketed paste of LF, relying on Claude's TUI keeping pasted newlines. ADAPTER: unverified on the Codex and Copilot TUIs.
- `terminal.js:244` comment "restartSlug makes the pty run /restart": fine.
- `terminal.js:334-390` Close: injects `'/close-session\r'` (`:371`), then polls `notes_closed_since`. ADAPTER for the invocation string; the `\r` submit is likely SHARED but unverified.
- `lib/skill-launch-model.js:13-35` builds `/name` and `resumeId`: ADAPTER. Add an `agent` field to the context.
- `onboarding.js:520,544,701` model select from `CLAUDE_MODELS`, "Follow my Claude Code setting", and writes `claudeModel`: ADAPTER.
- `onboarding.js:540-541` "~/.claude/skills/": ADAPTER.
- `onboarding.js:534-600` hooks and advisor step (`hooksStatus`, `advisorModel`, preview of `settings_path`): ADAPTER. One settings target per installed tool; the advisor part is CLAUDE-ONLY.
- `settings/terminal.js:8-19,56` model select and "Follow my Claude Code setting", `claudeModel`: ADAPTER.
- `settings/general.js:148` "Open a fresh Claude Code session…": ADAPTER wording.
- `index.html:42-47` +New modal: "Launches `claude` in iTerm and runs `/start-session`. The session files are created by Claude Code". It has no agent selector, which is needed.
- `index.html:215` import picker: "The Claude Code sessions already on this machine…". Needs an agent column or filter.
- `index.html:233-262` skills and hooks step text, "Follow my Claude Code setting", `advisorModel`: ADAPTER; advisor is CLAUDE-ONLY.
- `index.html:27,37,114,290,326,350,425-430` "~/.claude/skills", "Claude model", "Claude Code sessions": ADAPTER wording.
- `lib/sync-all-model.js:8`, `lib/onboarding-model.js:149`, `lib/tauri-api.js:126,190-191,209,264-265`: comments mentioning `claude -p`, `claude --resume`, `~/.claude`. Wording only.

IPC commands (from `lib/tauri-api.js`) whose backend is Claude-specific, by backend class:

- **ADAPTER.**
  - Session reads: `get_sessions` (:20), `get_historical_sessions(_all)` (:21,24), `discover_sessions_page` (:29), `preview_session` (:136).
  - Launch and headless runs: `open_in_terminal` (:43), `pty_spawn` (:55), `start_session` (:81, needs an `agent` parameter), `restore_session` (:121), `import_session_headless` (:130, needs `agent`), `wrap_session` (:165), `sync_refs` (:186), `run_skill` (:58).
  - Skills: `list_skills` (:57), `install_skills` (:250), `skills_status` (:213), `sync_skills` (:221), `checkout_update` (:228), `update_from_checkout` (:232). They need a target set, or iterate over installed tools.
  - Hooks: `hooks_status` (:195), `hooks_wire_preview` (:200), `wire_hooks` (:204).
  - Doctor and usage: `doctor_scan` (:241), `doctor_repair` (:243), `get_usage` (:266).
- **CLAUDE-ONLY.** `advisor_model` (:198) and the `brutus_*` commands (:68-73).
- **SHARED.** `can_reveal_terminal` / `reveal_terminal` (:45,47, pid only), `pty_input` / `pty_resize` / `pty_kill`, `notes_closed_since`, `close_session`, `archive_session` / `unarchive_session` / `delete_session`, `set_pr_links` / `set_tickets`, `get_pr_status` / `sync_pr_status`, config commands, `paths_exist`, `needs_onboarding` / `finish_onboarding`, `detach_session`, window commands.

## 9. Tests and fixtures that encode Claude-only data shapes

- `reader.rs` tests:
  - `:1864-1903` comm/args recognition (`claude`, `node`, `…/claude/versions/2.1.278`, `claude bg-pty-host`): these would move to the Claude adapter's tests.
  - `:1907-1945` continued-in chains: Claude.
  - `~:2278-2335` `discover_meta_lines` fixtures (`type:user`, `<command-name>`, `isSidechain`, "Base directory for this skill"): Claude transcript shape.
  - `~:2580-2650` `preview_ends` and `head_until_user_turn` fixtures (`type:user/assistant/summary`, `message.content`): Claude transcript shape.
  - `~:2050` `brutus_runs_are_not_offered_for_import`.
  - `:2208-2245` history lines `transcript=/p.jsonl`: harmless.
- `lib.rs:1861-1874,2020-2064` usage cache fixtures (`fiveHourPct`, `model: "Opus 4.8"`, `contextPct`): Claude statusline shape.
- `pty.rs:324-341` `claudeModel` / `opus[1m]` quoting tests: Claude.
- `hooks.rs:423-627`: every test uses Claude `settings.json` hook JSON, PascalCase events, the `Bash|mcp__…` matcher and `advisorModel`.
- `doctor.rs:1073-1155` pidfile tests (`{sessionId,cwd,background}` in `<pid>.json`); `doctor.rs:402-452` continued-in.
- `secaudit.rs:227+` fixtures `/h/.claude/settings.json`, Claude permission rules.
- `ctxbudget.rs:104-134` (`allowed-tools` frontmatter).
- `brutus.rs:~471-520` and `brutus_agent.rs:58-102`: CLAUDE-ONLY, fine.
- `skills.rs:625-1026`: `~/.claude/skills` layout. Path-agnostic apart from naming.
- `hooks/test_*.py` (7 files): Claude hook payloads (`session_id`, `transcript_path`, `stop_hook_active`, `tool_name`, `tool_input`, `tool_response`, `prompt`, `source`, `trigger`) and output shapes.
- `skills/lib/test_aoconfig.py` and `test_pr_mine.py`: SHARED.
- `__tests__/ao-statusline.test.js:1-24` (`~/.claude`, `{"session_id":"s1"}`): Claude statusline.
- `__tests__/skills-shell-safety.test.js:44-76` (`~/.claude/active-sessions.json`): registry path.
- `__tests__/probe-brutus-sandbox.test.js`: CLAUDE-ONLY.
- `__tests__/skill-launch-model.test.js:4-28` (`/name` invocation).
- `__tests__/brutus-model.test.js:4-23`, `onboarding-model.test.js` and the other `__tests__/*`: no Claude-specific shapes beyond status values.
- `scripts/screenshots/fixture.js`:
  - `:32-33` session objects with `entrypoint:'cli'`, `status: idle|waiting|busy`, `state` (a card is also made at :53);
  - `:141` usage `sessions:{…:{model:'Opus 5',contextPct:41}}`;
  - `:189` Brutus error text;
  - `:300-302` fake terminal output `$ claude --resume`, "Claude resuming…".
  - Add `agent` values here for screenshots.
- `scripts/smoke/*.spec.js` (G:10,83-136, close:16, closed-groups:17,56-57, sort:13, listdrop:14-15, H:100-105, E:25, F:83, ui:299-357): generic session shapes (`sessionId`, `notesPath`, `status`). No `agent`; comments mention claude. Mostly SHARED.
- `scripts/install.sh:9,29,46,165-226` and `scripts/install-macos.sh:67` ("It needs Claude Code…"): ADAPTER.

## 10. Data the UI needs per session, and the proposed state-file schema

**Fields the renderer consumes today.** Running sessions: `reader.rs:928-970`. Historical sessions: `reader.rs:1742-1765`.
- Identity: `sessionId`, `name`, `cwd`, `pid`, `status` (idle|busy|waiting|shell), `state` (active|stale|closed|archived), `entrypoint`, `continuedIn`, `updatedAt`, `notesPath`, `root`, `category`.
- Tickets and PRs: `ticket`, `tickets`, `ticketStates`, `prLink`, `prLinks`.
- Notes content: `goal`, `nextSteps`, `lastSummary`.
- Git and activity: `gitBranch` / `branch`, `worktree`, `lastActivity`, `lastActivityAt`.
- Historical only: `resumable`, `historyStatus`, `historyDate`, `startedAt`.
- From `get_usage`: `model`, `contextPct`, plus the tool-account-wide `fiveHourPct`, `sevenDayPct` and resets.

**Fields to add.**
- `agent` ("claude" | "codex" | "copilot"), on running and historical sessions and on discover rows.
- Optional `model` and `contextPct` inline, so a second IPC call is not needed.
- `kind` ("interactive" | "headless").
- `capabilities` (`{fork, presetId, launchSettings, statusLine}`), so the UI can hide actions a tool cannot do.

**State file** `~/.config/ai-agents-orchestrator/state/<pid>.json`, one file per live process, written atomically by the shared hook:

```json
{
  "v": 1,
  "agent": "claude|codex|copilot",
  "pid": 12345,
  "session_id": "uuid",
  "cwd": "/abs/launch/dir",
  "name": "CAT | name | TICKET",
  "status": "busy|idle|waiting",
  "status_reason": "permission|question|null",
  "transcript_path": "/abs/path/or/null",
  "kind": "interactive|headless",
  "model": "string|null",
  "context_pct": 41,
  "started_at": "ISO",
  "updated_at": "ISO",
  "last_event": "SessionStart|UserPromptSubmit|Stop|PreToolUse|PermissionRequest|SessionEnd"
}
```

- `pid` is the hook process's parent: the CLI process itself.
- `kind` is set from `AO_HEADLESS`.
- `name` is written by `aosession.py rename`, replacing the pidfile patch.
- SessionEnd deletes the file. Readers still check `alive(pid, agent)`, because a crash leaves the file behind.

**Status mapping:**
- UserPromptSubmit or PreToolUse → `busy`
- Stop / agentStop → `idle`
- PermissionRequest (Codex, Claude) or `notification: permission_prompt` (Copilot) → `waiting`
- `notification: agent_idle` → `idle`

**Persisted outside the state file.** notes.md frontmatter `agent:` and the `active-sessions.json` entry field `agent`.

## 11. Recommended module boundaries

```
src-tauri/src/
  state.rs             SHARED: read/write the state dir; list_live() -> Vec<LiveSession>; reap stale files
  agents/mod.rs        enum AgentId { Claude, Codex, Copilot }; trait Agent; fn for_id(AgentId) -> &'static dyn Agent;
                       fn from_str / default (claude when absent)
  agents/claude.rs     today's code moved in: ~/.claude/projects fold, pidfile enrichment, continued-in,
                       launch_settings_arg, statusline wrapper, entrypoint, advisorModel
  agents/codex.rs      rollouts under $CODEX_HOME/sessions (optionally the state_5.sqlite `threads` table),
                       token_count for context, hooks.json, -C on resume, hook trust
  agents/copilot.rs    ~/.copilot/session-state/<id>/events.jsonl, hooks/*.json, statusLine, --session-id
  launch.rs            the command builders in lib.rs/pty.rs/onboarding.rs/prstatus.rs/pinned.rs, rewritten over Agent
  hooks.rs, skills.rs  keep the preview, backup, sync and manifest logic; iterate over installed agents
```

Trait sketch:

```rust
pub enum Perm { Interactive /* today: auto */, HeadlessEdits /* today: acceptEdits */ }
pub struct LaunchSpec<'a> {
    pub cwd: &'a str,
    pub resume: Option<&'a str>,
    pub prompt: Option<String>,
    pub model: Option<&'a str>,
    pub perm: Perm,
    pub headless: bool,
}
pub struct HookSpec { pub ao_event: AoEvent, pub native: &'static str, pub matcher: Option<&'static str> }

pub trait Agent: Sync {
    fn id(&self) -> AgentId;
    fn display_name(&self) -> &'static str;
    fn binary(&self) -> &'static str;                                // "claude" | "codex" | "copilot"
    fn is_process(&self, comm: &str, args: &str) -> bool;            // replaces reader::is_session_process
    // transcripts
    fn transcript_path(&self, sid: &str) -> Option<PathBuf>;
    fn fold_transcript(&self, path: &Path) -> Transcript;            // reader::read_transcript's fold
    fn enumerate_transcripts(&self) -> Vec<(PathBuf, String /*sid*/, u64 /*mtime*/)>;
    fn discover_meta(&self, path: &Path) -> (Option<String>, Option<String>, bool);
    fn user_turn_text(&self, line: &str) -> Option<String>;          // preview_session
    fn continued_in(&self, _sid: &str) -> Option<String> { None }    // Claude only
    fn live_status_hint(&self, _pid: i64) -> Option<String> { None } // Claude pidfile enrichment (decision 0.5)
    // launch
    fn command(&self, spec: &LaunchSpec) -> Result<String, String>;  // full shell line, every piece shell_quote'd
    fn skill_invocation(&self, name: &str, args: &str) -> String;    // "/n a" | "$n a" | "/n a"
    fn model_flag(&self, model: &str) -> String;
    fn models(&self) -> &'static [(&'static str, &'static str)];     // replaces window.CLAUDE_MODELS (new IPC)
    fn supports_launch_settings(&self) -> bool;                      // claude only
    fn supports_preset_session_id(&self) -> bool;                    // claude, copilot
    fn supports_fork_flag(&self) -> bool;                            // claude, codex
    // install targets
    fn skills_dir(&self) -> PathBuf;                                 // ~/.claude/skills | ~/.agents/skills | ~/.copilot/skills
    fn hooks_config_path(&self) -> PathBuf;
    fn hook_events(&self) -> &'static [HookSpec];
    fn render_hooks(&self, existing: &Value, wanted: &[&str], cmd_for: &dyn Fn(&str) -> String) -> Value;
    fn is_wired(&self, cfg: &Value, file: &str) -> bool;
    fn needs_hook_trust(&self) -> bool { false }                     // codex: true
    // usage / audit
    fn context_pct(&self, sid: &str) -> Option<u8>;                  // statusline cache | token_count | copilot statusline
    fn security_facts(&self) -> crate::secaudit::SecurityFacts;
    fn context_budget(&self) -> crate::ctxbudget::ContextBudget;
}
```

What Codex and Copilot cannot do today, which should stay visible rather than be papered over:
- Codex cannot preset a session id in interactive mode. Its id arrives through the SessionStart hook, so embedded +New must keep keying the terminal by notesPath, as it already does.
- Copilot has no fork flag.
- Neither has `--settings`, so hooks must be installed globally.
- Codex has no status-line command, so context percentage comes from its rollout.
- Copilot drops context injected on prompt submit, and has no systemMessage.
- Codex writes nothing to disk when `history.persistence = "none"`; Doctor should check that key.

Skills side: a new `skills/lib/aosession.py` with `current` (parent-pid walk over the state directory, falling back to `~/.claude/sessions` for older Claude setups) and `rename <name>`. Install `lib/` once to a shared location, or into each skills directory with absolute references.
