//! The two Claude Code hooks this app ships, and the one file it will not write behind
//! your back.
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

use include_dir::{include_dir, Dir};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

use crate::config;

static HOOKS: Dir = include_dir!("$CARGO_MANIFEST_DIR/../hooks");

/// The hooks this app ships, in the order the UI lists them.
/// (`file`, the settings.json event, the matcher it needs, one line of what it does)
const SHIPPED: [(&str, &str, Option<&str>, &str); 2] = [
    (
        "pr_attach.py",
        "PostToolUse",
        Some("Bash"),
        "Attaches a pull request to the session notes the moment `gh pr create` prints its URL.",
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

/// The shell one-liner that runs a hook. `pr_attach` is fed the tool payload on stdin;
/// both swallow their own errors and exit 0, because a hook that fails must never be the
/// reason a turn breaks.
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

/// Is this hook already referenced anywhere under `settings.hooks`? Matching on the file
/// name rather than the exact command means a user who tuned the one-liner by hand is
/// still recognised as wired, and is never handed a duplicate.
fn is_wired(settings: &Value, file: &str) -> bool {
    fn walk(v: &Value, needle: &str) -> bool {
        match v {
            Value::String(s) => s.contains(needle),
            Value::Array(a) => a.iter().any(|x| walk(x, needle)),
            Value::Object(o) => o.values().any(|x| walk(x, needle)),
            _ => false,
        }
    }
    settings.get("hooks").is_some_and(|h| walk(h, file))
}

fn read_settings() -> Value {
    fs::read_to_string(settings_path())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({}))
}

/// What the UI shows: for each shipped hook, whether its script is on disk and whether
/// settings.json already runs it.
pub fn status() -> Vec<HookStatus> {
    let dir = hooks_dir();
    let settings = read_settings();
    SHIPPED
        .iter()
        .map(|(file, event, _, describes)| HookStatus {
            file: (*file).to_string(),
            event: (*event).to_string(),
            describes: (*describes).to_string(),
            copied: dir.join(file).is_file(),
            wired: is_wired(&settings, file),
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

/// Insert the two entries into a settings object, skipping any already present. Pure, so
/// the merge is tested without touching a real settings.json — and so the preview the
/// user approves is produced by exactly the code that will do the write.
pub fn merge_hooks(mut settings: Value, wanted: &[&str]) -> Value {
    if !settings.is_object() {
        settings = json!({});
    }
    for (file, event, matcher, _) in SHIPPED {
        if !wanted.contains(&file) || is_wired(&settings, file) {
            continue;
        }
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
            // A matcher-scoped event: join the existing group for that matcher rather than
            // adding a second one, which Claude Code would run as a separate matcher.
            Some(m) => {
                if let Some(group) = arr.iter_mut().find(|g| {
                    g.get("matcher").and_then(Value::as_str) == Some(m)
                }) {
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
    settings
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
pub fn wire_preview(wanted: Vec<String>) -> Result<WirePreview, String> {
    let refs: Vec<&str> = wanted.iter().map(String::as_str).collect();
    let before_val = read_settings();
    let after_val = merge_hooks(before_val.clone(), &refs);
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
pub fn wire(wanted: Vec<String>) -> Result<Value, String> {
    let refs: Vec<&str> = wanted.iter().map(String::as_str).collect();
    let path = settings_path();
    let before = read_settings();
    let after = merge_hooks(before.clone(), &refs);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_adds_both_entries_in_the_shape_claude_code_expects() {
        let out = merge_hooks(json!({}), &["pr_attach.py", "learn_nudge.py"]);
        let post = &out["hooks"]["PostToolUse"];
        assert_eq!(post[0]["matcher"], "Bash", "PostToolUse is matcher-scoped");
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
        let once = merge_hooks(json!({}), &["pr_attach.py", "learn_nudge.py"]);
        let twice = merge_hooks(once.clone(), &["pr_attach.py", "learn_nudge.py"]);
        assert_eq!(once, twice);
    }

    // The whole point of the matcher branch: someone already has Bash hooks, and ours
    // joins that group instead of creating a rival "Bash" matcher.
    #[test]
    fn an_existing_bash_matcher_is_joined_not_duplicated() {
        let existing = json!({
            "hooks": { "PostToolUse": [
                { "matcher": "Bash", "hooks": [ { "type": "command", "command": "mine.sh" } ] }
            ] }
        });
        let out = merge_hooks(existing, &["pr_attach.py"]);
        let groups = out["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(groups.len(), 1, "still a single Bash matcher");
        let inner = groups[0]["hooks"].as_array().unwrap();
        assert_eq!(inner.len(), 2, "their hook kept, ours appended");
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
        let out = merge_hooks(custom.clone(), &["learn_nudge.py"]);
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
        let out = merge_hooks(mine.clone(), &["pr_attach.py"]);
        assert_eq!(out["statusLine"], mine["statusLine"]);
        assert_eq!(out["permissions"], mine["permissions"]);
        assert_eq!(out["hooks"]["Stop"], mine["hooks"]["Stop"]);
    }

    // A settings.json that is not an object (empty file, a stray array) must not panic.
    #[test]
    fn a_malformed_settings_object_is_replaced_rather_than_panicking() {
        let out = merge_hooks(json!([1, 2, 3]), &["pr_attach.py"]);
        assert!(out["hooks"]["PostToolUse"].is_array());
    }

    #[test]
    fn every_shipped_hook_is_actually_embedded_in_this_build() {
        for (file, _, _, _) in SHIPPED {
            assert!(HOOKS.get_file(file).is_some(), "{file} not embedded");
        }
    }
}
