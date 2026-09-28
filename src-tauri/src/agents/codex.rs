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

/// `(id, cwd, started)` from a rollout's first line, its `session_meta`. `started` is the
/// UTC timestamp Codex writes there, e.g. `2026-09-28T21:10:04.579Z`.
pub(crate) fn meta(first_line: &str) -> Option<(String, String, String)> {
    let d: Value = serde_json::from_str(first_line).ok()?;
    if d.get("type").and_then(Value::as_str) != Some("session_meta") {
        return None;
    }
    let p = d.get("payload")?;
    let id = p.get("id").and_then(Value::as_str)?.to_string();
    let cwd = p.get("cwd").and_then(Value::as_str)?.to_string();
    let started = p.get("timestamp").or_else(|| d.get("timestamp")).and_then(Value::as_str).unwrap_or("").to_string();
    Some((id, cwd, started))
}

/// A time as Codex writes it in `session_meta`: UTC, millisecond precision, `Z`. Two
/// timestamps in this form compare correctly as strings.
pub(crate) fn utc_rfc3339(t: SystemTime) -> String {
    let d = t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let (secs, ms) = (d.as_secs() as i64, d.subsec_millis());
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{ms:03}Z", rem / 3600, rem % 3600 / 60, rem % 60)
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

/// The rollout a session the app started at `since` in `cwd` wrote: one whose
/// `session_meta` says it *started* after the spawn, in that launch directory, and whose id
/// no other terminal holds (`taken`). Being written to since the spawn is not enough:
/// another Codex session working in the same folder keeps writing its own. `Err` when two
/// match — two sessions started in one folder at once cannot be told apart, and a wrong
/// match would attach one session's conversation to the other's notes.
pub(crate) fn find_started(root: &Path, cwd: &str, since: SystemTime, taken: &[String]) -> Result<Option<String>, String> {
    let floor = since.checked_sub(std::time::Duration::from_secs(2)).unwrap_or(since);
    let floor_utc = utc_rfc3339(floor);
    let mut found: Vec<String> = Vec::new();
    for day in newest_day_dirs(root) {
        for p in rollouts_in(&day) {
            let fresh = std::fs::metadata(&p).and_then(|m| m.modified()).is_ok_and(|m| m >= floor);
            if !fresh {
                continue;
            }
            if let Some((id, c, started)) = first_line(&p).as_deref().and_then(meta) {
                let new_enough = started.as_str() >= floor_utc.as_str();
                if c == cwd && new_enough && crate::is_valid_session_id(&id) && !taken.contains(&id) && !found.contains(&id) {
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

/// Rollouts already found, by id. A resumed session keeps writing its original rollout,
/// which may sit in an old day folder; without this each poll would walk every folder.
static FOUND: std::sync::Mutex<Option<std::collections::HashMap<String, PathBuf>>> = std::sync::Mutex::new(None);

/// A remembered rollout that is still on disk; one that has gone is forgotten.
fn cached_path(id: &str) -> Option<PathBuf> {
    let mut g = FOUND.lock().ok()?;
    let map = g.get_or_insert_with(Default::default);
    match map.get(id) {
        Some(p) if p.is_file() => Some(p.clone()),
        Some(_) => {
            map.remove(id);
            None
        }
        None => None,
    }
}

/// The rollout of session `id`: its file name ends in `-<id>.jsonl`. Remembered once
/// found; otherwise the two newest day folders are searched first (where a live session
/// writes), then the rest.
pub(crate) fn transcript_path(root: &Path, id: &str) -> Option<PathBuf> {
    if !crate::is_valid_session_id(id) {
        return None;
    }
    if let Some(p) = cached_path(id).filter(|p| p.starts_with(root)) {
        return Some(p);
    }
    let found = walk_for(root, id);
    if let (Some(p), Ok(mut g)) = (&found, FOUND.lock()) {
        g.get_or_insert_with(Default::default).insert(id.to_string(), p.clone());
    }
    found
}

fn walk_for(root: &Path, id: &str) -> Option<PathBuf> {
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
        meta_line_at(id, cwd, &utc_rfc3339(SystemTime::now()))
    }
    fn meta_line_at(id: &str, cwd: &str, ts: &str) -> String {
        format!(r#"{{"timestamp":"{ts}","type":"session_meta","payload":{{"session_id":"{id}","id":"{id}","cwd":"{cwd}","timestamp":"{ts}"}}}}"#)
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
        assert_eq!(find_started(t.path(), "/w/x", since, &[]).unwrap().as_deref(), Some(ID));
        assert_eq!(find_started(t.path(), "/w/none", since, &[]).unwrap(), None);
        write_rollout(t.path(), "2026/09/28", "01a0e9da-1111-7c12-882e-57b7554edd81", "/w/x");
        assert!(find_started(t.path(), "/w/x", since, &[]).is_err(), "two in one folder: refused, not guessed");
    }

    // The review's scenario: another Codex session (or Codex Desktop) working in the same
    // folder keeps writing its rollout. Written after the spawn is not started after it.
    #[test]
    fn a_busy_older_session_in_the_same_folder_is_not_the_new_one() {
        let t = tmp("codex-busy");
        let since = SystemTime::now();
        let dir = t.path().join("sessions/2026/09/28");
        std::fs::create_dir_all(&dir).unwrap();
        let old_start = utc_rfc3339(since - std::time::Duration::from_secs(3600));
        std::fs::write(dir.join(format!("rollout-x-{ID}.jsonl")), format!("{}\n{STARTED}\n", meta_line_at(ID, "/w/x", &old_start))).unwrap();
        assert_eq!(find_started(t.path(), "/w/x", since, &[]).unwrap(), None);
    }

    #[test]
    fn an_id_another_terminal_holds_is_never_given_to_this_one() {
        let t = tmp("codex-taken");
        let since = SystemTime::now() - std::time::Duration::from_secs(1);
        write_rollout(t.path(), "2026/09/28", ID, "/w/x");
        assert_eq!(find_started(t.path(), "/w/x", since, &[ID.to_string()]).unwrap(), None);
    }

    // Found once, then remembered: a session resumed days later writes into an old day
    // folder, which would otherwise mean walking every folder on each 5 s poll. A file that
    // has gone since is looked up again, never returned from memory.
    #[test]
    fn a_found_rollout_is_remembered_until_it_goes() {
        let t = tmp("codex-cache");
        let id = "01a0e9da-4444-7c12-882e-57b7554edd81";
        let old = write_rollout(t.path(), "2025/01/02", id, "/w/x");
        assert_eq!(transcript_path(t.path(), id), Some(old.clone()));
        assert!(cached_path(id).is_some(), "remembered after the first walk");
        std::fs::remove_file(&old).unwrap();
        assert_eq!(transcript_path(t.path(), id), None);
        assert!(cached_path(id).is_none(), "forgotten once the file is gone");
    }

    #[test]
    fn utc_timestamps_compare_like_codex_writes_them() {
        let t = std::time::UNIX_EPOCH + std::time::Duration::from_millis(1_790_629_804_579);
        assert_eq!(utc_rfc3339(t), "2026-09-28T21:10:04.579Z");
    }

    #[test]
    fn an_older_rollout_in_the_same_folder_is_not_the_new_session() {
        let t = tmp("codex2");
        write_rollout(t.path(), "2026/09/28", ID, "/w/x");
        let later = SystemTime::now() + std::time::Duration::from_secs(60);
        assert_eq!(find_started(t.path(), "/w/x", later, &[]).unwrap(), None);
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
        let id = find_started(&home(), &cwd, since, &[]).unwrap().expect("the rollout of the run");
        let path = transcript_path(&home(), &id).unwrap();
        let f = fold(&std::fs::read_to_string(&path).unwrap());
        eprintln!("id={id} busy={} last={:?}", f.busy, f.last_activity);
        assert!(!f.busy, "the run finished its turn");
    }
}
