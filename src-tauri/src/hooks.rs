//! The Claude Code hooks this app ships, and the one file it will not write behind your
//! back.
//!
//! Until now the hooks existed only in the repo: `install.sh --with-hooks` copied them,
//! so anyone who installed the `.dmg` — the path the README recommends — could not reach
//! them at all. They are embedded here for the same reason the skills are, so a build is
//! self-sufficient.
//!
//! Two halves, deliberately separate:
//!
//! - **Copying** `~/.claude/hooks/*.py` is inert. A hook script that nothing references
//!   never runs, so this needs no ceremony and happens with the skills.
//! - **Wiring** means editing `~/.claude/settings.json`, the file that decides which code
//!   Claude Code executes on this machine. That never happens silently: the caller is
//!   shown the exact before/after, the current file is copied to a timestamped backup,
//!   and only then is the new one written — atomically, so a crash mid-write cannot leave
//!   a truncated settings file behind.
//!
//! And a third path that needs neither: every session this app launches gets a
//! `--settings <file>` the app writes itself (`launch_settings_arg`). Claude Code MERGES
//! that file's hooks with the user's global ones (verified empirically: an injected hook
//! and a global one both fired in a single run — only `statusLine` is replace-not-merge).
//! So `launch_hooks` puts every shipped hook the user has NOT wired globally into that
//! file, and sessions started from the dashboard run all of them without anyone touching
//! settings.json. Wiring stays what it was: the way to extend that to sessions started
//! from a plain terminal.

use include_dir::{include_dir, Dir};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

use crate::config;

static HOOKS: Dir = include_dir!("$CARGO_MANIFEST_DIR/../hooks");

/// The hooks this app ships, in the order the UI lists them.
/// (`file`, the settings.json event, the matcher it needs, one line of what it does)
const SHIPPED: [(&str, &str, Option<&str>, &str); 6] = [
    (
        "ao_skill_guard.py",
        "PreToolUse",
        Some("Edit|Write|MultiEdit|NotebookEdit"),
        "Refuses an edit to one of this app's own skills and says to make a skill of your own instead — the dashboard depends on what these write.",
    ),
    (
        "ao_autosave.py",
        "Stop",
        None,
        "Has the model run /save-session itself at 60% and 80% of context, and after 30 minutes without a checkpoint — from the real context figure, not a byte count.",
    ),
    (
        "ao_precompact.py",
        "PreCompact",
        None,
        "Before a compaction, appends an (in progress) line to the session history so nothing forgets where the conversation lived.",
    ),
    (
        "ao_session_start.py",
        "SessionStart",
        None,
        "Tells each tracked session, as it starts, to /learn as it goes and to save when asked; after a compaction, to save first.",
    ),
    (
        "pr_attach.py",
        "PostToolUse",
        // A regex over the tool name: the Bash call that runs `gh pr create|edit|reopen`, or
        // the GitHub MCP server's create tool under whatever name the server is registered.
        Some("Bash|mcp__.*__create_pull_request"),
        "Attaches a pull request to the session notes the moment `gh pr create` (or `edit`, `reopen`, or the GitHub MCP tool) returns its URL.",
    ),
    (
        "learn_nudge.py",
        "UserPromptSubmit",
        None,
        "Nudges the model to check /learn when your own wording states a preference or correction.",
    ),
];

fn hooks_dir() -> PathBuf {
    config::home().join(".claude").join("hooks")
}

fn settings_path() -> PathBuf {
    config::home().join(".claude").join("settings.json")
}

/// The shell one-liner that runs a hook. Claude Code hands every hook its payload on
/// stdin; `pr_attach` reads it through a variable so the Bash one-liner it is documented
/// with stays pasteable. All of them swallow their own errors and exit 0, because a hook
/// that fails must never be the reason a turn breaks.
fn command_for(file: &str) -> String {
    match file {
        "pr_attach.py" => {
            "IN=$(cat); printf '%s' \"$IN\" | python3 \"$HOME/.claude/hooks/pr_attach.py\" 2>/dev/null; true"
                .to_string()
        }
        _ => format!("python3 \"$HOME/.claude/hooks/{file}\" 2>/dev/null; true"),
    }
}

#[derive(Serialize, Clone)]
pub struct HookStatus {
    pub file: String,
    pub event: String,
    pub describes: String,
    /// The script is present in ~/.claude/hooks/.
    pub copied: bool,
    /// settings.json already references it — wiring would be a no-op.
    pub wired: bool,
}

fn walk(v: &Value, needle: &str) -> bool {
    match v {
        Value::String(s) => s.contains(needle),
        Value::Array(a) => a.iter().any(|x| walk(x, needle)),
        Value::Object(o) => o.values().any(|x| walk(x, needle)),
        _ => false,
    }
}

/// Is this hook already referenced anywhere under `settings.hooks`? Matching on the file
/// name rather than the exact command means a user who tuned the one-liner by hand is
/// still recognised as wired, and is never handed a duplicate.
fn is_wired(settings: &Value, file: &str) -> bool {
    settings.get("hooks").is_some_and(|h| walk(h, file))
}

const PR_ATTACH: &str = "pr_attach.py";
/// The matcher to add when `pr_attach` is already declared under a group that cannot see
/// the MCP tool (a plain `Bash`, the shape every install before 0.15 wrote). Not
/// `Bash|…`: the Bash half is already covered, and a second Bash group would attach every
/// PR twice.
const PR_ATTACH_MCP_ONLY: &str = "mcp__.*__create_pull_request";

/// Does some PostToolUse group that runs `pr_attach` also match the MCP create tool?
fn pr_attach_sees_mcp(settings: &Value) -> bool {
    settings
        .get("hooks")
        .and_then(|h| h.get("PostToolUse"))
        .and_then(Value::as_array)
        .is_some_and(|groups| {
            groups.iter().any(|g| {
                g.get("matcher").and_then(Value::as_str).is_some_and(|m| m.contains("create_pull_request"))
                    && walk(g, PR_ATTACH)
            })
        })
}

/// What `settings` still lacks for this hook: `None` when it is fully declared;
/// `Some(matcher)` when a group with that matcher (or none, for matcher-less events) must
/// be added. `pr_attach` is the one hook with a partial state: declared under a group that
/// matches only `Bash`, it attaches `gh` PRs and misses MCP ones — the gap is then an
/// MCP-only group, never a rewrite of the user's own group, whose other hooks must not be
/// widened to a tool they never asked to see.
fn gap(settings: &Value, file: &str, matcher: Option<&str>) -> Option<Option<String>> {
    if !is_wired(settings, file) {
        return Some(matcher.map(String::from));
    }
    if file == PR_ATTACH && !pr_attach_sees_mcp(settings) {
        return Some(Some(PR_ATTACH_MCP_ONLY.to_string()));
    }
    None
}

fn read_settings() -> Value {
    fs::read_to_string(settings_path())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({}))
}

/// The `advisorModel` currently in settings.json, if any — so the UI shows what is set
/// rather than presenting an empty box over a real value.
#[tauri::command]
pub fn advisor_model() -> String {
    read_settings()
        .get("advisorModel")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

/// What the UI shows: for each shipped hook, whether its script is on disk and whether
/// settings.json already runs it.
pub fn status() -> Vec<HookStatus> {
    let dir = hooks_dir();
    let settings = read_settings();
    SHIPPED
        .iter()
        .map(|(file, event, _matcher, describes)| HookStatus {
            file: (*file).to_string(),
            event: (*event).to_string(),
            describes: (*describes).to_string(),
            copied: dir.join(file).is_file(),
            wired: gap(&settings, file, *_matcher).is_none(),
        })
        .collect()
}

/// Copy the embedded scripts into `~/.claude/hooks/`. Always safe to re-run: the scripts
/// are app-owned and carry no user state, so this simply refreshes them to this build.
pub fn install_scripts() -> Result<Vec<String>, String> {
    let dir = hooks_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut written = Vec::new();
    for (file, _, _, _) in SHIPPED {
        let Some(f) = HOOKS.get_file(file) else {
            return Err(format!("{file} is missing from this build"));
        };
        fs::write(dir.join(file), f.contents()).map_err(|e| format!("{file}: {e}"))?;
        written.push(file.to_string());
    }
    Ok(written)
}

/// Declare `file` under `event` in `settings`, with `matcher` when the event takes one.
/// Joins an existing group for the SAME matcher rather than adding a second, which Claude
/// Code would run as a separate matcher; a group for a different matcher is a different
/// rule and is left alone.
fn add_group(settings: &mut Value, file: &str, event: &str, matcher: Option<&str>) {
    let entry = json!({ "type": "command", "command": command_for(file) });
    let hooks = settings
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let list = hooks
        .as_object_mut()
        .unwrap()
        .entry(event)
        .or_insert_with(|| json!([]));
    if !list.is_array() {
        *list = json!([]);
    }
    let arr = list.as_array_mut().unwrap();
    match matcher {
        Some(m) => {
            if let Some(group) = arr.iter_mut().find(|g| g.get("matcher").and_then(Value::as_str) == Some(m)) {
                let inner = group
                    .as_object_mut()
                    .unwrap()
                    .entry("hooks")
                    .or_insert_with(|| json!([]));
                if !inner.is_array() {
                    *inner = json!([]);
                }
                inner.as_array_mut().unwrap().push(entry);
            } else {
                arr.push(json!({ "matcher": m, "hooks": [entry] }));
            }
        }
        None => arr.push(json!({ "hooks": [entry] })),
    }
}

/// Insert the shipped entries into a settings object, skipping whatever is already
/// declared (see `gap`). Pure, so the merge is tested without touching a real
/// settings.json — and so the preview the user approves is produced by exactly the code
/// that will do the write.
pub fn merge_settings(mut settings: Value, wanted: &[&str], advisor: Option<&str>) -> Value {
    if !settings.is_object() {
        settings = json!({});
    }
    for (file, event, matcher, _) in SHIPPED {
        if !wanted.contains(&file) {
            continue;
        }
        let Some(needed) = gap(&settings, file, matcher) else { continue };
        add_group(&mut settings, file, event, needed.as_deref());
    }
    // `advisorModel` is Claude Code's own key, not this app's — it decides which model
    // answers /advisor and has nothing to do with the sessions the dashboard launches.
    // It rides this path because this is the one place that edits settings.json with the
    // result shown first and a backup taken. An empty choice means "leave it alone",
    // never "clear it".
    if let Some(m) = advisor.map(str::trim).filter(|m| !m.is_empty()) {
        if !settings.is_object() {
            settings = json!({});
        }
        settings
            .as_object_mut()
            .unwrap()
            .insert("advisorModel".into(), json!(m));
    }
    settings
}

/// The `hooks` object for the per-launch settings file: every shipped hook the user has
/// not wired in `user_settings` (their global settings.json), grouped the way
/// `merge_settings` would wire them. `None` when nothing is left to inject — the user
/// wired them all, so injecting again would run each hook twice per event.
pub fn launch_hooks(user_settings: &Value) -> Option<Value> {
    let mut out = json!({});
    for (file, event, matcher, _) in SHIPPED {
        // The gap is measured against the USER's file, then declared in ours — so a
        // Bash-only pr_attach in theirs gets exactly the MCP-only group here, not a second
        // Bash one that would attach every gh PR twice.
        if let Some(needed) = gap(user_settings, file, matcher) {
            add_group(&mut out, file, event, needed.as_deref());
        }
    }
    out.get("hooks").cloned()
}

#[derive(Serialize)]
pub struct WirePreview {
    pub before: String,
    pub after: String,
    /// Nothing to do — every requested hook is already referenced.
    pub unchanged: bool,
    pub settings_path: String,
}

/// The exact before/after the user approves. Pretty-printed both sides so the UI can diff
/// them line by line and the user reads real JSON, not a description of it.
pub fn wire_preview(wanted: Vec<String>, advisor: Option<String>) -> Result<WirePreview, String> {
    let refs: Vec<&str> = wanted.iter().map(String::as_str).collect();
    let before_val = read_settings();
    let after_val = merge_settings(before_val.clone(), &refs, advisor.as_deref());
    let before = serde_json::to_string_pretty(&before_val).map_err(|e| e.to_string())?;
    let after = serde_json::to_string_pretty(&after_val).map_err(|e| e.to_string())?;
    Ok(WirePreview {
        unchanged: before == after,
        before,
        after,
        settings_path: settings_path().to_string_lossy().into_owned(),
    })
}

/// Write the merged settings, after copying the current file aside. The backup is the
/// undo: this is the one file in the system where "I can put it back" has to be literally
/// true, so it is made before the write and its path is returned even when the write then
/// fails.
pub fn wire(wanted: Vec<String>, advisor: Option<String>) -> Result<Value, String> {
    let refs: Vec<&str> = wanted.iter().map(String::as_str).collect();
    let path = settings_path();
    let before = read_settings();
    let after = merge_settings(before.clone(), &refs, advisor.as_deref());
    if before == after {
        return Ok(json!({ "ok": true, "unchanged": true, "backup": Value::Null }));
    }
    let mut backup = Value::Null;
    if path.is_file() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let dest = path.with_file_name(format!("settings.json.ao-backup-{stamp}"));
        fs::copy(&path, &dest).map_err(|e| format!("could not back up settings.json: {e}"))?;
        backup = json!(dest.to_string_lossy());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(&after).map_err(|e| e.to_string())?;
    crate::atomic_write(&path, &format!("{body}\n"))?;
    Ok(json!({ "ok": true, "unchanged": false, "backup": backup }))
}

// ── The Tauri commands. Thin on purpose: the functions above are the testable surface,
// these are the names the wrapper invokes (tauri-api.js) and generate_handler! registers.

/// The two shipped hooks: is each script on disk, and does settings.json already run it?
#[tauri::command]
pub fn hooks_status() -> Vec<HookStatus> {
    status()
}

/// The exact before/after of ~/.claude/settings.json, for the user to approve. Produced by
/// the same merge that performs the write, so what is shown is what happens.
#[tauri::command]
pub fn hooks_wire_preview(files: Vec<String>, advisor: Option<String>) -> Result<WirePreview, String> {
    wire_preview(files, advisor)
}

/// Write the approved settings.json, after copying the current one aside.
#[tauri::command]
pub fn wire_hooks(files: Vec<String>, advisor: Option<String>) -> Result<Value, String> {
    wire(files, advisor)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_hooks_inject_only_what_the_user_has_not_wired() {
        // pr_attach wired by hand, with a tuned command line: recognised by file name.
        let user = json!({ "hooks": { "PostToolUse": [ { "matcher": "Bash", "hooks": [
            { "type": "command", "command": "python3 ~/.claude/hooks/pr_attach.py || true" } ] } ] } });
        let hooks = launch_hooks(&user).expect("hooks remain");
        let text = hooks.to_string();
        // Their Bash-only pr_attach covers gh; ours adds the MCP tool and nothing else.
        let post = hooks["PostToolUse"].as_array().unwrap();
        assert_eq!(post.len(), 1);
        assert_eq!(post[0]["matcher"], PR_ATTACH_MCP_ONLY, "MCP-only, never a second Bash group");
        for file in ["ao_skill_guard.py", "ao_autosave.py", "ao_precompact.py", "ao_session_start.py", "learn_nudge.py"] {
            assert!(text.contains(file), "{file} must ride in the launch settings");
        }
        assert!(hooks.get("Stop").is_some() && hooks.get("PreCompact").is_some() && hooks.get("SessionStart").is_some());
        // Every shipped hook wired → nothing to inject, not an empty object.
        let all: Vec<&str> = SHIPPED.iter().map(|(f, _, _, _)| *f).collect();
        let wired = merge_settings(json!({}), &all, None);
        assert!(launch_hooks(&wired).is_none());
        // No settings at all → all five.
        let none = launch_hooks(&json!({})).unwrap();
        let events: std::collections::BTreeSet<&str> = SHIPPED.iter().map(|(_, e, _, _)| *e).collect();
        assert_eq!(none.as_object().unwrap().len(), events.len(), "one group per distinct event");
        assert_eq!(events.len(), 6, "PreToolUse, Stop, PreCompact, SessionStart, PostToolUse, UserPromptSubmit");
    }

    // The shape every install before 0.15 wrote, and hers: pr_attach under a plain Bash
    // group next to other Bash hooks. Step 4 must report it as not fully enabled, and the
    // write must add an MCP-only group — never widen their group's matcher, which would
    // hand their other hooks a tool they never asked to see.
    #[test]
    fn a_bash_only_pr_attach_gets_an_mcp_only_group_and_nothing_else_moves() {
        let theirs = json!({ "hooks": { "PostToolUse": [ { "matcher": "Bash", "hooks": [
            { "type": "command", "command": "IN=$(cat); printf '%s' \"$IN\" | python3 \"$HOME/.claude/hooks/pr_description_check.py\"" },
            { "type": "command", "command": "IN=$(cat); printf '%s' \"$IN\" | python3 \"$HOME/.claude/hooks/pr_attach.py\" 2>/dev/null; true" } ] } ] } });
        assert!(is_wired(&theirs, PR_ATTACH));
        assert!(!pr_attach_sees_mcp(&theirs));
        assert_eq!(gap(&theirs, PR_ATTACH, Some("Bash|mcp__.*__create_pull_request")), Some(Some(PR_ATTACH_MCP_ONLY.to_string())));
        let out = merge_settings(theirs.clone(), &[PR_ATTACH], None);
        let groups = out["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0], theirs["hooks"]["PostToolUse"][0], "their Bash group is byte-identical");
        assert_eq!(groups[1]["matcher"], PR_ATTACH_MCP_ONLY);
        assert!(groups[1]["hooks"][0]["command"].as_str().unwrap().contains("pr_attach.py"));
        // Now fully declared: a second merge changes nothing, and nothing is left to inject.
        assert_eq!(merge_settings(out.clone(), &[PR_ATTACH], None), out);
        assert!(gap(&out, PR_ATTACH, None).is_none());
    }

    #[test]
    fn merge_adds_both_entries_in_the_shape_claude_code_expects() {
        let out = merge_settings(json!({}), &["pr_attach.py", "learn_nudge.py"], None);
        let post = &out["hooks"]["PostToolUse"];
        assert_eq!(post[0]["matcher"], "Bash|mcp__.*__create_pull_request", "PostToolUse is matcher-scoped: gh in Bash, or the MCP create tool");
        assert!(post[0]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .contains("pr_attach.py"));
        let ups = &out["hooks"]["UserPromptSubmit"];
        assert!(ups[0]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .contains("learn_nudge.py"));
        assert_eq!(ups[0].get("matcher"), None, "UserPromptSubmit takes no matcher");
    }

    // Running it twice must not stack a second copy — the user would get two attachments
    // per PR and no way to tell which line to delete.
    #[test]
    fn merging_twice_changes_nothing_the_second_time() {
        let once = merge_settings(json!({}), &["pr_attach.py", "learn_nudge.py"], None);
        let twice = merge_settings(once.clone(), &["pr_attach.py", "learn_nudge.py"], None);
        assert_eq!(once, twice);
    }

    // The whole point of the matcher branch: someone already has a group for the SAME
    // matcher, and ours joins it instead of creating a rival group Claude Code would run
    // as a second matcher. A group for a different matcher ("Bash" alone, say) is left
    // alone: it is not a rival, it is a different rule, and ours must not be squeezed
    // into a scope that would never see the MCP tool.
    #[test]
    fn an_existing_group_for_the_same_matcher_is_joined_not_duplicated() {
        let existing = json!({
            "hooks": { "PostToolUse": [
                { "matcher": "Bash", "hooks": [ { "type": "command", "command": "theirs.sh" } ] },
                { "matcher": "Bash|mcp__.*__create_pull_request", "hooks": [ { "type": "command", "command": "mine.sh" } ] }
            ] }
        });
        let out = merge_settings(existing, &["pr_attach.py"], None);
        let groups = out["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(groups.len(), 2, "no third group");
        assert_eq!(groups[0]["hooks"].as_array().unwrap().len(), 1, "the plain Bash group is untouched");
        let inner = groups[1]["hooks"].as_array().unwrap();
        assert_eq!(inner.len(), 2, "their hook kept, ours appended to the same-matcher group");
        assert_eq!(inner[0]["command"], "mine.sh");
    }

    // A hand-tuned command line still counts as wired: match on the file, not the string.
    #[test]
    fn a_customised_command_is_recognised_and_not_duplicated() {
        let custom = json!({
            "hooks": { "UserPromptSubmit": [
                { "hooks": [ { "type": "command", "command": "uv run ~/.claude/hooks/learn_nudge.py" } ] }
            ] }
        });
        let out = merge_settings(custom.clone(), &["learn_nudge.py"], None);
        assert_eq!(out, custom);
    }

    // Everything else in the file must survive untouched — this is the user's own config.
    #[test]
    fn unrelated_settings_are_preserved() {
        let mine = json!({
            "statusLine": { "type": "command", "command": "my-statusline" },
            "permissions": { "deny": ["Read(**/.env)"] },
            "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "say done" } ] } ] }
        });
        let out = merge_settings(mine.clone(), &["pr_attach.py"], None);
        assert_eq!(out["statusLine"], mine["statusLine"]);
        assert_eq!(out["permissions"], mine["permissions"]);
        assert_eq!(out["hooks"]["Stop"], mine["hooks"]["Stop"]);
    }

    // A settings.json that is not an object (empty file, a stray array) must not panic.
    #[test]
    fn a_malformed_settings_object_is_replaced_rather_than_panicking() {
        let out = merge_settings(json!([1, 2, 3]), &["pr_attach.py"], None);
        assert!(out["hooks"]["PostToolUse"].is_array());
    }

    #[test]
    fn the_advisor_model_is_set_only_when_one_was_chosen() {
        // No choice → the key is left exactly as it was, set or unset.
        assert_eq!(merge_settings(json!({}), &[], None).get("advisorModel"), None);
        let had = json!({ "advisorModel": "fable" });
        assert_eq!(merge_settings(had.clone(), &[], None), had);
        assert_eq!(merge_settings(had.clone(), &[], Some("  ")), had, "blank is not a clear");
        // A choice replaces it, and nothing else moves.
        let out = merge_settings(json!({ "theme": "dark", "advisorModel": "fable" }), &[], Some("opus"));
        assert_eq!(out["advisorModel"], "opus");
        assert_eq!(out["theme"], "dark");
    }

    #[test]
    fn every_shipped_hook_is_actually_embedded_in_this_build() {
        for (file, _, _, _) in SHIPPED {
            assert!(HOOKS.get_file(file).is_some(), "{file} not embedded");
        }
    }
}
