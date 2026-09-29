//! The collab loop: run the mode's turns one after another, feed each result into the next
//! prompt, keep the thread in the session's notes, and say what happens as it happens.

use super::run::{run_turn, tail, Outcome};
use super::{approves, findings, next, prompt, Done, Mode, Next, Role};
use crate::agents::AgentId;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Each turn may run this long.
pub(crate) const TURN_LIMIT: Duration = Duration::from_secs(20 * 60);
/// A cross-review is author, review, fix, review: never more than this.
pub(crate) const MAX_TURNS: usize = 5;
/// What the reviewer is shown of the change.
const DIFF_MAX: usize = 60 * 1024;
/// What is kept of a turn's answer as its summary.
const SUMMARY_MAX: usize = 4 * 1024;

/// A running collab, as the readers and Stop need it.
#[derive(Clone)]
pub(crate) struct Live {
    pub id: String,
    pub notes_path: String,
    pub repo: String,
    pub mode: Mode,
    pub agents: Vec<AgentId>,
    pub stop: Arc<AtomicBool>,
    /// The process group of the turn running now, and its leader's start time: the record a
    /// later launch checks before it kills anything.
    pub pgid: Arc<Mutex<Option<i32>>>,
    pub leader_start: Arc<Mutex<Option<String>>>,
    /// `(role, agent)` of the turn running now.
    pub current: Arc<Mutex<Option<(Role, AgentId)>>>,
    /// Set once the session's notes carry the close line, so it is written once only
    /// (the app's quit writes it before the loop can).
    pub closed: Arc<AtomicBool>,
    /// `HH:MM` the collab started, for its close line.
    pub started: String,
}

impl Live {
    pub(crate) fn new(s: &Start) -> Self {
        Live {
            id: s.id.clone(),
            notes_path: s.notes_path.clone(),
            repo: s.repo.clone(),
            mode: s.mode,
            agents: s.agents.clone(),
            stop: Arc::new(AtomicBool::new(false)),
            pgid: Arc::new(Mutex::new(None)),
            leader_start: Arc::new(Mutex::new(None)),
            current: Arc::new(Mutex::new(None)),
            closed: Arc::new(AtomicBool::new(false)),
            started: now_hm().1,
        }
    }
}

static LIVE: Mutex<Option<HashMap<String, Live>>> = Mutex::new(None);

fn with_live<T>(f: impl FnOnce(&mut HashMap<String, Live>) -> T) -> T {
    let mut g = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(HashMap::new))
}

pub(crate) fn live() -> Vec<Live> {
    with_live(|m| m.values().cloned().collect())
}

/// Register a collab unless `busy`, given the repositories of the collabs already running,
/// names a reason to refuse. One lock covers both, so two starts at once on one repository
/// cannot both pass.
pub(crate) fn register(live: Live, busy: impl FnOnce(&[String]) -> Option<String>) -> Result<(), String> {
    with_live(|m| {
        let repos: Vec<String> = m.values().map(|l| l.repo.clone()).collect();
        if let Some(why) = busy(&repos) {
            return Err(why);
        }
        m.insert(live.id.clone(), live);
        Ok(())
    })?;
    save_running();
    Ok(())
}

/// The process groups of every running turn: a `claude -p` turn writes a pidfile, and its
/// process is in one of these groups (it is not a session of its own).
pub(crate) fn turn_groups() -> Vec<i32> {
    live().iter().filter_map(|l| *l.pgid.lock().unwrap()).collect()
}

/// Stop a collab; the running turn is ended by its runner within a tenth of a second.
pub(crate) fn stop(id: &str) -> bool {
    with_live(|m| m.get(id).map(|l| l.stop.store(true, Ordering::SeqCst)).is_some())
}

/// End one collab now, for the app's quit: kill its turn and write its close line, before
/// the process is gone — the loop that would have written it does not get the time.
fn quit_one(l: &Live, outcome: &str) {
    l.stop.store(true, Ordering::SeqCst);
    if let Some(g) = *l.pgid.lock().unwrap() {
        // SAFETY: kill(2) on a group this app created.
        unsafe { libc::kill(-g, libc::SIGKILL) };
    }
    if !l.closed.swap(true, Ordering::SeqCst) {
        let _ = close_notes(&l.notes_path, outcome, Some(&l.started));
    }
}

/// The app is quitting (or restarting into an update): every collab is ended and its
/// session closed as stopped.
pub(crate) fn kill_all() {
    for l in live() {
        quit_one(&l, "stopped when the app quit");
    }
    with_live(|m| m.clear());
    save_running();
}

// ── The record of running collabs, for the launch after a crash ──

#[cfg(not(test))]
fn running_file() -> PathBuf {
    crate::config::config_dir().join("collab").join("running.json")
}

/// Tests write their own record: one in the app's folder could be left holding a process
/// group that the next launch would kill.
#[cfg(test)]
fn running_file() -> PathBuf {
    std::env::temp_dir().join(format!("ao-collab-running-{}.json", std::process::id()))
}

/// When process `pid` started, as `ps` reports it: with the pid, what tells a group this
/// app recorded from a later process that reused the number.
pub(crate) fn process_start(pid: i32) -> Option<String> {
    let out = std::process::Command::new("ps").args(["-o", "lstart=", "-p", &pid.to_string()]).output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !s.is_empty()).then_some(s)
}

fn alive(pid: i64) -> bool {
    // SAFETY: kill(2) with signal 0 only checks that the process exists.
    pid > 0 && (unsafe { libc::kill(pid as i32, 0) } == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM))
}

fn read_record(path: &Path) -> Result<Vec<Value>, String> {
    match std::fs::read_to_string(path) {
        Ok(t) => serde_json::from_str(&t).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(e.to_string()),
    }
}

/// Rewrite the record: this app's live collabs, and every entry of another running app
/// (a dev build beside the installed one), which is that app's to settle.
fn save_running() {
    let me = std::process::id() as i64;
    let path = running_file();
    let mut entries: Vec<Value> = read_record(&path)
        .unwrap_or_default()
        .into_iter()
        .filter(|e| e.get("owner").and_then(Value::as_i64).is_some_and(|o| o != me && alive(o)))
        .collect();
    for l in live() {
        entries.push(json!({
            "notes": l.notes_path, "owner": me,
            "pgid": *l.pgid.lock().unwrap(), "leaderStart": *l.leader_start.lock().unwrap(),
        }));
    }
    if let Some(d) = path.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    if let Err(e) = crate::atomic_write(&path, &Value::Array(entries).to_string()) {
        eprintln!("[collab] could not record the running collabs: {e}");
    }
}

/// At launch: a collab recorded by an app that is no longer running (it crashed) has its turn
/// ended — only when the group's leader is still the process that was recorded — and its
/// session closed as stopped. Entries of another app that is running are left to it.
/// Returns the notes it closed.
pub(crate) fn recover_after_crash() -> Vec<String> {
    recover_from(&running_file(), std::process::id() as i64)
}

pub(crate) fn recover_from(path: &Path, me: i64) -> Vec<String> {
    let list = match read_record(path) {
        Ok(l) => l,
        Err(e) => {
            // Kept for a look rather than overwritten: it is the only record of what ran.
            eprintln!("[collab] {} is unreadable ({e}); set aside", path.display());
            let _ = std::fs::rename(path, path.with_extension("json.unreadable"));
            return vec![];
        }
    };
    let (mut keep, mut closed) = (Vec::new(), Vec::new());
    for e in list {
        let owner = e.get("owner").and_then(Value::as_i64).unwrap_or(0);
        if owner != me && alive(owner) {
            keep.push(e);
            continue;
        }
        let pgid = e.get("pgid").and_then(Value::as_i64);
        let recorded = e.get("leaderStart").and_then(Value::as_str);
        if let (Some(g), Some(at)) = (pgid, recorded) {
            if process_start(g as i32).as_deref() == Some(at) {
                // SAFETY: kill(2) on a group whose leader is the process this app recorded.
                unsafe { libc::kill(-(g as i32), libc::SIGKILL) };
            }
        }
        if let Some(n) = e.get("notes").and_then(Value::as_str) {
            match close_notes(n, "stopped: the app ended while it ran", None) {
                Ok(()) => closed.push(n.to_string()),
                Err(err) => eprintln!("[collab] could not close {n}: {err}"),
            }
        }
    }
    if let Err(err) = crate::atomic_write(path, &Value::Array(keep).to_string()) {
        eprintln!("[collab] could not rewrite {}: {err}", path.display());
    }
    closed
}

// ── The session's notes ──

static NOTES_LOCK: Mutex<()> = Mutex::new(());

/// Add `line` at the end of section `header`, creating the section before
/// `## Session history` when it is missing. Re-reads the file first: Sync, Close or the
/// user may have written it since.
pub(crate) fn append_to_section(content: &str, header: &str, line: &str) -> String {
    let h = format!("## {header}");
    match content.find(&format!("\n{h}\n")).map(|i| i + 1).or_else(|| content.starts_with(&format!("{h}\n")).then_some(0)) {
        Some(start) => {
            let body = start + h.len() + 1;
            let end = content[body..].find("\n## ").map(|i| body + i + 1).unwrap_or(content.len());
            let section = content[body..end].trim_end();
            let sep = if section.is_empty() { "" } else { "\n" };
            format!("{}{}{sep}{line}\n\n{}", &content[..body], section, content[end..].trim_start_matches('\n'))
                .trim_end()
                .to_string()
                + "\n"
        }
        None => {
            let block = format!("{h}\n{line}\n\n");
            match content.find("\n## Session history") {
                Some(i) => format!("{}\n\n{block}{}", content[..i].trim_end(), &content[i + 1..]),
                None => format!("{}\n\n{block}", content.trim_end()),
            }
        }
    }
}

fn write_notes(notes: &str, f: impl FnOnce(&str) -> String) -> Result<(), String> {
    let _g = NOTES_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = Path::new(notes);
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    crate::atomic_write(path, &f(&content))
}

fn now_hm() -> (String, String) {
    crate::local_date_time().unwrap_or_default()
}

/// The thread line of a finished turn: its summary's first line, and a review's findings
/// indented under it.
fn thread_line(d: &Done, hm: &str) -> String {
    let first = d.summary.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("(no answer)");
    let first: String = first.chars().take(240).collect();
    let mut line = format!("- {hm} {} ({}): {first}", crate::agents::session::display_name(d.agent), d.role.as_str());
    if d.role == Role::Reviewer && !approves(&d.summary) {
        for f in findings(&d.summary).lines() {
            line.push_str(&format!("\n  {f}"));
        }
    }
    line
}

/// Close the session in its notes: a history line in the time-range form the Closed tab
/// reads as wrapped up, with the outcome as its summary. Without a date the line would not
/// read as a close at all, so that is an error, as it is for the dashboard's own Close.
fn close_notes(notes: &str, outcome: &str, started: Option<&str>) -> Result<(), String> {
    let (date, time) = crate::local_date_time().ok_or("could not determine the current date")?;
    let from = started.filter(|s| !s.is_empty()).unwrap_or(&time);
    let line = format!("- {date} {from} → {time} | collab | {outcome}");
    write_notes(notes, |c| append_to_section(c, "Session history", &line))
}

// ── The loop ──

pub(crate) struct Start {
    pub id: String,
    pub notes_path: String,
    pub repo: String,
    pub base: String,
    pub mode: Mode,
    pub agents: Vec<AgentId>,
    pub task: String,
    /// Where each turn's final answer is written (Codex `exec -o`).
    pub scratch: PathBuf,
}

/// The line of one turn: `collab::line::turn_line` in the app, a fake CLI in tests.
pub(crate) type LineFor = dyn Fn(AgentId, bool, &str, &str, &str) -> String + Send + Sync;

/// Removes the collab from the live list however the loop ends — a panic included, which
/// would otherwise leave a card busy for ever and its repository refused.
struct Unregister(String);
impl Drop for Unregister {
    fn drop(&mut self) {
        with_live(|m| m.remove(&self.0));
        save_running();
    }
}

/// Run a collab to its end on the calling thread, registering it first unless `register`
/// already did. `emit` receives every event. Returns the outcome written into the notes.
pub(crate) fn drive(s: Start, line_for: &LineFor, emit: &(dyn Fn(Value) + Send + Sync)) -> String {
    let live = with_live(|m| m.entry(s.id.clone()).or_insert_with(|| Live::new(&s)).clone());
    let _unregister = Unregister(s.id.clone());
    let _ = std::fs::create_dir_all(&s.scratch);
    let ev = |kind: &str, extra: Value| {
        let mut v = json!({ "id": s.id, "notesPath": s.notes_path, "kind": kind });
        if let (Some(o), Some(e)) = (v.as_object_mut(), extra.as_object()) {
            o.extend(e.clone());
        }
        emit(v);
    };
    let name = crate::agents::session::display_name;
    let mut done: Vec<Done> = Vec::new();
    let outcome = loop {
        if live.stop.load(Ordering::SeqCst) {
            break "stopped".to_string();
        }
        let (role, agent) = match next(s.mode, &s.agents, &done) {
            Next::Finished(why) => break why,
            Next::Run(_) if done.len() >= MAX_TURNS => break format!("stopped after {} turns", done.len()),
            Next::Run(mut turns) => turns.remove(0),
        };
        let last_author = done.iter().rev().find(|d| d.role == Role::Author).map(|d| d.summary.clone());
        let last_review = done.iter().rev().find(|d| d.role == Role::Reviewer).map(|d| findings(&d.summary));
        let changes = if role == Role::Reviewer {
            match super::git::changes_since(Path::new(&s.repo), &s.base, DIFF_MAX) {
                Ok(c) => Some(c),
                Err(e) => break format!("could not read the change: {e}"),
            }
        } else {
            None
        };
        let text = match role {
            Role::Author => prompt(Role::Author, &s.task, last_review.as_deref().filter(|_| !done.is_empty()), None, None),
            _ => prompt(role, &s.task, last_author.as_deref(), None, changes.as_ref().map(|(a, b)| (a.as_str(), b.as_str()))),
        };
        let last_msg = s.scratch.join(format!("turn-{}.txt", done.len() + 1));
        let _ = std::fs::remove_file(&last_msg);
        let line = line_for(agent, role != Role::Reviewer, &s.repo, &text, &last_msg.to_string_lossy());
        *live.current.lock().unwrap() = Some((role, agent));
        ev("turn_start", json!({ "role": role.as_str(), "agent": agent.as_str() }));
        let result = run_turn(&line, &s.repo, TURN_LIMIT, &live.stop, &|g| {
            *live.pgid.lock().unwrap() = Some(g);
            *live.leader_start.lock().unwrap() = process_start(g);
            save_running();
        });
        *live.pgid.lock().unwrap() = None;
        *live.leader_start.lock().unwrap() = None;
        *live.current.lock().unwrap() = None;
        save_running();
        let result = match result {
            Ok(r) => r,
            Err(e) => break format!("{} could not start: {e}", name(agent)),
        };
        match result.outcome {
            Outcome::Done => {}
            Outcome::Stopped => break "stopped".to_string(),
            Outcome::TimedOut => break format!("{} timed out after 20 minutes", name(agent)),
            Outcome::Failed(code) => {
                let why = tail(format!("{}\n{}", result.stdout.trim(), result.stderr.trim()).trim(), 400).to_string();
                break format!("{} failed (exit {code}): {why}", name(agent));
            }
        }
        // The answer is stdout (or Codex's -o file) — never the shell's own stderr notices.
        let answer = std::fs::read_to_string(&last_msg).ok().filter(|t| !t.trim().is_empty()).unwrap_or(result.stdout);
        let d = Done { role, agent, summary: tail(answer.trim(), SUMMARY_MAX).to_string() };
        let stat = if role == Role::Author {
            match super::git::changes_since(Path::new(&s.repo), &s.base, 0) {
                // Nothing to review is not an approval: the author did not do the task.
                Ok((st, _)) if st.trim().is_empty() => break format!("{} changed nothing: {}", name(agent), tail(d.summary.trim(), 300)),
                Ok((st, _)) => st,
                Err(e) => break format!("could not read the change: {e}"),
            }
        } else {
            String::new()
        };
        let (_, hm) = now_hm();
        let notes_error = write_notes(&s.notes_path, |c| append_to_section(c, "Collab thread", &thread_line(&d, &hm))).err();
        if let Some(e) = &notes_error {
            ev("notes_error", json!({ "error": format!("the thread could not be written to the notes: {e}") }));
        }
        let unreadable = role == Role::Reviewer && !approves(&d.summary) && findings(&d.summary).is_empty();
        ev("turn_end", json!({
            "role": role.as_str(), "agent": agent.as_str(), "summary": d.summary,
            "stat": stat, "findings": if role == Role::Reviewer { findings(&d.summary) } else { String::new() },
            "approved": role == Role::Reviewer && approves(&d.summary),
        }));
        done.push(d);
        // A review that neither approves nor lists a `- file:line — problem` line gives the
        // author nothing to fix; a fix turn on an empty list would be a guess.
        if unreadable {
            break format!("{}'s review could not be read: it neither answered LGTM nor listed a finding as `- file:line — problem`", name(agent));
        }
    };
    let close_error = if live.closed.swap(true, Ordering::SeqCst) {
        None
    } else {
        close_notes(&s.notes_path, &outcome, Some(&live.started)).err()
    };
    if let Some(e) = close_error {
        ev("notes_error", json!({ "error": format!("the session could not be closed in its notes: {e}") }));
    }
    let kind = if outcome == "stopped" { "stopped" } else { "done" };
    ev(kind, json!({ "outcome": outcome }));
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test repositories ignore the developer's own git config (signing, hooks).
    fn git(d: &Path, args: &[&str]) {
        assert!(std::process::Command::new("git").env("GIT_CONFIG_GLOBAL", "/dev/null").arg("-C").arg(d).args(args).status().unwrap().success());
    }

    fn setup(tag: &str) -> (PathBuf, String, String) {
        let d = std::env::temp_dir().join(format!("ao-collab-engine-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let repo = d.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git(&repo, &["init", "-q"]);
        git(&repo, &["config", "user.email", "t@example.com"]);
        git(&repo, &["config", "user.name", "t"]);
        std::fs::write(repo.join("net.rs"), "fn get() {}\n").unwrap();
        git(&repo, &["add", "."]);
        git(&repo, &["commit", "-qm", "base"]);
        let base = super::super::git::head(&repo).unwrap();
        let notes = d.join("FEAT/x/notes.md");
        std::fs::create_dir_all(notes.parent().unwrap()).unwrap();
        std::fs::write(&notes, "---\nname: x\n---\n\n# x\n\n## Goal\n\n## Session history\n").unwrap();
        (d, base, notes.to_string_lossy().into_owned())
    }

    /// A fake pair of agents: the author appends a line to net.rs; the reviewer lists a
    /// finding the first time and approves the second, keeping count in a file.
    fn fake(dir: PathBuf) -> impl Fn(AgentId, bool, &str, &str, &str) -> String + Send + Sync {
        move |_a, writes, repo, prompt, _last| {
            let count = dir.join("reviews");
            let seen_findings = if prompt.contains("net.rs:1 — no retry") { "saw-findings" } else { "first" };
            if writes {
                format!("cd '{repo}' && echo '// retry ({seen_findings})' >> net.rs && echo 'Added a retry.'")
            } else {
                format!(
                    "cd '{repo}' && n=$(cat '{c}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '{c}'; \
                     if [ $n -eq 1 ]; then printf 'Looked at it.\\n- net.rs:1 — no retry\\n'; else echo LGTM; fi",
                    c = count.display()
                )
            }
        }
    }

    fn start(d: &Path, base: &str, notes: &str, tag: &str) -> Start {
        Start {
            id: format!("t-{tag}"), notes_path: notes.to_string(), repo: d.join("repo").to_string_lossy().into_owned(),
            base: base.to_string(), mode: Mode::CrossReview, agents: vec![AgentId::Claude, AgentId::Codex],
            task: "add a retry".into(), scratch: d.join("scratch"),
        }
    }

    #[test]
    fn a_cross_review_writes_reviews_fixes_and_ends_approved() {
        let (d, base, notes) = setup("full");
        let events = Arc::new(Mutex::new(Vec::<Value>::new()));
        let ev2 = events.clone();
        let outcome = drive(start(&d, &base, &notes, "full"), &fake(d.clone()), &move |v| ev2.lock().unwrap().push(v));
        assert_eq!(outcome, "The reviewer found nothing blocking.");
        let code = std::fs::read_to_string(d.join("repo/net.rs")).unwrap();
        assert!(code.contains("retry (first)") && code.contains("retry (saw-findings)"), "the fix saw the findings: {code}");
        let kinds: Vec<String> = events.lock().unwrap().iter().map(|e| e["kind"].as_str().unwrap().to_string()).collect();
        assert_eq!(kinds.iter().filter(|k| *k == "turn_end").count(), 4, "{kinds:?}");
        assert_eq!(kinds.last().map(String::as_str), Some("done"));
        let text = std::fs::read_to_string(&notes).unwrap();
        assert!(text.contains("## Collab thread") && text.contains("Codex (reviewer)") && text.contains("  - net.rs:1 — no retry"), "{text}");
        assert!(text.contains("| collab | The reviewer found nothing blocking."));
        assert_eq!(crate::reader::session_history_info(&text).0, "closed", "the Closed tab files it");
        assert!(live().iter().all(|l| l.id != "t-full"), "unregistered at the end");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn stop_ends_the_running_turn_and_the_collab() {
        let (d, base, notes) = setup("stop");
        let slow = |_a: AgentId, _w: bool, _r: &str, _p: &str, _l: &str| "sleep 30".to_string();
        let s = start(&d, &base, &notes, "stop");
        let id = s.id.clone();
        std::thread::spawn(move || {
            for _ in 0..50 {
                std::thread::sleep(Duration::from_millis(100));
                if !turn_groups().is_empty() && stop(&id) {
                    return;
                }
            }
        });
        let outcome = drive(s, &slow, &|_| {});
        assert_eq!(outcome, "stopped");
        assert!(std::fs::read_to_string(&notes).unwrap().contains("| collab | stopped"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_failing_turn_stops_the_collab_and_says_why() {
        let (d, base, notes) = setup("fail");
        let broken = |_a: AgentId, _w: bool, _r: &str, _p: &str, _l: &str| "echo 'not logged in' >&2; exit 2".to_string();
        let outcome = drive(start(&d, &base, &notes, "fail"), &broken, &|_| {});
        assert!(outcome.starts_with("Claude Code failed (exit 2)") && outcome.contains("not logged in"), "{outcome}");
        let _ = std::fs::remove_dir_all(&d);
    }

    fn sleeper_group() -> std::process::Child {
        use std::os::unix::process::CommandExt;
        std::process::Command::new("sleep").arg("60").process_group(0).spawn().unwrap()
    }
    fn dead_pid() -> i64 {
        let mut c = std::process::Command::new("true").spawn().unwrap();
        let id = c.id() as i64;
        c.wait().unwrap();
        id
    }

    #[test]
    fn a_group_left_by_a_crash_is_ended_and_its_session_closed_as_stopped() {
        let (d, _, notes) = setup("recover");
        let mut g = sleeper_group();
        let rec = d.join("running.json");
        std::fs::write(&rec, json!([{ "notes": notes, "owner": dead_pid(), "pgid": g.id(), "leaderStart": process_start(g.id() as i32) }]).to_string()).unwrap();
        assert_eq!(recover_from(&rec, std::process::id() as i64), vec![notes.clone()]);
        let _ = g.wait();
        assert!(std::fs::read_to_string(&notes).unwrap().contains("| collab | stopped: the app ended while it ran"));
        assert_eq!(std::fs::read_to_string(&rec).unwrap(), "[]");
        let _ = std::fs::remove_dir_all(&d);
    }

    // The number was reused (a reboot, a long gap): the group is someone else's now.
    #[test]
    fn a_recorded_group_whose_leader_changed_is_not_killed() {
        let (d, _, notes) = setup("reused");
        let mut g = sleeper_group();
        let rec = d.join("running.json");
        std::fs::write(&rec, json!([{ "notes": notes, "owner": dead_pid(), "pgid": g.id(), "leaderStart": "Mon Jan  1 00:00:00 2001" }]).to_string()).unwrap();
        recover_from(&rec, std::process::id() as i64);
        std::thread::sleep(Duration::from_millis(200));
        assert!(g.try_wait().unwrap().is_none(), "not ours: left alive");
        assert!(std::fs::read_to_string(&notes).unwrap().contains("stopped: the app ended while it ran"), "the session is still closed");
        let _ = g.kill();
        let _ = g.wait();
        let _ = std::fs::remove_dir_all(&d);
    }

    // A dev build beside the installed app: the other app's running collab is its own.
    #[test]
    fn an_entry_of_another_running_app_is_left_to_it() {
        let (d, _, notes) = setup("owner");
        let mut other_app = sleeper_group();
        let mut g = sleeper_group();
        let rec = d.join("running.json");
        std::fs::write(&rec, json!([{ "notes": notes, "owner": other_app.id(), "pgid": g.id(), "leaderStart": process_start(g.id() as i32) }]).to_string()).unwrap();
        assert!(recover_from(&rec, std::process::id() as i64).is_empty());
        std::thread::sleep(Duration::from_millis(200));
        assert!(g.try_wait().unwrap().is_none());
        assert!(std::fs::read_to_string(&rec).unwrap().contains(&format!("\"owner\":{}", other_app.id())), "kept for its owner");
        assert!(!std::fs::read_to_string(&notes).unwrap().contains("stopped"));
        for c in [&mut g, &mut other_app] {
            let _ = c.kill();
            let _ = c.wait();
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn an_unreadable_record_is_set_aside_not_overwritten() {
        let d = std::env::temp_dir().join(format!("ao-collab-rec-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let rec = d.join("running.json");
        std::fs::write(&rec, "{ not json").unwrap();
        assert!(recover_from(&rec, 1).is_empty());
        assert_eq!(std::fs::read_to_string(rec.with_extension("json.unreadable")).unwrap(), "{ not json");
        let _ = std::fs::remove_dir_all(&d);
    }

    // Quitting mid-turn: the session is closed as stopped by the quit itself, once.
    #[test]
    fn quitting_mid_turn_closes_the_session_as_stopped_once() {
        let (d, base, notes) = setup("quit");
        let s = start(&d, &base, &notes, "quit");
        let id = s.id.clone();
        let slow = |_a: AgentId, _w: bool, _r: &str, _p: &str, _l: &str| "sleep 30".to_string();
        let h = std::thread::spawn(move || drive(s, &slow, &|_| {}));
        let l = loop {
            if let Some(l) = live().into_iter().find(|l| l.id == id && l.pgid.lock().unwrap().is_some()) {
                break l;
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        quit_one(&l, "stopped when the app quit");
        assert!(std::fs::read_to_string(&notes).unwrap().contains("| collab | stopped when the app quit"), "written by the quit itself");
        assert_eq!(h.join().unwrap(), "stopped");
        let text = std::fs::read_to_string(&notes).unwrap();
        assert_eq!(text.matches("| collab |").count(), 1, "{text}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_second_collab_on_the_same_repository_is_refused_atomically() {
        let (d, base, notes) = setup("twice");
        let a = start(&d, &base, &notes, "twice-a");
        let b = start(&d, &base, &notes, "twice-b");
        let ra = a.repo.clone();
        assert!(register(Live::new(&a), |c| super::super::busy_reason(&ra, c, &[], &[])).is_ok());
        let rb = b.repo.clone();
        assert!(register(Live::new(&b), |c| super::super::busy_reason(&rb, c, &[], &[])).unwrap_err().contains("already running"));
        with_live(|m| m.remove("t-twice-a"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_collab_whose_loop_panics_leaves_the_live_list() {
        let (d, base, notes) = setup("panic");
        let boom = |_a: AgentId, _w: bool, _r: &str, _p: &str, _l: &str| -> String { panic!("boom") };
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| drive(start(&d, &base, &notes, "panic"), &boom, &|_| {})));
        assert!(r.is_err());
        assert!(live().iter().all(|l| l.id != "t-panic"), "no phantom collab refusing the repository");
        let _ = std::fs::remove_dir_all(&d);
    }

    // An author that does nothing and a reviewer that approves an empty diff looked like a
    // successful review.
    #[test]
    fn an_author_that_changes_nothing_ends_the_collab_without_a_review() {
        let (d, base, notes) = setup("idle");
        let lazy = |_a: AgentId, w: bool, _r: &str, _p: &str, _l: &str| if w { "echo 'I would start by reading the code.'".to_string() } else { "echo LGTM".to_string() };
        let outcome = drive(start(&d, &base, &notes, "idle"), &lazy, &|_| {});
        assert!(outcome.starts_with("Claude Code changed nothing"), "{outcome}");
        assert!(!std::fs::read_to_string(&notes).unwrap().contains("(reviewer)"), "no review of nothing");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_review_with_no_finding_line_stops_instead_of_an_empty_fix() {
        let (d, base, notes) = setup("numbered");
        let f = |_a: AgentId, w: bool, repo: &str, _p: &str, _l: &str| {
            if w { format!("cd '{repo}' && echo x >> net.rs && echo done") } else { "printf '1. net.rs:1 is wrong\\n2. no test\\n'".to_string() }
        };
        let outcome = drive(start(&d, &base, &notes, "numbered"), &f, &|_| {});
        assert!(outcome.contains("review could not be read"), "{outcome}");
        let _ = std::fs::remove_dir_all(&d);
    }

    // The shell's own notices go to stderr; they must not hide the reviewer's last line.
    #[test]
    fn an_lgtm_followed_by_stderr_noise_still_approves() {
        let (d, base, notes) = setup("noise");
        let f = |_a: AgentId, w: bool, repo: &str, _p: &str, _l: &str| {
            if w { format!("cd '{repo}' && echo x >> net.rs && echo done") } else { "echo LGTM; echo 'N/A: version v20 is not yet installed' >&2".to_string() }
        };
        assert_eq!(drive(start(&d, &base, &notes, "noise"), &f, &|_| {}), "The reviewer found nothing blocking.");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_thread_that_cannot_be_written_is_reported() {
        let (d, base, _) = setup("nonotes");
        let missing = d.join("gone/notes.md").to_string_lossy().into_owned();
        let events = Arc::new(Mutex::new(Vec::<Value>::new()));
        let e2 = events.clone();
        let f = |_a: AgentId, w: bool, repo: &str, _p: &str, _l: &str| if w { format!("cd '{repo}' && echo x >> net.rs") } else { "echo LGTM".to_string() };
        drive(start(&d, &base, &missing, "nonotes"), &f, &move |v| e2.lock().unwrap().push(v));
        let errs: Vec<String> = events.lock().unwrap().iter().filter(|e| e["kind"] == "notes_error").map(|e| e["error"].as_str().unwrap().to_string()).collect();
        assert!(errs.iter().any(|e| e.contains("thread could not be written")) && errs.iter().any(|e| e.contains("could not be closed")), "{errs:?}");
        let _ = std::fs::remove_dir_all(&d);
    }

    // A test that wrote the app's real record could leave a process group there that the
    // next launch would kill.
    #[test]
    fn tests_never_write_the_real_running_file() {
        assert!(running_file().starts_with(std::env::temp_dir()), "{}", running_file().display());
    }

    #[test]
    fn a_line_goes_at_the_end_of_its_section_which_is_created_when_missing() {
        let c = "# x\n\n## Goal\ng\n\n## Session history\n- old\n";
        let c = append_to_section(c, "Collab thread", "- 09:00 a");
        assert!(c.contains("## Collab thread\n- 09:00 a\n\n## Session history\n- old"), "{c}");
        let c = append_to_section(&c, "Collab thread", "- 09:05 b");
        assert!(c.contains("- 09:00 a\n- 09:05 b\n\n## Session history"), "{c}");
        let c = append_to_section(&c, "Session history", "- new");
        assert!(c.trim_end().ends_with("- old\n- new"), "{c}");
    }

    // Run by hand: a real cross-review, Claude Code author and Codex reviewer, with the
    // app's own command lines, in a throw-away repository.
    //   AO_LIVE_DIR=<empty folder> cargo test --lib live_cross_review -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_cross_review() {
        let d = PathBuf::from(std::env::var("AO_LIVE_DIR").unwrap());
        let repo = d.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        git(&repo, &["init", "-q"]);
        git(&repo, &["config", "user.email", "t@example.com"]);
        git(&repo, &["config", "user.name", "t"]);
        std::fs::write(repo.join("README.md"), "# greet\n").unwrap();
        git(&repo, &["add", "."]);
        git(&repo, &["commit", "-qm", "base"]);
        let base = super::super::git::head(&repo).unwrap();
        let notes = d.join("FEAT/greet/notes.md");
        std::fs::create_dir_all(notes.parent().unwrap()).unwrap();
        std::fs::write(&notes, "---\nname: greet\ncollab_mode: cross-review\n---\n\n# greet\n\n## Collab thread\n\n## Session history\n").unwrap();
        let s = Start {
            id: "live".into(), notes_path: notes.to_string_lossy().into_owned(), repo: repo.to_string_lossy().into_owned(),
            base, mode: Mode::CrossReview, agents: vec![AgentId::Claude, AgentId::Codex],
            task: "Create greet.py with a function greet(name) that returns 'Hello, <name>!' and rejects an empty name with ValueError.".into(),
            scratch: d.join("scratch"),
        };
        let outcome = drive(s, &super::super::line::turn_line, &|v| eprintln!("EVENT {} {} {}", v["kind"], v["agent"], v["role"]));
        eprintln!("OUTCOME {outcome}");
        eprintln!("{}", std::fs::read_to_string(&notes).unwrap());
        assert!(repo.join("greet.py").exists(), "the author wrote the file");
        assert!(!outcome.contains("failed") && !outcome.contains("changed nothing"), "{outcome}");
    }
}
