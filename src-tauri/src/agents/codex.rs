//! Codex CLI sessions: where their rollouts are, what state they are in, and which rollout
//! a session the app just started wrote. Shapes observed on codex-cli 0.158.0 (see the
//! probe results in docs/superpowers/research/2026-09-28-codex-copilot-parity.md).

use super::Fold;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// `$CODEX_HOME`, else `~/.codex`.
pub(crate) fn home() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| crate::config::home().join(".codex"))
}

/// busy while a turn is open: `task_started` after the last `task_complete` or
/// `turn_aborted` (an Esc). The last assistant message is the activity line.
pub(crate) fn fold(text: &str) -> Fold {
    let mut f = Fold::default();
    for line in text.lines() {
        let Ok(d) = serde_json::from_str::<Value>(line) else { continue };
        let p = d.get("payload").unwrap_or(&Value::Null);
        match (d.get("type").and_then(Value::as_str), p.get("type").and_then(Value::as_str)) {
            (Some("event_msg"), Some("task_started")) => f.busy = true,
            (Some("event_msg"), Some("task_complete" | "turn_aborted")) => f.busy = false,
            (Some("response_item"), Some("message")) if p.get("role").and_then(Value::as_str) == Some("assistant") => {
                let text: String = p
                    .get("content")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter(|c| c.get("type").and_then(Value::as_str) == Some("output_text"))
                    .filter_map(|c| c.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join(" ");
                if !text.trim().is_empty() {
                    f.last_activity = Some(text.trim().to_string());
                    f.last_activity_at = d.get("timestamp").and_then(Value::as_str).map(String::from);
                }
            }
            (Some("session_meta"), _) => {
                f.cwd = p.get("cwd").and_then(Value::as_str).map(String::from);
            }
            _ => {}
        }
    }
    f
}

/// `(id, cwd)` from a rollout's first line, its `session_meta`.
pub(crate) fn meta(first_line: &str) -> Option<(String, String)> {
    let d: Value = serde_json::from_str(first_line).ok()?;
    if d.get("type").and_then(Value::as_str) != Some("session_meta") {
        return None;
    }
    let p = d.get("payload")?;
    let id = p.get("id").and_then(Value::as_str)?.to_string();
    let cwd = p.get("cwd").and_then(Value::as_str)?.to_string();
    Some((id, cwd))
}

/// The two newest day folders under `sessions/YYYY/MM/DD`. A session the app has just
/// started, or resumed today, writes into one of them, so a search never walks the years.
fn newest_day_dirs(root: &Path) -> Vec<PathBuf> {
    fn children_desc(p: &Path) -> Vec<PathBuf> {
        let mut v: Vec<PathBuf> = std::fs::read_dir(p)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        v.sort();
        v.reverse();
        v
    }
    let mut days = Vec::new();
    for y in children_desc(&root.join("sessions")) {
        for m in children_desc(&y) {
            for d in children_desc(&m) {
                days.push(d);
                if days.len() == 2 {
                    return days;
                }
            }
        }
    }
    days
}

fn rollouts_in(dir: &Path) -> impl Iterator<Item = PathBuf> {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.starts_with("rollout-") && name.ends_with(".jsonl")
        })
}

fn first_line(path: &Path) -> Option<String> {
    use std::io::{BufRead, Read};
    let f = std::fs::File::open(path).ok()?;
    let mut line = String::new();
    std::io::BufReader::new(f).take(256 * 1024).read_line(&mut line).ok()?;
    Some(line)
}

/// The rollout a session the app started at `since` in `cwd` wrote: modified at or after
/// the spawn, with that launch directory. `Err` when two match — two sessions started in
/// the same folder at once cannot be told apart, and a wrong match would attach one
/// session's conversation to the other's notes.
pub(crate) fn find_started(root: &Path, cwd: &str, since: SystemTime) -> Result<Option<String>, String> {
    let floor = since.checked_sub(std::time::Duration::from_secs(2)).unwrap_or(since);
    let mut found: Vec<String> = Vec::new();
    for day in newest_day_dirs(root) {
        for p in rollouts_in(&day) {
            let fresh = std::fs::metadata(&p).and_then(|m| m.modified()).is_ok_and(|m| m >= floor);
            if !fresh {
                continue;
            }
            if let Some((id, c)) = first_line(&p).as_deref().and_then(meta) {
                if c == cwd && crate::is_valid_session_id(&id) && !found.contains(&id) {
                    found.push(id);
                }
            }
        }
    }
    match found.len() {
        0 => Ok(None),
        1 => Ok(found.pop()),
        _ => Err("two Codex sessions started in this folder at the same time".into()),
    }
}

/// The rollout of session `id`: its file name ends in `-<id>.jsonl`. The two newest day
/// folders are searched first (where a live session writes), then the rest.
pub(crate) fn transcript_path(root: &Path, id: &str) -> Option<PathBuf> {
    if !crate::is_valid_session_id(id) {
        return None;
    }
    let suffix = format!("-{id}.jsonl");
    let matches = |p: &PathBuf| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(&suffix));
    for day in newest_day_dirs(root) {
        if let Some(p) = rollouts_in(&day).find(matches) {
            return Some(p);
        }
    }
    let sessions = root.join("sessions");
    let mut stack = vec![sessions];
    while let Some(dir) = stack.pop() {
        for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if matches(&p) {
                return Some(p);
            }
        }
    }
    None
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

    const ID: &str = "01a0e9da-76d9-7c12-882e-57b7554edd81";

    fn meta_line(id: &str, cwd: &str) -> String {
        format!(r#"{{"timestamp":"2026-09-28T21:10:04Z","type":"session_meta","payload":{{"session_id":"{id}","id":"{id}","cwd":"{cwd}"}}}}"#)
    }
    const STARTED: &str = r#"{"type":"event_msg","payload":{"type":"task_started","turn_id":"t1"}}"#;
    const ANSWER: &str = r#"{"timestamp":"2026-09-28T21:10:08.542Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"ok"}]}}"#;
    const DEV: &str = r###"{"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"## Memory"}]}}"###;
    const DONE: &str = r#"{"type":"event_msg","payload":{"type":"task_complete","turn_id":"t1"}}"#;
    const ABORTED: &str = r#"{"type":"event_msg","payload":{"type":"turn_aborted","turn_id":"t2"}}"#;

    #[test]
    fn a_turn_is_busy_until_it_completes_or_is_aborted() {
        let m = meta_line(ID, "/w/x");
        assert!(fold(&[m.as_str(), STARTED, DEV].join("\n")).busy);
        let done = fold(&[m.as_str(), STARTED, ANSWER, DONE].join("\n"));
        assert!(!done.busy);
        assert_eq!(done.last_activity.as_deref(), Some("ok"));
        assert_eq!(done.last_activity_at.as_deref(), Some("2026-09-28T21:10:08.542Z"));
        assert_eq!(done.cwd.as_deref(), Some("/w/x"));
        assert!(!fold(&[STARTED, ABORTED].join("\n")).busy, "Esc ends the turn");
        assert!(fold("not json\n{").last_activity.is_none(), "garbage is idle, not a crash");
    }

    fn write_rollout(root: &Path, day: &str, id: &str, cwd: &str) -> PathBuf {
        let dir = root.join("sessions").join(day);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(format!("rollout-2026-09-28T23-10-04-{id}.jsonl"));
        std::fs::write(&p, format!("{}\n{STARTED}\n", meta_line(id, cwd))).unwrap();
        p
    }

    #[test]
    fn the_session_the_app_started_is_the_fresh_rollout_in_its_folder() {
        let t = tmp("codex1");
        let since = SystemTime::now() - std::time::Duration::from_secs(1);
        write_rollout(t.path(), "2026/09/28", ID, "/w/x");
        write_rollout(t.path(), "2026/09/28", "01a0e9da-0000-7c12-882e-57b7554edd81", "/w/other");
        assert_eq!(find_started(t.path(), "/w/x", since).unwrap().as_deref(), Some(ID));
        assert_eq!(find_started(t.path(), "/w/none", since).unwrap(), None);
        write_rollout(t.path(), "2026/09/28", "01a0e9da-1111-7c12-882e-57b7554edd81", "/w/x");
        assert!(find_started(t.path(), "/w/x", since).is_err(), "two in one folder: refused, not guessed");
    }

    #[test]
    fn an_older_rollout_in_the_same_folder_is_not_the_new_session() {
        let t = tmp("codex2");
        write_rollout(t.path(), "2026/09/28", ID, "/w/x");
        let later = SystemTime::now() + std::time::Duration::from_secs(60);
        assert_eq!(find_started(t.path(), "/w/x", later).unwrap(), None);
    }

    #[test]
    fn a_rollout_is_found_by_id_in_any_day() {
        let t = tmp("codex3");
        let old = write_rollout(t.path(), "2025/01/02", ID, "/w/x");
        write_rollout(t.path(), "2026/09/28", "01a0e9da-2222-7c12-882e-57b7554edd81", "/w/y");
        write_rollout(t.path(), "2026/09/27", "01a0e9da-3333-7c12-882e-57b7554edd81", "/w/y");
        assert_eq!(transcript_path(t.path(), ID), Some(old));
        assert_eq!(transcript_path(t.path(), "../../etc"), None);
    }

    // Run by hand against a real Codex run: AO_PROBE_CWD=<launch dir> AO_PROBE_SINCE=<unix secs>
    // cargo test --lib live_codex_rollout -- --ignored. It proves the match on what Codex
    // actually wrote, not on a fixture.
    #[test]
    #[ignore]
    fn live_codex_rollout() {
        let cwd = std::env::var("AO_PROBE_CWD").unwrap();
        let since: u64 = std::env::var("AO_PROBE_SINCE").unwrap().parse().unwrap();
        let since = std::time::UNIX_EPOCH + std::time::Duration::from_secs(since);
        let id = find_started(&home(), &cwd, since).unwrap().expect("the rollout of the run");
        let path = transcript_path(&home(), &id).unwrap();
        let f = fold(&std::fs::read_to_string(&path).unwrap());
        eprintln!("id={id} busy={} last={:?}", f.busy, f.last_activity);
        assert!(!f.busy, "the run finished its turn");
    }
}
