//! GitHub Copilot CLI sessions (1.0 and later): where their events are and what state they
//! are in. Shapes observed on 1.0.89 (see the probe results in
//! docs/superpowers/research/2026-09-28-codex-copilot-parity.md).

use super::Fold;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// `$COPILOT_HOME`, else `~/.copilot`.
pub(crate) fn home() -> PathBuf {
    std::env::var_os("COPILOT_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| crate::config::home().join(".copilot"))
}

/// busy while a turn is open: `assistant.turn_start` after the last `assistant.turn_end`.
/// waiting while a `permission.requested` has not been followed by the tool running. The
/// last assistant message is the activity line.
pub(crate) fn fold(text: &str) -> Fold {
    let mut f = Fold::default();
    for line in text.lines() {
        let Ok(d) = serde_json::from_str::<Value>(line) else { continue };
        let data = d.get("data").unwrap_or(&Value::Null);
        match d.get("type").and_then(Value::as_str) {
            Some("assistant.turn_start") => f.busy = true,
            Some("assistant.turn_end") => {
                f.busy = false;
                f.waiting = false;
            }
            Some("permission.requested") => f.waiting = true,
            Some("tool.execution_complete" | "tool.execution_start") => f.waiting = false,
            Some("assistant.message") => {
                f.waiting = false;
                if let Some(t) = data.get("content").and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty()) {
                    f.last_activity = Some(t.to_string());
                    f.last_activity_at = d.get("timestamp").and_then(Value::as_str).map(String::from);
                }
            }
            Some("session.start") => {
                f.cwd = data.pointer("/context/cwd").and_then(Value::as_str).map(String::from);
            }
            _ => {}
        }
    }
    f
}

/// `session-state/<id>/events.jsonl`, when that session exists.
pub(crate) fn transcript_path(root: &Path, id: &str) -> Option<PathBuf> {
    if !crate::is_valid_session_id(id) {
        return None;
    }
    let p = root.join("session-state").join(id).join("events.jsonl");
    p.is_file().then_some(p)
}

/// `(major, minor, patch)` from `copilot --version`, whose first line is the version.
pub(crate) fn parse_version(out: &str) -> Option<(u32, u32, u32)> {
    let first = out.lines().next()?.trim();
    let v = first.rsplit(' ').next()?.trim_start_matches('v');
    let mut it = v.split('.').map(|n| n.parse::<u32>().ok());
    Some((it.next()??, it.next()??, it.next()??))
}

/// 0.0.x has no `--session-id`, no session id in its hooks and no cwd in its session files,
/// so a session it runs cannot be tied to its notes.
pub(crate) fn supported(version: (u32, u32, u32)) -> bool {
    version.0 >= 1
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder per test, removed when dropped.
    struct Tmp(PathBuf);
    impl Tmp {
        fn path(&self) -> &Path { &self.0 }
    }
    impl Drop for Tmp {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }
    fn tmp(tag: &str) -> Tmp {
        let p = std::env::temp_dir().join(format!("ao-agents-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        Tmp(p)
    }

    const START: &str = r#"{"type":"session.start","data":{"sessionId":"fceb338b-f100-471c-9ed5-3975070c0ba2","copilotVersion":"1.0.89","context":{"cwd":"/w/x","branch":"master"}},"timestamp":"2026-09-28T21:11:37.170Z"}"#;
    const TURN: &str = r#"{"type":"assistant.turn_start","data":{"turnId":"0"},"timestamp":"2026-09-28T21:11:38.100Z"}"#;
    const MSG: &str = r#"{"type":"assistant.message","data":{"messageId":"m","content":"ok","toolRequests":[]},"timestamp":"2026-09-28T21:11:38.500Z"}"#;
    const END: &str = r#"{"type":"assistant.turn_end","data":{"turnId":"0"},"timestamp":"2026-09-28T21:11:38.590Z"}"#;

    #[test]
    fn a_turn_is_busy_until_it_ends() {
        assert!(fold(&[START, TURN].join("\n")).busy);
        let f = fold(&[START, TURN, MSG, END].join("\n"));
        assert!(!f.busy);
        assert_eq!(f.last_activity.as_deref(), Some("ok"));
        assert_eq!(f.last_activity_at.as_deref(), Some("2026-09-28T21:11:38.500Z"));
        assert_eq!(f.cwd.as_deref(), Some("/w/x"));
    }

    // Observed on 1.0.89: asking "Do you want to update notes.md?" writes
    // permission.requested inside the open turn; the tool then runs once it is answered.
    #[test]
    fn a_permission_question_is_waiting_until_the_tool_runs() {
        const ASK: &str = r#"{"type":"permission.requested","data":{}}"#;
        const RUN: &str = r#"{"type":"tool.execution_start","data":{}}"#;
        const RAN: &str = r#"{"type":"tool.execution_complete","data":{}}"#;
        let asking = fold(&[START, TURN, RUN, ASK].join("\n"));
        assert!(asking.waiting && asking.busy);
        assert!(!fold(&[START, TURN, RUN, ASK, RAN].join("\n")).waiting, "answered: back to work");
        assert!(!fold(&[START, TURN, ASK, END].join("\n")).waiting, "the turn ended");
    }

    #[test]
    fn the_installed_version_decides_whether_copilot_is_offered() {
        assert_eq!(parse_version("0.0.369\nCommit: 83653a1"), Some((0, 0, 369)));
        assert_eq!(parse_version("GitHub Copilot CLI 1.0.89.\nRun 'copilot update' to check for updates."), Some((1, 0, 89)));
        assert_eq!(parse_version("garbage"), None);
        assert!(!supported((0, 0, 369)));
        assert!(supported((1, 0, 89)));
    }

    #[test]
    fn a_session_is_found_by_its_folder() {
        let t = tmp("copilot1");
        let id = "fceb338b-f100-471c-9ed5-3975070c0ba2";
        assert_eq!(transcript_path(t.path(), id), None);
        let d = t.path().join("session-state").join(id);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("events.jsonl"), START).unwrap();
        assert_eq!(transcript_path(t.path(), id), Some(d.join("events.jsonl")));
        assert_eq!(transcript_path(t.path(), "../x"), None);
    }

    // Run by hand against a real Copilot run: AO_PROBE_HOME=<COPILOT_HOME> AO_PROBE_ID=<id>
    // cargo test --lib live_copilot_session -- --ignored --nocapture.
    #[test]
    #[ignore]
    fn live_copilot_session() {
        let home = PathBuf::from(std::env::var("AO_PROBE_HOME").unwrap());
        let id = std::env::var("AO_PROBE_ID").unwrap();
        let path = transcript_path(&home, &id).expect("events.jsonl under the preset id");
        let f = fold(&std::fs::read_to_string(&path).unwrap());
        eprintln!("busy={} cwd={:?} last={:?}", f.busy, f.cwd, f.last_activity);
    }
}
