//! Pinned skills: list what the user could pin, and run one headless.
//!
//! The dashboard's own buttons (Close, Sync) each wrap ONE skill with its own wiring. A
//! pinned slot is the general case: any skill the user already has under `~/.claude/skills`,
//! launched the way the session's state allows. Only the headless half lives here — sending
//! a slash command to an OPEN session is a pty write the renderer already does directly.

use serde_json::{json, Value};
use std::time::Duration;

const SKILL_TIMEOUT: Duration = Duration::from_secs(900);

/// A skill name is interpolated into a shell command, so it is validated rather than
/// trusted: the picker only ever offers directory names, but nothing stops a hand-edited
/// config.json, and `$(…)` in one of these would run.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The `description:` of a SKILL.md, folded onto one line. Frontmatter is YAML, but only
/// two scalar keys are wanted here, so this reads them directly rather than pulling in a
/// parser: `description:` may be inline, or `>-`/`|` with the text indented beneath.
fn description_of(md: &str) -> String {
    let mut lines = md.lines();
    if lines.next().map(str::trim) != Some("---") {
        return String::new();
    }
    let mut out = String::new();
    let mut folding = false;
    for l in lines {
        let t = l.trim();
        if t == "---" {
            break;
        }
        if folding {
            // A new top-level key ends the folded block; anything indented continues it.
            if !l.starts_with(' ') && !l.starts_with('\t') {
                break;
            }
            if !t.is_empty() {
                if !out.is_empty() {
                    out.push(' ');
                }
                out.push_str(t);
            }
            continue;
        }
        if let Some(rest) = t.strip_prefix("description:") {
            let rest = rest.trim();
            if rest == ">-" || rest == ">" || rest == "|" || rest == "|-" || rest.is_empty() {
                folding = true;
            } else {
                out = rest.trim_matches('"').trim_matches('\'').to_string();
                break;
            }
        }
    }
    let out = out.trim().to_string();
    if out.chars().count() > 240 {
        out.chars().take(239).collect::<String>() + "…"
    } else {
        out
    }
}

/// Every skill installed under `~/.claude/skills`, with the ones this app owns flagged.
/// That directory is the truth: a skill Claude Code cannot see is not one the user can pin.
#[tauri::command]
pub fn list_skills() -> Vec<Value> {
    let dir = crate::config::home().join(".claude").join("skills");
    let owned: Vec<String> = crate::skills::skill_names();
    let mut out: Vec<Value> = Vec::new();
    let rd = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return out,
    };
    for e in rd.flatten() {
        if !e.path().is_dir() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || !valid_name(&name) {
            continue;
        }
        let md = std::fs::read_to_string(e.path().join("SKILL.md")).unwrap_or_default();
        if md.is_empty() {
            continue;
        }
        out.push(json!({
            "name": name,
            "description": description_of(&md),
            "app": owned.contains(&name),
        }));
    }
    out.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    out
}

/// Run a skill headless. `resume` attaches the session's conversation; without it the skill
/// still runs, in `cwd` — which is what a global (session-less) button wants.
#[tauri::command(async)]
pub fn run_skill(skill: String, cwd: String, resume: Option<String>) -> Result<Value, String> {
    if !valid_name(&skill) {
        return Err(format!("not a skill name: {skill}"));
    }
    let dir = if std::path::Path::new(&cwd).is_dir() {
        cwd
    } else {
        crate::config::home().to_string_lossy().to_string()
    };
    let resume_arg = match resume.as_deref() {
        Some(id) if !id.is_empty() => format!(" --resume {}", crate::pty::shell_quote(id)),
        _ => String::new(),
    };
    let inner = format!(
        "cd {} && AO_HEADLESS=1 claude{}{} --permission-mode acceptEdits -p {}",
        crate::pty::shell_quote(&dir),
        crate::pty::model_flag(),
        resume_arg,
        crate::pty::shell_quote(&format!("/{skill}")),
    );
    let out = crate::prstatus::run_within(&inner, SKILL_TIMEOUT)?;
    let summary = out
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("Done.")
        .trim()
        .to_string();
    Ok(json!({ "summary": summary, "output": out }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_skill_name_that_could_reach_the_shell_is_refused() {
        assert!(valid_name("daily-ops"));
        assert!(valid_name("save_session2"));
        for bad in ["", "a b", "$(rm -rf ~)", "../../etc", "a;b", "a`b`", "a'b", "a\"b", "a/b"] {
            assert!(!valid_name(bad), "{bad} should be refused");
        }
        assert!(!valid_name(&"x".repeat(65)));
    }

    #[test]
    fn the_description_is_read_inline_or_folded() {
        assert_eq!(description_of("---\nname: x\ndescription: One line.\n---\nbody"), "One line.");
        let folded = "---\nname: x\ndescription: >-\n  First part\n  second part\nallowed-tools: Bash\n---\n";
        assert_eq!(description_of(folded), "First part second part");
        assert_eq!(description_of("---\ndescription: \"quoted\"\n---\n"), "quoted");
    }

    #[test]
    fn a_file_without_frontmatter_has_no_description_rather_than_a_stray_line() {
        assert_eq!(description_of("# Just a title\ndescription: not frontmatter\n"), "");
        assert_eq!(description_of(""), "");
    }

    #[test]
    fn a_very_long_description_is_cut_rather_than_breaking_the_picker() {
        let md = format!("---\ndescription: {}\n---\n", "word ".repeat(200));
        let d = description_of(&md);
        assert!(d.chars().count() <= 240, "{}", d.chars().count());
        assert!(d.ends_with('…'));
    }
}
