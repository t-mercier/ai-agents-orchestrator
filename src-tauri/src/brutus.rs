//! Brutus's runner: one headless Claude Code run per message, sandboxed by flags, its
//! stream-json relayed to the renderer as `brutus-event`s. See the spec's "sandbox"
//! section for why each flag is there; every one was verified by a probe.

use serde::Serialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Emitter;

use crate::{brutus_agent, brutus_home, config, pty};

const MAX_MESSAGE: usize = 8000;
const TIMEOUT: Duration = Duration::from_secs(180);
const RECENT_CLOSED_DAYS: i64 = 14;

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

/// The file the message is written to before each run, in his folder.
const MESSAGE_FILE: &str = "message.txt";

/// Through a login shell, as every headless run in this app: launched from Finder, the
/// app's PATH has no `claude`. Every argument is quoted. The message is not on this line,
/// and not on the shell's stdin either: an rc file that reads stdin would swallow it. It
/// is redirected from a file into claude alone.
pub(crate) fn shell_line(p: &Plan) -> String {
    let args: Vec<String> = claude_args(p).iter().map(|a| pty::shell_quote(a)).collect();
    let msg = format!("{}/{MESSAGE_FILE}", p.dir);
    format!("cd {} && exec env AO_HEADLESS=1 claude {} < {}", pty::shell_quote(&p.dir), args.join(" "), pty::shell_quote(&msg))
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
        Some("result") => {
            // error_max_turns and its kind carry no `result`, only `errors[]`.
            let mut result = s(&v, "result");
            if result.is_empty() {
                result = v.get("errors").and_then(Value::as_array).into_iter().flatten()
                    .filter_map(Value::as_str).collect::<Vec<_>>().join("\n");
            }
            vec![Event::Done { is_error: v.get("is_error").and_then(Value::as_bool).unwrap_or(false), result }]
        }
        _ => Vec::new(),
    }
}

/// The result claude prints when `--resume` names a conversation it no longer has — it
/// prunes old transcripts, so a conversation left untouched for weeks ends up there.
/// Nothing else ends a run this way: no init, no turn, just this line.
pub(crate) fn missing_conversation(line: &str) -> bool {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return false };
    v.get("type").and_then(Value::as_str) == Some("result")
        && v.get("errors").and_then(Value::as_array).is_some_and(|e| {
            e.iter().filter_map(Value::as_str).any(|m| m.starts_with("No conversation found"))
        })
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
/// The running child, tagged with its run number: a watcher or a Stop acts on a run only
/// if the slot still holds that run.
static CHILD: Mutex<Option<(u64, Child)>> = Mutex::new(None);
static RUN: AtomicU64 = AtomicU64::new(0);
/// Set by brutus_cancel and cleared only when the next run takes BUSY. A run checks it
/// before spawning and right after, so a Stop pressed while he prepares, or between the
/// two runs of a retry, still stops him. Also makes a stopped run end on "Stopped.", not
/// on a SIGKILL reported as a broken install.
static CANCELLED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, PartialEq)]
pub(crate) enum Watch { Wait, Kill, Exit }

/// What the ceiling watcher of run `mine` does, given the run now in the slot.
pub(crate) fn watch(mine: u64, current: Option<u64>, elapsed: Duration, ceiling: Duration) -> Watch {
    match current {
        Some(c) if c == mine && elapsed > ceiling => Watch::Kill,
        Some(c) if c == mine => Watch::Wait,
        _ => Watch::Exit,
    }
}

/// The line shown when a run ended without a result.
pub(crate) fn end_message(cancelled: bool, timed_out: bool, status: Option<std::process::ExitStatus>) -> String {
    if cancelled {
        return "Stopped.".to_string();
    }
    if timed_out {
        return "Brutus took longer than 3 minutes and was stopped.".to_string();
    }
    match status {
        Some(s) if s.success() => "Brutus stopped without answering.".to_string(),
        Some(s) => format!("claude exited with {s}. Is Claude Code installed and logged in?"),
        None => "Stopped.".to_string(),
    }
}

/// One run at a time. Held for the length of a run; released on drop, panics included.
pub(crate) struct Busy;
impl Busy {
    pub(crate) fn acquire() -> Result<Busy, String> {
        BUSY.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map(|_| {
                CANCELLED.store(false, Ordering::SeqCst);
                Busy
            })
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
fn write_conversation_at(path: &std::path::Path, id: &str) -> std::io::Result<()> {
    std::fs::write(path, json!({ "sessionId": id }).to_string())
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

/// Days since 1970-01-01 of a civil date, and back (Howard Hinnant's algorithms).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468
}
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// `YYYY-MM-DD` minus `n` days.
pub(crate) fn days_before(ymd: &str, n: i64) -> Option<String> {
    let mut it = ymd.splitn(3, '-').map(|p| p.parse::<i64>().ok());
    let (y, m, d) = (it.next()??, it.next()??, it.next()??);
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let (y, m, d) = civil_from_days(days_from_civil(y, m, d) - n);
    Some(format!("{y:04}-{m:02}-{d:02}"))
}

/// The oldest close date the dashboard lists: from the local date when there is one,
/// else from the system clock in UTC. Never a date that lets every closed session in.
fn cutoff_date(today: Option<&str>) -> String {
    if let Some(c) = today.and_then(|t| days_before(t, RECENT_CLOSED_DAYS)) {
        return c;
    }
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400) - RECENT_CLOSED_DAYS);
    format!("{y:04}-{m:02}-{d:02}")
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
        &knowledge, &cutoff_date(Some(today.as_str()).filter(|t| !t.is_empty())), &format!("{today} {time}"));
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

/// One run: the message fed to claude from a file, each stream event handed to `on_event` as it arrives,
/// and an `error` event when the stream ends without a result. Returns true, having
/// emitted nothing for it, when the conversation it resumed no longer exists.
pub(crate) fn run(plan: &Plan, message: &str, on_event: impl FnMut(Value)) -> Result<bool, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    run_in(&shell, plan, message, on_event)
}

fn run_in(shell: &str, plan: &Plan, message: &str, mut on_event: impl FnMut(Value)) -> Result<bool, String> {
    if CANCELLED.load(Ordering::SeqCst) {
        on_event(json!({ "kind": "error", "message": end_message(true, false, None) }));
        return Ok(false);
    }
    let msg_path = std::path::Path::new(&plan.dir).join(MESSAGE_FILE);
    std::fs::write(&msg_path, message).map_err(|e| format!("could not write the message: {e}"))?;
    let mut child = Command::new(shell)
        .args(["-ilc", &shell_line(plan)])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not start claude: {e}"))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let run_id = RUN.fetch_add(1, Ordering::SeqCst) + 1;
    {
        // A Stop that landed between the check above and this point found no child.
        let mut guard = CHILD.lock().unwrap();
        if CANCELLED.load(Ordering::SeqCst) {
            let _ = child.kill();
        }
        *guard = Some((run_id, child));
    }

    // The ceiling: this run's watcher kills this run if it outlives it, and nothing else.
    let started = Instant::now();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));
        let mut guard = CHILD.lock().unwrap();
        match watch(run_id, guard.as_ref().map(|(id, _)| *id), started.elapsed(), TIMEOUT) {
            Watch::Wait => {}
            Watch::Exit => return,
            Watch::Kill => {
                if let Some((_, c)) = guard.as_mut() {
                    let _ = c.kill();
                }
                return;
            }
        }
    });

    let (mut done, mut missing) = (false, false);
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if missing_conversation(&line) {
            missing = true;
            continue;
        }
        for ev in parse_line(&line) {
            if let Event::Init { session_id } = &ev {
                if crate::is_valid_session_id(session_id) {
                    // Not fatal to this answer, but the next message will start a new
                    // conversation: say so in the log rather than nowhere.
                    if let Err(e) = write_conversation_at(&conversation_path(), session_id) {
                        log::warn!("brutus: could not save the conversation id: {e}");
                    }
                }
            }
            if matches!(ev, Event::Done { .. }) {
                done = true;
            }
            on_event(serde_json::to_value(&ev).unwrap_or(Value::Null));
        }
    }
    // Out of the slot first, then wait — waiting under the lock would block a Stop.
    let taken = {
        let mut guard = CHILD.lock().unwrap();
        match guard.as_ref() {
            Some((id, _)) if *id == run_id => guard.take().map(|(_, c)| c),
            _ => None,
        }
    };
    let status = taken.and_then(|mut c| c.wait().ok());
    let _ = std::fs::remove_file(&msg_path);
    if missing {
        return Ok(true);
    }
    if !done {
        let why = end_message(CANCELLED.load(Ordering::SeqCst), started.elapsed() > TIMEOUT, status);
        on_event(json!({ "kind": "error", "message": why }));
    }
    Ok(false)
}

/// Asks, and when the resumed conversation is gone, forgets it and asks once more in a
/// new one. Without this, every question after the pruning failed the same way until
/// the conversation was reset by hand.
pub(crate) fn ask(
    mut plan: Plan,
    mut run_once: impl FnMut(&Plan) -> Result<bool, String>,
    forget: impl FnOnce(),
) -> Result<(), String> {
    if run_once(&plan)? && plan.resume.is_some() {
        forget();
        plan.resume = None;
        run_once(&plan)?;
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
    ask(plan, |p| run(p, &message, |ev| emit(&app, &ev)), || {
        let _ = std::fs::remove_file(conversation_path());
    })
}

/// True when a run is in flight, whether or not claude has started yet.
#[tauri::command]
pub fn brutus_cancel() -> bool {
    let mut guard = CHILD.lock().unwrap();
    CANCELLED.store(true, Ordering::SeqCst);
    if let Some((_, c)) = guard.as_mut() {
        let _ = c.kill();
    }
    BUSY.load(Ordering::SeqCst)
}

/// A new conversation. His memory is untouched.
#[tauri::command]
pub fn brutus_reset() -> Result<(), String> {
    match std::fs::remove_file(conversation_path()) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// No file yet is nothing remembered; a file that cannot be read is unknown (null), not 0.
fn memory_count_value(read: std::io::Result<String>) -> Value {
    match read {
        Ok(text) => json!(brutus_home::memory_count(&text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!(0),
        Err(_) => Value::Null,
    }
}

#[tauri::command]
pub fn brutus_status() -> Value {
    json!({
        "memoryCount": memory_count_value(std::fs::read_to_string(brutus_home::dir().join("memory.md"))),
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
        // exec: the process that Stop and the ceiling kill must be claude itself. zsh execs
        // the last command on its own; bash keeps itself as the parent, so killing the shell
        // left claude running, its pipe open, and the spinner turning.
        assert!(line.starts_with("cd '/cfg/brutus' && exec env AO_HEADLESS=1 claude '--restricted'"), "{line}");
        assert!(line.contains("'claude-opus-5-5[1m]'"), "brackets are a glob to the shell");
        assert!(line.ends_with(" < '/cfg/brutus/message.txt'"), "the message comes from a file, to claude only: {line}");
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

    // An error result can carry only `errors[]` (error_max_turns does): the panel then
    // showed "Something went wrong." instead of the reason.
    #[test]
    fn an_error_result_without_a_result_field_reports_its_errors() {
        assert_eq!(parse_line(r#"{"type":"result","subtype":"error_max_turns","is_error":true,"errors":["Reached maximum number of turns (8)","second"]}"#),
            vec![Event::Done { is_error: true, result: "Reached maximum number of turns (8)\nsecond".into() }]);
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

    /// BUSY and CANCELLED are process-wide: the tests that touch them take turns.
    static GLOBALS: Mutex<()> = Mutex::new(());

    #[test]
    fn a_second_run_is_refused_while_one_is_in_flight() {
        let _g = GLOBALS.lock().unwrap_or_else(|e| e.into_inner());
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

    /// The same path with a conversation claude no longer has: the question still gets an
    /// answer, from a new conversation. `cargo test --lib -- --ignored real_run`
    #[test]
    #[ignore = "runs the real claude"]
    fn real_run_recovers_from_a_lost_conversation() {
        let mut plan = prepare(Vec::new(), false).expect("prepare");
        plan.resume = Some("1b0c8e0e-2f4a-4c55-9a1e-3d2f5e6a7b8c".into());
        let mut events: Vec<serde_json::Value> = Vec::new();
        let mut forgot = false;
        ask(plan, |p| run(p, "Reply with the single word: pong", |e| events.push(e)), || forgot = true).expect("ask");
        assert!(forgot, "the lost conversation is forgotten");
        assert!(!events.iter().any(|e| e["kind"] == "error"), "no error reaches the panel: {events:?}");
        assert!(events.iter().any(|e| e["kind"] == "done" && e["is_error"] == false), "{events:?}");
    }

    // Shipped: Stop killed claude with SIGKILL, which fell into the "exited with a status"
    // arm and blamed the install: "Is Claude Code installed and logged in?".
    #[test]
    fn the_end_message_names_the_real_reason() {
        use std::os::unix::process::ExitStatusExt;
        let killed = std::process::ExitStatus::from_raw(9);
        let failed = std::process::ExitStatus::from_raw(1 << 8);
        let ok = std::process::ExitStatus::from_raw(0);
        assert_eq!(end_message(true, false, Some(killed)), "Stopped.");
        assert!(end_message(false, true, Some(killed)).contains("3 minutes"));
        assert!(end_message(false, false, Some(failed)).contains("logged in"));
        assert!(end_message(false, false, Some(ok)).contains("without answering"));
    }

    // Shipped: a watcher left from run N could see run N+1's child in the shared slot and
    // kill it on N's clock. A watcher now acts only on the run it was started for.
    #[test]
    fn a_watcher_acts_only_on_its_own_run() {
        let t = Duration::from_secs(180);
        assert_eq!(watch(7, Some(8), Duration::from_secs(500), t), Watch::Exit, "another run's child: leave it");
        assert_eq!(watch(7, None, Duration::from_secs(500), t), Watch::Exit, "run over");
        assert_eq!(watch(7, Some(7), Duration::from_secs(10), t), Watch::Wait);
        assert_eq!(watch(7, Some(7), Duration::from_secs(181), t), Watch::Kill);
    }

    // Shipped: when neither date form worked, the cutoff fell back to "0000-00-00" and the
    // dashboard listed every closed session ever.
    #[test]
    fn the_cutoff_is_computed_in_rust_across_months_years_and_leap_days() {
        assert_eq!(days_before("2026-09-24", 14).as_deref(), Some("2026-09-10"));
        assert_eq!(days_before("2024-03-01", 14).as_deref(), Some("2024-02-16"));
        assert_eq!(days_before("2024-03-01", 1).as_deref(), Some("2024-02-29"));
        assert_eq!(days_before("2026-01-05", 14).as_deref(), Some("2025-12-22"));
        assert_eq!(days_before("not a date", 14), None);
        let c = cutoff_date(None);
        assert!(c.len() == 10 && c.as_str() > "2020-01-01", "from the clock: {c}");
    }

    // Shipped: an unreadable memory file showed "0 memories", and a failed conversation
    // write was dropped in silence, so the next message started a new conversation.
    #[test]
    fn an_unreadable_memory_file_is_not_zero_memories() {
        use std::io::{Error, ErrorKind};
        assert_eq!(memory_count_value(Ok("- a\n- b\n".into())), json!(2));
        assert_eq!(memory_count_value(Err(Error::from(ErrorKind::NotFound))), json!(0), "no file yet: nothing remembered");
        assert_eq!(memory_count_value(Err(Error::from(ErrorKind::PermissionDenied))), Value::Null);
    }

    #[test]
    fn a_failed_conversation_write_is_reported() {
        assert!(write_conversation_at(std::path::Path::new("/nonexistent-ao-dir/conversation.json"), "abc").is_err());
    }

    // Shipped: the message went on the stdin of `$SHELL -ilc`, so an rc file that reads
    // stdin swallowed it and claude got an empty question. The rc here does exactly that,
    // and a stand-in claude answers with whatever it received on stdin.
    #[test]
    fn a_shell_rc_that_reads_stdin_cannot_swallow_the_message() {
        let _g = GLOBALS.lock().unwrap_or_else(|e| e.into_inner());
        use std::os::unix::fs::PermissionsExt;
        let Some(zsh) = ["/bin/zsh", "/usr/bin/zsh"].into_iter().find(|z| std::path::Path::new(z).exists()) else { return };
        let t = std::env::temp_dir().join(format!("ao-brutus-rc-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&t);
        for d in ["bin", "zd", "brutus"] {
            std::fs::create_dir_all(t.join(d)).unwrap();
        }
        let t = std::fs::canonicalize(&t).unwrap();
        let script = |path: std::path::PathBuf, body: String| {
            std::fs::write(&path, body).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        };
        script(t.join("bin/claude"), "#!/bin/sh\nmsg=$(cat)\nprintf '{\"type\":\"result\",\"is_error\":false,\"result\":\"%s\"}\\n' \"$msg\"\n".into());
        std::fs::write(t.join("zd/.zshrc"), format!("path=({}/bin $path)\nread -t 1 _swallow\n", t.display())).unwrap();
        script(t.join("shell"), format!("#!/bin/sh\nZDOTDIR={}/zd exec {zsh} \"$@\"\n", t.display()));
        let mut p = plan();
        p.dir = t.join("brutus").to_string_lossy().into_owned();
        let mut events: Vec<Value> = Vec::new();
        run_in(&t.join("shell").to_string_lossy(), &p, "hello brutus", |e| events.push(e)).expect("run");
        let _ = std::fs::remove_dir_all(&t);
        assert!(events.iter().any(|e| e["kind"] == "done" && e["result"] == "hello brutus"), "{events:?}");
    }

    // Shipped: Stop pressed while Brutus was still preparing (no child yet) or between
    // the two runs of a pruned-conversation retry did nothing, and the run went ahead.
    #[test]
    fn a_stop_requested_before_the_child_exists_ends_the_run_unstarted() {
        let _g = GLOBALS.lock().unwrap_or_else(|e| e.into_inner());
        let busy = Busy::acquire().expect("free");
        assert!(brutus_cancel(), "a Stop during a run is received even with no child yet");
        let mut events: Vec<Value> = Vec::new();
        // A shell that does not exist: if the run got as far as spawning, this is an Err.
        let r = run_in("/nonexistent/shell", &plan(), "hi", |e| events.push(e));
        assert_eq!(r, Ok(false));
        assert_eq!(events, vec![json!({ "kind": "error", "message": "Stopped." })]);
        drop(busy);
        let next = Busy::acquire().expect("free");
        assert!(!CANCELLED.load(Ordering::SeqCst), "the next run starts un-cancelled");
        drop(next);
    }

    #[test]
    fn events_serialise_with_a_kind_tag() {
        let v = serde_json::to_value(Event::Step { tool: "Read".into(), target: "/n".into() }).unwrap();
        assert_eq!(v, serde_json::json!({ "kind": "step", "tool": "Read", "target": "/n" }));
    }

    #[test]
    fn a_resume_of_a_conversation_claude_no_longer_has_is_recognised() {
        // Captured from claude 2026-09-23 with a random id: no init, exit 1, this line.
        let gone = r#"{"type":"result","subtype":"error_during_execution","is_error":true,"num_turns":0,"session_id":"1b0c8e0e-2f4a-4c55-9a1e-3d2f5e6a7b8c","errors":["No conversation found with session ID: 1b0c8e0e-2f4a-4c55-9a1e-3d2f5e6a7b8c"]}"#;
        assert!(missing_conversation(gone));
        assert!(!missing_conversation(r#"{"type":"result","is_error":true,"result":"Not logged in"}"#));
        assert!(!missing_conversation(r#"{"type":"system","subtype":"init","session_id":"a"}"#));
    }

    #[test]
    fn a_lost_conversation_is_forgotten_and_the_question_asked_once_afresh() {
        let mut seen: Vec<Option<String>> = Vec::new();
        let mut forgot = 0;
        ask(plan(), |p| { seen.push(p.resume.clone()); Ok(p.resume.is_some()) }, || forgot += 1).unwrap();
        assert_eq!(seen, vec![Some("6c985ef4-74a7-4bc7-bd29-c402e13526cb".into()), None]);
        assert_eq!(forgot, 1);

        // A fresh run is never retried, whatever it reports.
        let (mut runs, mut p) = (0, plan());
        p.resume = None;
        ask(p, |_| { runs += 1; Ok(true) }, || panic!("nothing to forget")).unwrap();
        assert_eq!(runs, 1);
    }
}
