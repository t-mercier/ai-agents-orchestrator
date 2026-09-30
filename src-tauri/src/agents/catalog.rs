//! What each agent CLI can run on, asked of the CLI itself so the list stays current: the
//! models it offers and whether someone is signed in. Settings → Models reads it. Claude
//! Code has no command that lists its models, so its list stays the app's own
//! (`CLAUDE_MODELS` in app.js); only its sign-in is asked.

use serde_json::{json, Value};

/// The probe: one section per CLI, each started by a `==<name>==` line. Every command gets
/// eight seconds (`perl alarm`), so one slow CLI cannot empty the whole answer. Only
/// `loggedIn` is read from `claude auth status`; the rest of its JSON (the account's email
/// among it) is never kept.
fn probe_line() -> String {
    let script = "t() { perl -e 'alarm 8; exec @ARGV' \"$@\" 2>&1; }; \
                  echo '==claude-auth=='; command -v claude >/dev/null && t claude auth status; \
                  echo '==codex-auth=='; command -v codex >/dev/null && t codex login status; \
                  echo '==codex-models=='; command -v codex >/dev/null && t codex debug models; \
                  echo '==copilot-config=='; command -v copilot >/dev/null && t copilot help config; \
                  echo '==end=='";
    format!("exec /bin/sh -c {}", crate::pty::shell_quote(script))
}

/// The text of one `==name==` section of the probe's output.
fn section<'a>(out: &'a str, name: &str) -> &'a str {
    let head = format!("=={name}==\n");
    let Some(start) = out.find(&head).map(|i| i + head.len()) else { return "" };
    let rest = &out[start..];
    let end = rest.find("\n==").map(|i| i + 1).unwrap_or(rest.len());
    &rest[..end]
}

/// `claude auth status` prints JSON with `loggedIn`. Anything else is "unknown", not "no".
fn claude_signed_in(text: &str) -> Option<bool> {
    let v: Value = serde_json::from_str(text.trim()).ok()?;
    v.get("loggedIn").and_then(Value::as_bool)
}

/// `codex login status` says "Logged in using …", or "Not logged in".
fn codex_signed_in(text: &str) -> Option<bool> {
    let t = text.trim();
    if t.is_empty() {
        None
    } else if t.contains("Not logged in") {
        Some(false)
    } else if t.contains("Logged in") {
        Some(true)
    } else {
        None
    }
}

/// `codex debug models`: the catalogue as JSON. Only the models Codex itself lists
/// (`visibility: "list"`) are offered; hidden ones are internal.
fn codex_models(text: &str) -> Vec<Value> {
    let Some(start) = text.find('{') else { return vec![] };
    let Ok(v) = serde_json::from_str::<Value>(&text[start..]) else { return vec![] };
    v.get("models").and_then(Value::as_array).into_iter().flatten()
        .filter(|m| m.get("visibility").and_then(Value::as_str) == Some("list"))
        .filter_map(|m| {
            let id = m.get("slug").and_then(Value::as_str)?;
            if !crate::advisors::valid_model(id) { return None }
            let label = m.get("display_name").and_then(Value::as_str).unwrap_or(id);
            Some(json!({ "id": id, "label": label }))
        })
        .collect()
}

/// `copilot help config`: the `model` key's allowed values, one `- "id"` line each.
fn copilot_models(text: &str) -> Vec<Value> {
    let mut lines = text.lines().skip_while(|l| !l.trim_start().starts_with("`model`:"));
    if lines.next().is_none() { return vec![] }
    lines
        .map(str::trim)
        .take_while(|l| l.starts_with("- \""))
        .filter_map(|l| l.strip_prefix("- \"")?.strip_suffix('"'))
        .filter(|id| crate::advisors::valid_model(id))
        .map(|id| json!({ "id": id, "label": id }))
        .collect()
}

fn catalog(out: &str) -> Value {
    json!({
        "claude": { "signedIn": claude_signed_in(section(out, "claude-auth")), "models": [] },
        "codex": {
            "signedIn": codex_signed_in(section(out, "codex-auth")),
            "models": codex_models(section(out, "codex-models")),
        },
        // Copilot has no sign-in status command; `null` is "not asked", not "signed out".
        "copilot": { "signedIn": Value::Null, "models": copilot_models(section(out, "copilot-config")) },
    })
}

/// `{claude|codex|copilot: {signedIn: bool|null, models: [{id, label}]}}`.
#[tauri::command(async)]
pub fn agent_catalog() -> Result<Value, String> {
    let out = crate::prstatus::run_within(&probe_line(), std::time::Duration::from_secs(40))
        .map_err(|e| format!("could not ask the agent CLIs ({e})"))?;
    Ok(catalog(&out))
}

#[cfg(test)]
mod tests {
    use super::*;

    const COPILOT: &str = "  `logLevel`: log level for CLI.\n\n  `model`: AI model to use for Copilot CLI; can be changed with /model command or --model flag option.\n    - \"claude-sonnet-5\"\n    - \"claude-opus-5.5\"\n    - \"gpt-6-sol\"\n    - \"gemini-3.8-flash\"\n\n  `contextTier`: context window tier.\n    - Can also be set with --context flag\n";
    const CODEX: &str = r#"{"models":[{"slug":"gpt-6-sol","display_name":"GPT-6-Sol","visibility":"list"},{"slug":"gpt-reserve","display_name":"GPT-Reserve","visibility":"hide"},{"slug":"gpt-5.4","display_name":"GPT-5.4","visibility":"list"}]}"#;

    #[test]
    fn copilot_models_are_the_values_its_help_lists_for_model() {
        let ids: Vec<_> = copilot_models(COPILOT).iter().map(|m| m["id"].as_str().unwrap().to_string()).collect();
        assert_eq!(ids, ["claude-sonnet-5", "claude-opus-5.5", "gpt-6-sol", "gemini-3.8-flash"]);
        assert!(copilot_models("no model key here").is_empty());
    }

    #[test]
    fn codex_models_are_the_listed_ones_with_their_names() {
        assert_eq!(codex_models(CODEX), vec![json!({"id": "gpt-6-sol", "label": "GPT-6-Sol"}), json!({"id": "gpt-5.4", "label": "GPT-5.4"})]);
        assert!(codex_models("error: not logged in").is_empty());
    }

    #[test]
    fn sign_in_is_yes_no_or_unknown() {
        assert_eq!(codex_signed_in("Logged in using ChatGPT\n"), Some(true));
        assert_eq!(codex_signed_in("Not logged in\n"), Some(false));
        assert_eq!(codex_signed_in(""), None);
        assert_eq!(claude_signed_in(r#"{"loggedIn": true, "email": "x@y.z"}"#), Some(true));
        assert_eq!(claude_signed_in(r#"{"loggedIn": false}"#), Some(false));
        assert_eq!(claude_signed_in("command not found"), None);
    }

    #[test]
    fn the_catalog_reads_each_section_and_keeps_no_account_detail() {
        let out = format!("==claude-auth==\n{{\"loggedIn\": true, \"email\": \"x@y.z\"}}\n==codex-auth==\nLogged in using ChatGPT\n==codex-models==\n{CODEX}\n==copilot-config==\n{COPILOT}\n==end==\n");
        let c = catalog(&out);
        assert_eq!(c["claude"]["signedIn"], true);
        assert_eq!(c["codex"]["signedIn"], true);
        assert_eq!(c["codex"]["models"].as_array().unwrap().len(), 2);
        assert_eq!(c["copilot"]["models"].as_array().unwrap().len(), 4);
        assert!(c["copilot"]["signedIn"].is_null());
        assert!(!c.to_string().contains("x@y.z"));
    }

    #[test]
    fn a_missing_cli_leaves_its_section_empty() {
        let c = catalog("==claude-auth==\n==codex-auth==\n==codex-models==\n==copilot-config==\n==end==\n");
        assert!(c["codex"]["signedIn"].is_null());
        assert!(c["codex"]["models"].as_array().unwrap().is_empty());
    }

    #[test]
    fn the_probe_runs_in_sh_and_bounds_every_command() {
        let line = probe_line();
        assert!(line.starts_with("exec /bin/sh -c "), "{line}");
        assert!(line.contains("alarm 8"));
        let out = std::process::Command::new("/bin/sh").args(["-c", &line]).env("PATH", "/usr/bin:/bin").output().unwrap();
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(text.contains("==copilot-config==") && text.trim_end().ends_with("==end=="), "{text}");
    }

    // Asks this machine's real CLIs. Not run by default: `cargo test -- --ignored live_catalog`.
    #[test]
    #[ignore]
    fn live_catalog() {
        let c = agent_catalog().unwrap();
        for a in ["claude", "codex", "copilot"] {
            eprintln!("{a}: signedIn={} models={}", c[a]["signedIn"], c[a]["models"].as_array().map(|m| m.len()).unwrap_or(0));
        }
    }
}
