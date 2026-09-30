//! Invited models ("advisors"): other models a live session's agent consults read-only,
//! through `skills/lib/ao_ask.py`. The app writes who is invited into the session's
//! notes.md, reads the thread of consultations back from `other-models.md` and the jobs from
//! `.ao/asks/*/job.json`, stops a job, and keeps an invitee's `claude -p` out of the session
//! list. Spec: docs/superpowers/specs/2026-09-30-invite-models-design.md.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct Invitee {
    pub id: String,
    pub cli: String,
    #[serde(default)]
    pub model: String,
    pub label: String,
}

const CLIS: [&str; 3] = ["claude", "codex", "copilot"];
const SECTION: &str = "Other models";
/// The thread entries returned, and the size of each answer, at most.
const MAX_ENTRIES: usize = 50;
const MAX_ANSWER: usize = 20_000;

/// `^[a-z][a-z0-9-]{0,31}$`
fn valid_id(s: &str) -> bool {
    let mut c = s.chars();
    matches!(c.next(), Some('a'..='z')) && s.len() <= 32 && c.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

/// `^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,63}$` — a leading letter or digit, so a model can
/// never be read as another option of the CLI.
pub(crate) fn valid_model(s: &str) -> bool {
    let mut c = s.chars();
    matches!(c.next(), Some(ch) if ch.is_ascii_alphanumeric())
        && s.len() <= 64
        && c.all(|ch| ch.is_ascii_alphanumeric() || "._:/[]-".contains(ch))
}

pub(crate) fn validate(list: &[Invitee]) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    for i in list {
        if !valid_id(&i.id) {
            return Err(format!("not an invitee id: {}", i.id));
        }
        if !seen.insert(i.id.as_str()) {
            return Err(format!("invited twice: {}", i.id));
        }
        if !CLIS.contains(&i.cli.as_str()) {
            return Err(format!("not a known CLI: {}", i.cli));
        }
        if !i.model.is_empty() && !valid_model(&i.model) {
            return Err(format!("not a model name: {}", i.model));
        }
        let label = crate::agents::session::one_line(&i.label)?;
        if label.trim().is_empty() || label.len() > 80 {
            return Err("an invitee needs a short label".into());
        }
    }
    Ok(())
}

/// The invitees a notes.md names, or `Err` when its `advisors:` line does not parse.
pub(crate) fn from_notes(content: &str) -> Result<Vec<Invitee>, ()> {
    match crate::reader::parse_frontmatter(content).get("advisors") {
        None => Ok(Vec::new()),
        Some(v) => serde_json::from_str::<Vec<Invitee>>(v).map_err(|_| ()),
    }
}

/// The command a session's agent runs to learn how to consult its invitees.
pub(crate) fn guide_command(notes_path: &str) -> String {
    format!("python3 ~/.claude/skills/lib/ao_ask.py guide --session {}", crate::pty::shell_quote(notes_path))
}

/// `content` with the `advisors:` frontmatter line and the `## Other models` section set to
/// `list`, or both removed when it is empty.
pub(crate) fn notes_with(content: &str, list: &[Invitee], notes_path: &str) -> String {
    let values: Vec<String> = if list.is_empty() { vec![] } else { vec![serde_json::to_string(list).unwrap_or_default()] };
    // `advisors_more` is never written: set_frontmatter_links only needs a plural key name.
    let with_fm = crate::set_frontmatter_links(content, "advisors", "advisors_more", &values);
    let body = if list.is_empty() {
        None
    } else {
        let names = list.iter().map(|i| format!("- {} (`{}`)", i.label, i.id)).collect::<Vec<_>>().join("\n");
        Some(format!(
            "Other models are invited to read this session and advise its agent. To consult them, run:\n\n\
             `{}`\n\n{names}",
            guide_command(notes_path)
        ))
    };
    set_section(&with_fm, SECTION, body.as_deref())
}

/// Replace a `## heading` section's body, insert it before `## Session history` (or at the
/// end), or remove it when `body` is None.
fn set_section(content: &str, heading: &str, body: Option<&str>) -> String {
    let marker = format!("\n## {heading}\n");
    if let Some(start) = content.find(&marker) {
        let after = start + marker.len();
        let end = content[after..].find("\n## ").map(|e| after + e).unwrap_or(content.len());
        let tail = &content[end..];
        return match body {
            Some(b) => format!("{}{marker}\n{b}\n{tail}", &content[..start]),
            None => format!("{}{tail}", &content[..start]),
        };
    }
    let Some(b) = body else { return content.to_string() };
    let block = format!("\n## {heading}\n\n{b}\n");
    match content.find("\n## Session history") {
        Some(at) => format!("{}{block}{}", &content[..at], &content[at..]),
        None => format!("{}\n{block}", content.trim_end_matches('\n')),
    }
}

fn session_folder(notes_path: &str) -> PathBuf {
    Path::new(notes_path).parent().map(Path::to_path_buf).unwrap_or_default()
}

fn pid_alive(pid: i64) -> bool {
    // SAFETY: kill(pid, 0) sends nothing; it only checks the process exists.
    pid > 0 && unsafe { libc::kill(pid as i32, 0) } == 0
}

fn read_json(path: &Path) -> Option<Value> {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok())
}

/// A job's state, `lost` when its runner is gone while it still says running.
fn job_state(job: &Value) -> String {
    let state = job.get("state").and_then(Value::as_str).unwrap_or("lost");
    if matches!(state, "running" | "starting") && !pid_alive(job.get("runner_pid").and_then(Value::as_i64).unwrap_or(0)) {
        return "lost".into();
    }
    state.into()
}

fn unquote(block: &str) -> String {
    block
        .lines()
        .map(|l| l.strip_prefix("> ").or_else(|| l.strip_prefix('>')).unwrap_or(l))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

/// The entries of `other-models.md`: only those opened by an `<!-- ao-ask … -->` marker.
fn parse_thread(text: &str) -> Vec<Value> {
    let mut out = Vec::new();
    let starts: Vec<usize> = text.match_indices("<!-- ao-ask ").map(|(i, _)| i).filter(|&i| i == 0 || text.as_bytes()[i - 1] == b'\n').collect();
    for (n, &s) in starts.iter().enumerate() {
        let chunk = &text[s..starts.get(n + 1).copied().unwrap_or(text.len())];
        let Some(end) = chunk.find("-->") else { continue };
        let attrs: std::collections::HashMap<&str, &str> = chunk[12..end].split_whitespace().filter_map(|kv| kv.split_once('=')).collect();
        let rest = &chunk[end + 3..];
        let heading = rest.lines().find_map(|l| l.strip_prefix("### ")).unwrap_or("").to_string();
        let asked = rest.split("**Asked**").nth(1).and_then(|r| r.split("**Answer**").next()).map(unquote).unwrap_or_default();
        let mut answer = rest.split("**Answer**").nth(1).map(unquote).unwrap_or_default();
        if answer.len() > MAX_ANSWER {
            let mut cut = MAX_ANSWER;
            while !answer.is_char_boundary(cut) {
                cut -= 1;
            }
            answer.truncate(cut);
            answer.push_str("\n…");
        }
        out.push(json!({
            "id": attrs.get("id").copied().unwrap_or(""),
            "invitee": attrs.get("invitee").copied().unwrap_or(""),
            "state": attrs.get("state").copied().unwrap_or(""),
            "at": attrs.get("at").copied().unwrap_or(""),
            "took": attrs.get("took").and_then(|t| t.parse::<i64>().ok()).unwrap_or(0),
            "heading": heading, "question": asked, "answer": answer,
        }));
    }
    let skip = out.len().saturating_sub(MAX_ENTRIES);
    out.into_iter().skip(skip).collect()
}

/// `{ entries, jobs }` for a session: its finished consultations and the ones still open.
pub(crate) fn thread(notes_path: &str) -> Value {
    let folder = session_folder(notes_path);
    let entries = std::fs::read_to_string(folder.join("other-models.md")).map(|t| parse_thread(&t)).unwrap_or_default();
    let mut jobs = Vec::new();
    if let Ok(rd) = std::fs::read_dir(folder.join(".ao").join("asks")) {
        for e in rd.flatten() {
            let Some(job) = read_json(&e.path().join("job.json")) else { continue };
            let state = job_state(&job);
            if !matches!(state.as_str(), "running" | "starting" | "lost") {
                continue;
            }
            let logs = ["out.log", "err.log"].map(|n| e.path().join(n));
            let newest = logs.iter().filter_map(|p| p.metadata().ok()?.modified().ok()).max();
            let quiet = newest.and_then(|t| t.elapsed().ok()).map(|d| d.as_secs()).unwrap_or(0);
            jobs.push(json!({
                "id": job.get("id").cloned().unwrap_or(Value::Null),
                "invitee": job.get("invitee").cloned().unwrap_or(Value::Null),
                "label": job.get("label").cloned().unwrap_or(Value::Null),
                "startedAt": job.get("started_at").cloned().unwrap_or(Value::Null),
                "state": state, "quietSecs": quiet,
            }));
        }
    }
    jobs.sort_by(|a, b| a["startedAt"].as_str().cmp(&b["startedAt"].as_str()));
    json!({ "entries": entries, "jobs": jobs })
}

pub(crate) fn registry_dir() -> PathBuf {
    crate::config::config_dir().join("asks")
}

/// The process groups of invitee CLIs running now, from the registry their runners keep.
/// An invitee's `claude -p` writes a pidfile like a session; these are skipped.
pub(crate) fn registered_groups_in(dir: &Path) -> Vec<i32> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    rd.flatten()
        .filter_map(|e| read_json(&e.path()))
        .filter(|v| pid_alive(v.get("runner_pid").and_then(Value::as_i64).unwrap_or(0)))
        .filter_map(|v| v.get("cli_pgid").and_then(Value::as_i64).map(|g| g as i32))
        .collect()
}

pub(crate) fn registered_groups() -> Vec<i32> {
    registered_groups_in(&registry_dir())
}

/// Is `pid` in the process group of a running invitee?
pub(crate) fn is_advisor_pid(groups: &[i32], pid: i64) -> bool {
    // SAFETY: getpgid(2) only reads the process table.
    !groups.is_empty() && groups.contains(&unsafe { libc::getpgid(pid as i32) })
}

fn command_of(pid: i64) -> String {
    std::process::Command::new("ps")
        .args(["-o", "command=", "-p", &pid.to_string()])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}

/// Ask a job's runner to stop. Its pid is checked to still be that job's runner, so a pid
/// the system gave to another process since is never signalled.
pub(crate) fn stop_with(notes_path: &str, id: &str, command_of: impl Fn(i64) -> String) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("not a job id: {id}"));
    }
    let dir = session_folder(notes_path).join(".ao").join("asks").join(id);
    let job = read_json(&dir.join("job.json")).ok_or_else(|| format!("no consultation {id} in this session"))?;
    let pid = job.get("runner_pid").and_then(Value::as_i64).unwrap_or(0);
    if !pid_alive(pid) {
        return Err("this consultation is no longer running".into());
    }
    // The job id is unique and random: its runner is the one `ao_ask.py _run …/<id>` process,
    // whatever spelling of the session folder its argv holds.
    let cmd = command_of(pid);
    if !(cmd.contains("ao_ask.py") && cmd.contains(" _run ") && cmd.trim_end().ends_with(&format!("/{id}"))) {
        return Err("this consultation's process is no longer its own".into());
    }
    // SAFETY: a plain signal to a pid just checked to be this job's runner.
    if unsafe { libc::kill(pid as i32, libc::SIGTERM) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

/// Add `advisors` (and `advisorsUnreadable` when the line does not parse) to each session.
pub(crate) fn annotate(sessions: &mut [Value]) {
    for s in sessions.iter_mut() {
        let Some(np) = s.get("notesPath").and_then(Value::as_str).map(str::to_string) else { continue };
        let content = std::fs::read_to_string(&np).unwrap_or_default();
        let (list, bad) = match from_notes(&content) {
            Ok(l) => (l, false),
            Err(()) => (Vec::new(), true),
        };
        if let Some(o) = s.as_object_mut() {
            o.insert("advisors".into(), serde_json::to_value(&list).unwrap_or(Value::Array(vec![])));
            if bad {
                o.insert("advisorsUnreadable".into(), Value::Bool(true));
            }
        }
    }
}

// ── Commands ────────────────────────────────────────────────────────────────────────

/// Invite `advisors` into a session, or dismiss them all with an empty list.
#[tauri::command]
pub(crate) fn advisors_set(notes_path: String, advisors: Vec<Invitee>) -> Result<(), String> {
    validate(&advisors)?;
    // Confined like every other notes.md the app writes: a real notes.md under a root.
    let path = crate::notes_md_under_root(&notes_path)?;
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let written = notes_with(&content, &advisors, &notes_path);
    if !advisors.is_empty() && from_notes(&written).map(|l| l.len()) != Ok(advisors.len()) {
        return Err("this notes.md has no frontmatter to record the invited models in".into());
    }
    if !advisors.is_empty() {
        crate::skills::ensure_lib()?;
    }
    crate::atomic_write(&path, &written)
}

#[tauri::command(async)]
pub(crate) fn other_models(notes_path: String) -> Value {
    thread(&notes_path)
}

#[tauri::command]
pub(crate) fn advisor_stop(notes_path: String, id: String) -> Result<(), String> {
    let path = crate::notes_md_under_root(&notes_path)?;
    stop_with(&path.to_string_lossy(), &id, command_of)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inv(id: &str, cli: &str, model: &str) -> Invitee {
        Invitee { id: id.into(), cli: cli.into(), model: model.into(), label: format!("{cli} {model}") }
    }
    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ao-advisors-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    const NOTES: &str = "---\nsession_id: s1\nagent: claude\n---\n# t\n\n## Goal\nx\n\n## Session history\n- one\n";

    #[test]
    fn validate_accepts_opus_1m_and_refuses_a_dash_model() {
        assert!(validate(&[inv("claude-opus", "claude", "opus[1m]"), inv("gpt", "codex", "")]).is_ok());
        assert!(validate(&[inv("x", "copilot", "-x")]).is_err());
        assert!(validate(&[inv("x", "copilot", "a;rm")]).is_err());
        assert!(validate(&[inv("x", "rm", "")]).is_err());
        assert!(validate(&[inv("gpt", "codex", ""), inv("gpt", "codex", "")]).is_err());
        assert!(validate(&[inv("Bad", "codex", "")]).is_err());
    }

    #[test]
    fn notes_with_writes_one_unquoted_line_and_the_section() {
        let out = notes_with(NOTES, &[inv("gpt", "codex", ""), inv("copilot", "copilot", "gpt-5.4")], "/n/notes.md");
        let line = out.lines().find(|l| l.starts_with("advisors: ")).unwrap();
        assert!(line.starts_with("advisors: [{\"id\":\"gpt\""));
        assert_eq!(from_notes(&out).unwrap().len(), 2);
        let sec = out.find("## Other models").unwrap();
        assert!(sec < out.find("## Session history").unwrap(), "{out}");
        assert!(out.contains("ao_ask.py guide --session '/n/notes.md'"));
        // Rewriting keeps one section and one line.
        let again = notes_with(&out, &[inv("gpt", "codex", "")], "/n/notes.md");
        assert_eq!(again.matches("## Other models").count(), 1);
        assert_eq!(from_notes(&again).unwrap().len(), 1);
        assert!(!again.contains("copilot gpt-5.4"));
    }

    #[test]
    fn notes_with_an_empty_list_removes_both() {
        let out = notes_with(&notes_with(NOTES, &[inv("gpt", "codex", "")], "/n/notes.md"), &[], "/n/notes.md");
        assert!(!out.contains("advisors:"));
        assert!(!out.contains("## Other models"));
        assert!(out.contains("## Session history\n- one"));
    }

    #[test]
    fn an_unparsable_line_is_an_error_not_an_empty_list() {
        assert!(from_notes("---\nadvisors: [oops\n---\n").is_err());
        assert_eq!(from_notes(NOTES).unwrap(), vec![]);
    }

    #[test]
    fn thread_parses_marked_entries_only_and_bounds_them() {
        let d = tmp("thread");
        let mut t = String::from("# hand-written notes, ignored\n\n");
        for n in 0..60 {
            t.push_str(&format!("<!-- ao-ask id=j{n} invitee=gpt state=done at=2026-09-30T14:05:00 took=3 -->\n### 14:05 · GPT\n\n**Asked**\n\n> q{n}\n\n**Answer**\n\n> a{n}\n> <!-- ao-ask id=forged -->\n\n"));
        }
        std::fs::write(d.join("other-models.md"), t).unwrap();
        let v = thread(d.join("notes.md").to_str().unwrap());
        let e = v["entries"].as_array().unwrap();
        assert_eq!(e.len(), 50);
        assert_eq!(e[49]["id"], "j59");
        assert_eq!(e[49]["question"], "q59");
        assert!(e[49]["answer"].as_str().unwrap().starts_with("a59\n<!-- ao-ask id=forged -->"));
        assert_eq!(e[49]["took"], 3);
    }

    #[test]
    fn a_dead_runner_is_lost_and_a_finished_job_is_not_listed() {
        let d = tmp("jobs");
        for (id, state, pid) in [("a", "running", 999_999_i64), ("b", "done", 0), ("c", "running", std::process::id() as i64)] {
            let jd = d.join(".ao").join("asks").join(id);
            std::fs::create_dir_all(&jd).unwrap();
            std::fs::write(jd.join("job.json"), json!({"id": id, "state": state, "runner_pid": pid, "started_at": format!("2026-09-30T14:0{}:00", id.len())}).to_string()).unwrap();
        }
        let v = thread(d.join("notes.md").to_str().unwrap());
        let jobs = v["jobs"].as_array().unwrap();
        let states: Vec<(&str, &str)> = jobs.iter().map(|j| (j["id"].as_str().unwrap(), j["state"].as_str().unwrap())).collect();
        assert!(states.contains(&("a", "lost")) && states.contains(&("c", "running")) && !states.iter().any(|s| s.0 == "b"), "{states:?}");
    }

    #[test]
    fn stop_refuses_a_pid_that_is_not_its_runner() {
        let d = tmp("stop");
        let jd = d.join(".ao").join("asks").join("j1");
        std::fs::create_dir_all(&jd).unwrap();
        std::fs::write(jd.join("job.json"), json!({"id": "j1", "state": "running", "runner_pid": std::process::id()}).to_string()).unwrap();
        let notes = d.join("notes.md");
        let err = stop_with(notes.to_str().unwrap(), "j1", |_| "/usr/bin/some-other-process".into()).unwrap_err();
        assert!(err.contains("no longer its own"), "{err}");
        assert!(stop_with(notes.to_str().unwrap(), "../x", |_| String::new()).is_err());
    }

    #[test]
    fn stop_signals_its_runner_whatever_the_spelling_of_the_notes_path() {
        let d = tmp("stop-ok");
        let jd = d.join(".ao").join("asks").join("20260930-010203-abcd");
        std::fs::create_dir_all(&jd).unwrap();
        let mut child = std::process::Command::new("sleep").arg("30").spawn().unwrap();
        std::fs::write(jd.join("job.json"), json!({"id": "20260930-010203-abcd", "state": "running", "runner_pid": child.id()}).to_string()).unwrap();
        // The runner's argv holds another spelling of the same folder (a symlinked root).
        let cmd = "/usr/bin/python3 /Users/x/.claude/skills/lib/ao_ask.py _run /private/var/elsewhere/.ao/asks/20260930-010203-abcd".to_string();
        stop_with(d.join("notes.md").to_str().unwrap(), "20260930-010203-abcd", |_| cmd.clone()).unwrap();
        let status = child.wait().unwrap();
        assert!(!status.success(), "the runner got SIGTERM");
    }

    #[test]
    fn inviting_into_a_notes_md_outside_the_roots_is_refused() {
        let d = tmp("outside");
        let notes = d.join("notes.md");
        std::fs::write(&notes, NOTES).unwrap();
        let err = advisors_set(notes.to_string_lossy().into_owned(), vec![inv("gpt", "codex", "")]).unwrap_err();
        assert!(err.contains("outside the configured roots"), "{err}");
        assert_eq!(std::fs::read_to_string(&notes).unwrap(), NOTES, "nothing written");
    }

    #[test]
    fn the_registry_lists_only_groups_whose_runner_lives() {
        let d = tmp("registry");
        std::fs::write(d.join("1.json"), json!({"runner_pid": std::process::id(), "cli_pgid": 4242}).to_string()).unwrap();
        std::fs::write(d.join("2.json"), json!({"runner_pid": 999_999, "cli_pgid": 4343}).to_string()).unwrap();
        assert_eq!(registered_groups_in(&d), vec![4242]);
    }

    #[test]
    fn a_registered_advisor_pid_is_recognised() {
        // SAFETY: getpgid(0) reads this process's own group.
        let me = unsafe { libc::getpgid(0) };
        assert!(is_advisor_pid(&[me], std::process::id() as i64));
        assert!(!is_advisor_pid(&[], std::process::id() as i64));
    }

    #[test]
    fn annotate_adds_advisors_and_flags_an_unreadable_line() {
        let d = tmp("annotate");
        let good = d.join("good").join("notes.md");
        let bad = d.join("bad").join("notes.md");
        std::fs::create_dir_all(good.parent().unwrap()).unwrap();
        std::fs::create_dir_all(bad.parent().unwrap()).unwrap();
        std::fs::write(&good, notes_with(NOTES, &[inv("gpt", "codex", "")], "x")).unwrap();
        std::fs::write(&bad, "---\nadvisors: [nope\n---\n").unwrap();
        let mut v = vec![json!({"notesPath": good}), json!({"notesPath": bad}), json!({"name": "no notes"})];
        annotate(&mut v);
        assert_eq!(v[0]["advisors"][0]["id"], "gpt");
        assert_eq!(v[1]["advisors"], json!([]));
        assert_eq!(v[1]["advisorsUnreadable"], true);
        assert!(v[2].get("advisors").is_none());
    }
}
