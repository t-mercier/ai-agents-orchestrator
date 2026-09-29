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
    /// The process group of the turn running now.
    pub pgid: Arc<Mutex<Option<i32>>>,
    /// `(role, agent)` of the turn running now.
    pub current: Arc<Mutex<Option<(Role, AgentId)>>>,
}

static LIVE: Mutex<Option<HashMap<String, Live>>> = Mutex::new(None);

fn with_live<T>(f: impl FnOnce(&mut HashMap<String, Live>) -> T) -> T {
    let mut g = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(HashMap::new))
}

pub(crate) fn live() -> Vec<Live> {
    with_live(|m| m.values().cloned().collect())
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

/// End every running turn now, for the app's quit: the runner's own check would come after
/// the process is gone.
pub(crate) fn kill_all() {
    for l in live() {
        l.stop.store(true, Ordering::SeqCst);
        if let Some(g) = *l.pgid.lock().unwrap() {
            // SAFETY: kill(2) on a group this app created.
            unsafe { libc::kill(-g, libc::SIGKILL) };
        }
    }
    save_running(&[]);
}

// ── The record of running groups, for the launch after a crash ──

fn running_file() -> PathBuf {
    crate::config::config_dir().join("collab").join("running.json")
}

fn save_running(groups: &[(String, i32)]) {
    let v: Vec<Value> = groups.iter().map(|(n, g)| json!({ "notes": n, "pgid": g })).collect();
    let path = running_file();
    if let Some(d) = path.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    let _ = crate::atomic_write(&path, &Value::Array(v).to_string());
}

fn record_running() {
    let groups: Vec<(String, i32)> = live()
        .iter()
        .filter_map(|l| l.pgid.lock().unwrap().map(|g| (l.notes_path.clone(), g)))
        .collect();
    save_running(&groups);
}

/// At launch: a group recorded by a run that did not end (the app crashed) is ended, and its
/// thread says it stopped. Returns the notes it closed.
pub(crate) fn recover_after_crash() -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(running_file()) else { return vec![] };
    let list: Vec<Value> = serde_json::from_str(&text).unwrap_or_default();
    let mut closed = Vec::new();
    for e in list {
        if let Some(g) = e.get("pgid").and_then(Value::as_i64) {
            // SAFETY: kill(2) on a group this app recorded as its own.
            unsafe { libc::kill(-(g as i32), libc::SIGKILL) };
        }
        if let Some(n) = e.get("notes").and_then(Value::as_str) {
            let _ = close_notes(n, "stopped: the app ended while it ran", None);
            closed.push(n.to_string());
        }
    }
    save_running(&[]);
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
/// reads as wrapped up, with the outcome as its summary.
fn close_notes(notes: &str, outcome: &str, started: Option<&str>) -> Result<(), String> {
    let (date, time) = now_hm();
    let from = started.unwrap_or(&time);
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

/// Register the collab and run it to its end on the calling thread. `emit` receives every
/// event. Returns the outcome written into the notes.
pub(crate) fn drive(s: Start, line_for: &LineFor, emit: &(dyn Fn(Value) + Send + Sync)) -> String {
    let live = Live {
        id: s.id.clone(),
        notes_path: s.notes_path.clone(),
        repo: s.repo.clone(),
        mode: s.mode,
        agents: s.agents.clone(),
        stop: Arc::new(AtomicBool::new(false)),
        pgid: Arc::new(Mutex::new(None)),
        current: Arc::new(Mutex::new(None)),
    };
    with_live(|m| m.insert(s.id.clone(), live.clone()));
    let started = now_hm().1;
    let _ = std::fs::create_dir_all(&s.scratch);
    let ev = |kind: &str, extra: Value| {
        let mut v = json!({ "id": s.id, "notesPath": s.notes_path, "kind": kind });
        if let (Some(o), Some(e)) = (v.as_object_mut(), extra.as_object()) {
            o.extend(e.clone());
        }
        emit(v);
    };
    let mut done: Vec<Done> = Vec::new();
    let outcome = loop {
        if live.stop.load(Ordering::SeqCst) {
            break "stopped".to_string();
        }
        let (role, agent) = match next(s.mode, &s.agents, &done) {
            Next::Finished(why) => break why,
            Next::Run(turns) if done.len() >= MAX_TURNS => break format!("stopped after {} turns", turns.len().max(MAX_TURNS)),
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
            record_running();
        });
        *live.pgid.lock().unwrap() = None;
        *live.current.lock().unwrap() = None;
        record_running();
        let result = match result {
            Ok(r) => r,
            Err(e) => break format!("{} could not start: {e}", crate::agents::session::display_name(agent)),
        };
        match result.outcome {
            Outcome::Done => {}
            Outcome::Stopped => break "stopped".to_string(),
            Outcome::TimedOut => break format!("{} timed out after 20 minutes", crate::agents::session::display_name(agent)),
            Outcome::Failed(code) => {
                let why = tail(result.output.trim(), 400).to_string();
                break format!("{} failed (exit {code}): {why}", crate::agents::session::display_name(agent));
            }
        }
        let answer = std::fs::read_to_string(&last_msg).ok().filter(|t| !t.trim().is_empty()).unwrap_or(result.output);
        let d = Done { role, agent, summary: tail(answer.trim(), SUMMARY_MAX).to_string() };
        let stat = if role == Role::Author {
            super::git::changes_since(Path::new(&s.repo), &s.base, 0).map(|(st, _)| st).unwrap_or_default()
        } else {
            String::new()
        };
        let (_, hm) = now_hm();
        let _ = write_notes(&s.notes_path, |c| append_to_section(c, "Collab thread", &thread_line(&d, &hm)));
        ev("turn_end", json!({
            "role": role.as_str(), "agent": agent.as_str(), "summary": d.summary,
            "stat": stat, "findings": if role == Role::Reviewer { findings(&d.summary) } else { String::new() },
            "approved": role == Role::Reviewer && approves(&d.summary),
        }));
        done.push(d);
    };
    let _ = close_notes(&s.notes_path, &outcome, Some(&started));
    with_live(|m| m.remove(&s.id));
    record_running();
    let kind = if outcome == "stopped" { "stopped" } else { "done" };
    ev(kind, json!({ "outcome": outcome }));
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(d: &Path, args: &[&str]) {
        assert!(std::process::Command::new("git").arg("-C").arg(d).args(args).status().unwrap().success());
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
    }
}
