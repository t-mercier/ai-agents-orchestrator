//! Brutus's runner: one headless Claude Code run per message, sandboxed by flags, its
//! stream-json relayed to the renderer as `brutus-event`s. See the spec's "sandbox"
//! section for why each flag is there; every one was verified by a probe.

use serde::Serialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Emitter;

use crate::{brutus_agent, brutus_home, config, pty};

const MAX_MESSAGE: usize = 8000;
const TIMEOUT: Duration = Duration::from_secs(180);
const RECENT_CLOSED_DAYS: &str = "14";

pub(crate) struct Plan {
    pub dir: String,
    pub agents: String,
    pub read_dirs: Vec<String>,
    pub resume: Option<String>,
    pub model: Option<String>,
}

pub(crate) fn claude_args(p: &Plan) -> Vec<String> {
    let mut a: Vec<String> = [
        "--restricted", "--agents", &p.agents, "--agent", "brutus", "-p",
        "--output-format", "stream-json", "--verbose",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    if let Some(id) = &p.resume {
        a.push("--resume".into());
        a.push(id.clone());
    }
    a.push("--tools".into());
    a.push(brutus_agent::TOOLS.join(","));
    a.push("--strict-mcp-config".into());
    a.push("--settings".into());
    a.push(format!("{}/settings.json", p.dir));
    for d in &p.read_dirs {
        a.push("--add-dir".into());
        a.push(d.clone());
    }
    a.push("--permission-mode".into());
    a.push("dontAsk".into());
    if let Some(m) = &p.model {
        a.push("--model".into());
        a.push(m.clone());
    }
    a
}

/// Through a login shell, as every headless run in this app: launched from Finder, the
/// app's PATH has no `claude`. Every argument is quoted; the message is not here at all —
/// it goes on stdin.
pub(crate) fn shell_line(p: &Plan) -> String {
    let args: Vec<String> = claude_args(p).iter().map(|a| pty::shell_quote(a)).collect();
    format!("cd {} && AO_HEADLESS=1 claude {}", pty::shell_quote(&p.dir), args.join(" "))
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum Event {
    Init { session_id: String },
    Step { tool: String, target: String },
    Text { text: String },
    Done { is_error: bool, result: String },
}

pub(crate) fn parse_line(line: &str) -> Vec<Event> {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return Vec::new() };
    let s = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    match v.get("type").and_then(Value::as_str) {
        Some("system") if v.get("subtype").and_then(Value::as_str) == Some("init") => {
            vec![Event::Init { session_id: s(&v, "session_id") }]
        }
        Some("assistant") => v
            .pointer("/message/content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|c| match c.get("type").and_then(Value::as_str) {
                Some("text") => Some(Event::Text { text: s(c, "text") }),
                Some("tool_use") => {
                    let input = c.get("input").cloned().unwrap_or(Value::Null);
                    let target = ["file_path", "pattern", "path"]
                        .iter()
                        .map(|k| s(&input, k))
                        .find(|t| !t.is_empty())
                        .unwrap_or_default();
                    Some(Event::Step { tool: s(c, "name"), target })
                }
                _ => None,
            })
            .collect(),
        Some("result") => vec![Event::Done {
            is_error: v.get("is_error").and_then(Value::as_bool).unwrap_or(false),
            result: s(&v, "result"),
        }],
        _ => Vec::new(),
    }
}

pub(crate) fn check_message(m: &str) -> Result<String, String> {
    let t = m.trim();
    if t.is_empty() {
        return Err("empty message".into());
    }
    if t.chars().count() > MAX_MESSAGE {
        return Err(format!("message over {MAX_MESSAGE} characters"));
    }
    Ok(t.to_string())
}

static BUSY: AtomicBool = AtomicBool::new(false);
static CHILD: Mutex<Option<Child>> = Mutex::new(None);

/// One run at a time. Held for the length of a run; released on drop, panics included.
pub(crate) struct Busy;
impl Busy {
    pub(crate) fn acquire() -> Result<Busy, String> {
        BUSY.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| Busy)
            .map_err(|_| "Brutus is still answering the previous message".to_string())
    }
}
impl Drop for Busy {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::SeqCst);
    }
}

fn conversation_path() -> std::path::PathBuf {
    brutus_home::dir().join("conversation.json")
}
fn read_conversation() -> Option<String> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(conversation_path()).ok()?).ok()?;
    v.get("sessionId").and_then(Value::as_str).filter(|s| crate::is_valid_session_id(s)).map(str::to_string)
}
fn write_conversation(id: &str) {
    let _ = std::fs::write(conversation_path(), json!({ "sessionId": id }).to_string());
}

/// `--restricted` ignores ~/.claude/settings.json, so the model is passed explicitly: the
/// app's own setting, else the one pinned in Claude Code's settings, else none.
fn resolve_model(cfg: &Value) -> Option<String> {
    let app = cfg.get("claudeModel").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if !app.is_empty() {
        return Some(app);
    }
    let raw = std::fs::read_to_string(config::home().join(".claude").join("settings.json")).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    v.get("model").and_then(Value::as_str).map(str::trim).filter(|m| !m.is_empty()).map(str::to_string)
}

fn cutoff_date() -> String {
    for args in [vec!["-v", &format!("-{RECENT_CLOSED_DAYS}d"), "+%Y-%m-%d"],
                 vec!["-d", &format!("-{RECENT_CLOSED_DAYS} days"), "+%Y-%m-%d"]] {
        if let Ok(o) = Command::new("date").args(&args).output() {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if o.status.success() && s.len() == 10 {
                return s;
            }
        }
    }
    "0000-00-00".into()
}

fn emit(app: &tauri::AppHandle, ev: &Value) {
    let _ = app.emit("brutus-event", ev);
}

/// Refresh his folder (settings.json, dashboard.md) and build the run. `live` is the
/// dashboard's live list; `with_history` adds the stale and recently closed sessions.
pub(crate) fn prepare(live: Vec<Value>, with_history: bool) -> Result<Plan, String> {
    let dir = brutus_home::ensure()?;
    let cfg = config::load();

    std::fs::write(dir.join("settings.json"), brutus_home::settings_json(&dir).to_string())
        .map_err(|e| e.to_string())?;
    let read_dirs = brutus_home::read_dirs(&cfg, &config::home());
    let knowledge: Vec<String> = read_dirs
        .iter()
        .filter(|d| cfg.get("roots").and_then(Value::as_array).into_iter().flatten()
            .filter_map(|r| r.get("vaultPath").and_then(Value::as_str))
            .filter_map(|v| std::fs::canonicalize(v).ok())
            .any(|v| v.to_string_lossy() == d.as_str()))
        .cloned()
        .collect();
    let (today, time) = crate::local_date_time().unwrap_or_default();
    let hist = if with_history { crate::reader::get_historical_sessions_all() } else { json!({}) };
    let md = brutus_home::dashboard_md(&live, &hist, &crate::prstatus::get_pr_status(),
        &knowledge, &cutoff_date(), &format!("{today} {time}"));
    std::fs::write(dir.join("dashboard.md"), md).map_err(|e| e.to_string())?;

    let a = cfg.get("assistant").cloned().unwrap_or(Value::Null);
    let name = a.get("name").and_then(Value::as_str).unwrap_or("Brutus");
    let style = a.get("style").and_then(Value::as_str).unwrap_or("concise");
    Ok(Plan {
        dir: dir.to_string_lossy().into_owned(),
        agents: brutus_agent::agents_json(name, style),
        read_dirs,
        resume: read_conversation(),
        model: resolve_model(&cfg),
    })
}

/// One run: the message on stdin, each stream event handed to `on_event` as it arrives,
/// and an `error` event when the stream ends without a result.
pub(crate) fn run(plan: &Plan, message: &str, mut on_event: impl FnMut(Value)) -> Result<(), String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut child = Command::new(&shell)
        .args(["-ilc", &shell_line(plan)])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not start claude: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(message.as_bytes());
    }
    let stdout = child.stdout.take().ok_or("no stdout")?;
    *CHILD.lock().unwrap() = Some(child);

    // The ceiling: a watcher kills a run that outlives it.
    let started = Instant::now();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));
        let mut guard = CHILD.lock().unwrap();
        match guard.as_mut() {
            None => return,
            Some(c) if started.elapsed() > TIMEOUT => {
                let _ = c.kill();
                return;
            }
            Some(_) => {}
        }
    });

    let mut done = false;
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        for ev in parse_line(&line) {
            if let Event::Init { session_id } = &ev {
                if crate::is_valid_session_id(session_id) {
                    write_conversation(session_id);
                }
            }
            if matches!(ev, Event::Done { .. }) {
                done = true;
            }
            on_event(serde_json::to_value(&ev).unwrap_or(Value::Null));
        }
    }
    let status = CHILD.lock().unwrap().take().and_then(|mut c| c.wait().ok());
    if !done {
        let why = if started.elapsed() > TIMEOUT {
            "Brutus took longer than 3 minutes and was stopped.".to_string()
        } else {
            match status {
                Some(s) if s.success() => "Brutus stopped without answering.".to_string(),
                Some(s) => format!("claude exited with {s}. Is Claude Code installed and logged in?"),
                None => "Stopped.".to_string(),
            }
        };
        on_event(json!({ "kind": "error", "message": why }));
    }
    Ok(())
}

#[tauri::command(async)]
pub fn brutus_ask(
    app: tauri::AppHandle,
    pty_state: tauri::State<pty::PtyManager>,
    message: String,
) -> Result<(), String> {
    let message = check_message(&message)?;
    let _busy = Busy::acquire()?;
    let plan = prepare(crate::reader::get_sessions(pty_state), true)?;
    run(&plan, &message, |ev| emit(&app, &ev))
}

#[tauri::command]
pub fn brutus_cancel() -> bool {
    CHILD.lock().unwrap().as_mut().map(|c| c.kill().is_ok()).unwrap_or(false)
}

/// A new conversation. His memory is untouched.
#[tauri::command]
pub fn brutus_reset() -> Result<(), String> {
    match std::fs::remove_file(conversation_path()) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[tauri::command]
pub fn brutus_status() -> Value {
    let mem = std::fs::read_to_string(brutus_home::dir().join("memory.md")).unwrap_or_default();
    json!({
        "memoryCount": brutus_home::memory_count(&mem),
        "running": BUSY.load(Ordering::SeqCst),
        "hasConversation": read_conversation().is_some(),
    })
}

#[tauri::command]
pub fn brutus_open_memory() -> Result<(), String> {
    let dir = brutus_home::ensure()?;
    let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    Command::new(opener).arg(dir.join("memory.md")).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan() -> Plan {
        Plan {
            dir: "/cfg/brutus".into(),
            agents: r#"{"brutus":{}}"#.into(),
            read_dirs: vec!["/w/BUG".into(), "/v".into()],
            resume: Some("6c985ef4-74a7-4bc7-bd29-c402e13526cb".into()),
            model: Some("claude-opus-5-5[1m]".into()),
        }
    }

    #[test]
    fn every_run_carries_the_whole_sandbox() {
        let a = claude_args(&plan());
        for flag in ["--restricted", "--strict-mcp-config", "-p", "--verbose"] {
            assert!(a.contains(&flag.to_string()), "missing {flag}: {a:?}");
        }
        let after = |f: &str| a[a.iter().position(|x| x == f).unwrap() + 1].clone();
        assert_eq!(after("--agent"), "brutus");
        assert_eq!(after("--tools"), "Read,Glob,Grep,Write,Edit");
        assert_eq!(after("--permission-mode"), "dontAsk");
        assert_eq!(after("--output-format"), "stream-json");
        assert_eq!(after("--settings"), "/cfg/brutus/settings.json");
        assert_eq!(after("--resume"), "6c985ef4-74a7-4bc7-bd29-c402e13526cb");
        assert_eq!(after("--model"), "claude-opus-5-5[1m]");
        let adds: Vec<_> = a.windows(2).filter(|w| w[0] == "--add-dir").map(|w| w[1].clone()).collect();
        assert_eq!(adds, vec!["/w/BUG", "/v"]);
    }

    #[test]
    fn no_resume_and_no_model_mean_no_flag_not_an_empty_one() {
        let mut p = plan();
        p.resume = None;
        p.model = None;
        let a = claude_args(&p);
        assert!(!a.contains(&"--resume".to_string()) && !a.contains(&"--model".to_string()));
    }

    #[test]
    fn the_shell_line_quotes_every_argument_and_never_holds_the_message() {
        let line = shell_line(&plan());
        assert!(line.starts_with("cd '/cfg/brutus' && AO_HEADLESS=1 claude '--restricted'"), "{line}");
        assert!(line.contains("'claude-opus-5-5[1m]'"), "brackets are a glob to the shell");
    }

    #[test]
    fn the_stream_maps_to_init_steps_text_and_done() {
        let l = |s: &str| parse_line(s);
        assert_eq!(l(r#"{"type":"system","subtype":"init","session_id":"abc"}"#),
            vec![Event::Init { session_id: "abc".into() }]);
        assert_eq!(l(r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"…"},{"type":"tool_use","name":"Read","input":{"file_path":"/w/BUG/x/notes.md"}},{"type":"text","text":"Two need you."}]}}"#),
            vec![Event::Step { tool: "Read".into(), target: "/w/BUG/x/notes.md".into() },
                 Event::Text { text: "Two need you.".into() }]);
        assert_eq!(l(r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"retry","path":"/v"}}]}}"#),
            vec![Event::Step { tool: "Grep".into(), target: "retry".into() }]);
        assert_eq!(l(r#"{"type":"result","subtype":"success","is_error":false,"result":"Teal","session_id":"abc"}"#),
            vec![Event::Done { is_error: false, result: "Teal".into() }]);
        assert_eq!(l(r#"{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Not logged in"}"#),
            vec![Event::Done { is_error: true, result: "Not logged in".into() }]);
    }

    #[test]
    fn noise_and_a_truncated_line_are_ignored_not_fatal() {
        assert!(parse_line(r#"{"type":"rate_limit_event"}"#).is_empty());
        assert!(parse_line(r#"{"type":"user","message":{"content":[]}}"#).is_empty());
        assert!(parse_line(r#"{"type":"assistant","message":{"con"#).is_empty());
        assert!(parse_line("Welcome to zsh").is_empty());
    }

    #[test]
    fn a_message_is_refused_when_empty_or_over_8000_characters() {
        assert!(check_message("   ").is_err());
        assert!(check_message(&"é".repeat(8001)).is_err());
        assert_eq!(check_message("  hi  ").unwrap(), "hi");
    }

    #[test]
    fn a_second_run_is_refused_while_one_is_in_flight() {
        let first = Busy::acquire().expect("free");
        assert!(Busy::acquire().is_err(), "second acquire must fail");
        drop(first);
        assert!(Busy::acquire().is_ok(), "released on drop");
    }

    /// The one end-to-end check: a real run of the installed claude, with this machine's
    /// config, through exactly the path brutus_ask takes. Ignored by default — it needs a
    /// logged-in claude and costs one run. `cargo test --lib -- --ignored real_run`
    #[test]
    #[ignore = "runs the real claude"]
    fn real_run_answers_from_the_dashboard() {
        let live = vec![serde_json::json!({ "name": "probe-waiting-session", "category": "BUG", "root": "Work",
            "status": "waiting", "notesPath": "/nowhere/notes.md" })];
        let plan = prepare(live, false).expect("prepare");
        let mut events: Vec<serde_json::Value> = Vec::new();
        run(&plan, "Which session is waiting on me? Answer with its name only, written as [[session:name]].",
            |e| events.push(e)).expect("run");
        let kinds: Vec<&str> = events.iter().filter_map(|e| e["kind"].as_str()).collect();
        eprintln!("events: {kinds:?}");
        assert!(events.iter().any(|e| e["kind"] == "step" && e["target"].as_str().unwrap_or("").ends_with("dashboard.md")),
            "he read the dashboard: {events:?}");
        let text: String = events.iter().filter(|e| e["kind"] == "text").filter_map(|e| e["text"].as_str()).collect();
        assert!(text.contains("[[session:probe-waiting-session]]"), "answer: {text}");
        assert!(events.iter().any(|e| e["kind"] == "done" && e["is_error"] == false));
    }

    #[test]
    fn events_serialise_with_a_kind_tag() {
        let v = serde_json::to_value(Event::Step { tool: "Read".into(), target: "/n".into() }).unwrap();
        assert_eq!(v, serde_json::json!({ "kind": "step", "tool": "Read", "target": "/n" }));
    }
}
