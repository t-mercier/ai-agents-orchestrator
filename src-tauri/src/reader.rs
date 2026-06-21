//! Read-only projection of ~/.claude (port of data/reader.js).
//! Running sessions (sessions/*.json + active-sessions.json) + historical
//! sessions (notes.md scan). Transcript-derived fields come with the terminal pass.
use crate::config::home;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime};

// Transcript fold cache, keyed by sessionId and validated by the file's (len, mtime).
// The poll re-reads transcripts every 5s; for idle/historical sessions the file is
// unchanged so this returns the cached fold (and skips the projects-dir scan too).
// A running session appends, so its (len/mtime) changes and it re-reads — but those
// are few vs the many static historical transcripts that dominated the cost.
type TranscriptEntry = (PathBuf, u64, Option<SystemTime>, Transcript);
static TRANSCRIPT_CACHE: LazyLock<Mutex<HashMap<String, TranscriptEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// git_info spawns 2-3 `git` subprocesses per cwd; cache the result per cwd with a
// short TTL so a 5s poll doesn't re-fork for every session every time. Branch/worktree
// staleness up to the TTL is fine for a dashboard.
// cwd → (cached-at, branch, worktree); entries expire after GIT_TTL.
type GitEntry = (Instant, Value, Value);
static GIT_CACHE: LazyLock<Mutex<HashMap<String, GitEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
const GIT_TTL: Duration = Duration::from_secs(15);

/// Mirror of isProcessAlive: alive if kill(pid,0) succeeds, or EPERM (exists but
/// we can't signal it).
fn alive(pid: i64) -> bool {
    if pid <= 0 {
        return false;
    }
    unsafe {
        if libc::kill(pid as libc::pid_t, 0) == 0 {
            return true;
        }
        std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
}

/// Run a git command in `cwd`, returning trimmed stdout (None on error/empty).
fn run_git(cwd: &str, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// (branch, worktree-toplevel) for a session's cwd — cached per cwd with a short TTL.
fn git_info(cwd: &str) -> (Value, Value) {
    if cwd.is_empty() {
        return (Value::Null, Value::Null);
    }
    if let Some((t, b, w)) = GIT_CACHE.lock().unwrap().get(cwd) {
        if t.elapsed() < GIT_TTL {
            return (b.clone(), w.clone());
        }
    }
    let (b, w) = git_info_uncached(cwd);
    GIT_CACHE
        .lock()
        .unwrap()
        .insert(cwd.to_string(), (Instant::now(), b.clone(), w.clone()));
    (b, w)
}

/// (branch, worktree-toplevel) for a session's cwd — both null if it isn't a repo.
fn git_info_uncached(cwd: &str) -> (Value, Value) {
    let branch = run_git(cwd, &["symbolic-ref", "--short", "HEAD"])
        .or_else(|| run_git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"]));
    // Only surface "worktree" for a genuine LINKED worktree (`git worktree add`),
    // not the main clone. A session that merely worked inside a normal repo didn't
    // create a worktree, so it shouldn't show one. A linked worktree's per-worktree
    // git dir (`.git/worktrees/<id>`) differs from the shared common dir; in the
    // main working tree the two are identical.
    let git_dir = run_git(cwd, &["rev-parse", "--absolute-git-dir"]);
    let common_dir = run_git(cwd, &["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    let worktree = match (git_dir, common_dir) {
        (Some(g), Some(c)) if g != c => run_git(cwd, &["rev-parse", "--show-toplevel"]),
        _ => None,
    };
    (
        branch.map(Value::String).unwrap_or(Value::Null),
        worktree.map(Value::String).unwrap_or(Value::Null),
    )
}

/// Fields pulled from a session's transcript (jsonl). The transcript is the
/// source of truth for where a session actually works + its branch + last reply.
#[derive(Default, Clone)]
struct Transcript {
    git_branch: Option<String>,
    pr_link: Option<String>,
    // Every GitHub PR URL pasted into the conversation (with duplicates, so the
    // picker can break ties by frequency). REVIEW sessions get their PR link from
    // here when the frontmatter has none — you paste it to ask Claude to review.
    pr_urls: Vec<String>,
    last_activity: Option<String>,
    last_activity_at: Option<String>,
    // Last cwd seen — where the session was working most recently (used for the
    // live git branch/worktree on running sessions).
    cwd: Option<String>,
    // First cwd seen — the directory `claude` was launched from. Claude Code keys
    // `--resume` by this directory, so it's what a resume must cd into (a session
    // that cd'd into a subdir mid-run still resumes from its launch dir).
    launch_cwd: Option<String>,
    // Whether the transcript .jsonl was actually found+read. A closed/archived
    // session whose transcript was deleted/rotated CANNOT be `--resume`d (the
    // conversation no longer exists anywhere) — only `/restart`ed from notes.
    found: bool,
    // Last-modified time of the transcript file — used to detect a session that was
    // reopened (resumed) and worked on after its last /close (transcript touched on a
    // later day) → reclassify closed → stale.
    mtime: Option<SystemTime>,
}

/// All GitHub PR URLs in raw transcript text (with duplicates, so the picker can use
/// frequency). Scans for the `https://github.com/` needle + validates the `/pull/<n>`
/// shape — the user pastes the PR link when asking Claude to review it.
fn extract_pr_urls(text: &str) -> Vec<String> {
    const NEEDLE: &str = "https://github.com/";
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(rel) = text[from..].find(NEEDLE) {
        let start = from + rel;
        let tail = &text[start..];
        let end = tail
            .find(|c: char| {
                c.is_whitespace()
                    || matches!(c, '"' | '\'' | '\\' | '(' | ')' | '[' | ']' | '{' | '}' | '<' | '>' | '|' | '`')
            })
            .unwrap_or(tail.len());
        let url = tail[..end].trim_end_matches(['.', ',', ';', ':', '!']);
        if pull_number(url).is_some() {
            out.push(url.to_string());
        }
        from = start + NEEDLE.len();
    }
    out
}

/// The PR number of a `…/pull/<n>…` URL (leading digits after `/pull/`), if any.
fn pull_number(url: &str) -> Option<&str> {
    let after = url.split("/pull/").nth(1)?;
    let end = after.find(|c: char| !c.is_ascii_digit()).unwrap_or(after.len());
    (end > 0).then_some(&after[..end])
}

/// True if `n` appears as a standalone number in `name` ("(PR 35)" matches "35",
/// not "350").
fn name_has_number(name: &str, n: &str) -> bool {
    name.split(|c: char| !c.is_ascii_digit()).any(|tok| tok == n)
}

/// Pick a session's PR URL: prefer one whose number also appears in the name (so the
/// reviewed PR wins over others mentioned in the conversation), else most frequent.
fn pick_pr_url(urls: &[String], name: &str) -> Option<String> {
    for u in urls {
        if pull_number(u).is_some_and(|n| name_has_number(name, n)) {
            return Some(u.clone());
        }
    }
    let mut best: Option<(&String, usize)> = None;
    for u in urls {
        let c = urls.iter().filter(|x| x.as_str() == u.as_str()).count();
        if best.as_ref().is_none_or(|(_, bc)| c > *bc) {
            best = Some((u, c));
        }
    }
    best.map(|(u, _)| u.clone())
}

/// Read ~/.claude/projects/*/<sid>.jsonl (located by scanning project dirs, which
/// avoids the lossy cwd→folder encoding) and fold the events into the last seen
/// gitBranch / prLink / cwd and the last assistant text.
fn read_transcript(sid: &str) -> Transcript {
    // Cache hit: cached path still exists and its (len, mtime) is unchanged. This
    // also skips the projects-dir scan below.
    if let Some((path, len, mtime, tr)) = TRANSCRIPT_CACHE.lock().unwrap().get(sid) {
        if let Ok(meta) = fs::metadata(path) {
            if meta.len() == *len && meta.modified().ok() == *mtime {
                return tr.clone();
            }
        }
    }

    let mut t = Transcript::default();
    let projects = home().join(".claude").join("projects");
    let dirs = match fs::read_dir(&projects) {
        Ok(d) => d,
        Err(_) => return t,
    };
    let mut path = None;
    for d in dirs.flatten() {
        let p = d.path().join(format!("{sid}.jsonl"));
        if p.is_file() {
            path = Some(p);
            break;
        }
    }
    let path = match path {
        Some(p) => p,
        None => return t,
    };
    let content = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return t,
    };
    t.found = true;
    t.pr_urls = extract_pr_urls(&content);
    for line in content.lines() {
        if line.is_empty() {
            continue;
        }
        let ev: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(b) = ev.get("gitBranch").and_then(Value::as_str) {
            t.git_branch = Some(b.to_string());
        }
        if let Some(pr) = ev.get("prLink").and_then(Value::as_str) {
            t.pr_link = Some(pr.to_string());
        }
        if let Some(c) = ev.get("cwd").and_then(Value::as_str) {
            if t.launch_cwd.is_none() {
                t.launch_cwd = Some(c.to_string()); // first = launch dir (resume key)
            }
            t.cwd = Some(c.to_string()); // last = current work dir (git info)
        }
        if ev.get("type").and_then(Value::as_str) == Some("assistant") {
            let text = ev
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(Value::as_array)
                .and_then(|arr| {
                    arr.iter()
                        .filter(|c| c.get("type").and_then(Value::as_str) == Some("text"))
                        .find_map(|c| c.get("text").and_then(Value::as_str))
                });
            if let Some(txt) = text {
                t.last_activity = Some(txt.chars().take(200).collect());
                t.last_activity_at = ev.get("timestamp").and_then(Value::as_str).map(String::from);
            }
        }
    }

    // Cache the fold, keyed by the file's current (len, mtime).
    let meta = fs::metadata(&path).ok();
    let len = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let mtime = meta.and_then(|m| m.modified().ok());
    t.mtime = mtime;
    TRANSCRIPT_CACHE
        .lock()
        .unwrap()
        .insert(sid.to_string(), (path, len, mtime, t.clone()));
    t
}

/// The directory `claude` was launched from for a session — what `--resume` and
/// `/restart` must cd into (Claude Code keys resume by launch dir). Mirrors the
/// Electron resolveSessionCwd (which returned the transcript's first cwd).
pub fn resolve_session_cwd(sid: &str) -> Option<String> {
    if sid.is_empty() || !sid.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        return None;
    }
    read_transcript(sid).launch_cwd
}

/// Claude Code prepends machine context to the first user turn — skill bodies,
/// slash-command echoes, system reminders, CLAUDE.md dumps, tool results. None of
/// those make a useful session title, so skip them and take the first genuine prompt.
fn is_title_noise(s: &str) -> bool {
    let t = s.trim_start();
    t.is_empty()
        || t.starts_with('<') // <command-name> / <system-reminder> / <local-command-stdout> …
        || t.starts_with("Caveat:")
        || t.starts_with("Base directory for this skill")
        || t.starts_with("Contents of ")
        || t.to_lowercase().contains("system-reminder")
}

/// A transcript's de-facto title + launch dir, from its first lines — the first
/// genuine user prompt (skipping the injected noise above) and the first `cwd`.
/// Iterator-based + early-return so we don't load a huge .jsonl just for the header.
fn discover_meta_lines<I: Iterator<Item = String>>(lines: I) -> (Option<String>, Option<String>) {
    let mut title: Option<String> = None;
    let mut cwd: Option<String> = None;
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let ev: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if cwd.is_none() {
            if let Some(c) = ev.get("cwd").and_then(Value::as_str) {
                cwd = Some(c.to_string());
            }
        }
        if title.is_none() && ev.get("type").and_then(Value::as_str) == Some("user") {
            let content = ev.get("message").and_then(|m| m.get("content"));
            // A user turn can be a string or an array of blocks; the real prompt may
            // sit AFTER an injected block, so scan all text for the first non-noise one.
            let texts: Vec<&str> = match content {
                Some(Value::String(s)) => vec![s.as_str()],
                Some(Value::Array(arr)) => arr
                    .iter()
                    .filter(|c| c.get("type").and_then(Value::as_str) == Some("text"))
                    .filter_map(|c| c.get("text").and_then(Value::as_str))
                    .collect(),
                _ => Vec::new(),
            };
            if let Some(t) = texts.into_iter().map(str::trim).find(|t| !is_title_noise(t)) {
                title = Some(t.chars().take(100).collect());
            }
        }
        if title.is_some() && cwd.is_some() {
            break;
        }
    }
    (title, cwd)
}

fn discover_meta(path: &std::path::Path) -> (Option<String>, Option<String>) {
    use std::io::{BufRead, BufReader};
    match fs::File::open(path) {
        Ok(f) => discover_meta_lines(BufReader::new(f).lines().map_while(Result::ok)),
        Err(_) => (None, None),
    }
}

/// sessionIds the app already manages — registered in active-sessions.json OR carried
/// in a notes.md frontmatter under the configured roots (covers running/closed/archived).
/// Used to exclude already-managed transcripts from the import picker.
fn managed_session_ids() -> HashSet<String> {
    let claude = home().join(".claude");
    let mut ids = HashSet::new();
    if let Ok(s) = fs::read_to_string(claude.join("active-sessions.json")) {
        if let Ok(Value::Object(m)) = serde_json::from_str::<Value>(&s) {
            ids.extend(m.keys().cloned());
        }
    }
    let cfg = crate::config::load();
    if let Some(dirs) = cfg.get("scanDirs").and_then(Value::as_array) {
        for sd in dirs {
            let base = match sd.get("base").and_then(Value::as_str) {
                Some(b) => b,
                None => continue,
            };
            if let Ok(entries) = fs::read_dir(base) {
                for e in entries.flatten() {
                    if let Ok(c) = fs::read_to_string(e.path().join("notes.md")) {
                        if let Some(sid) = parse_frontmatter(&c).get("session_id") {
                            ids.insert(sid.clone());
                        }
                    }
                }
            }
        }
    }
    ids
}

/// The most-recent *unmanaged* Claude Code transcripts (`~/.claude/projects/**/<id>.jsonl`
/// with no managing notes.md) — fuel for the "Import a session" picker. Capped to the
/// 30 newest by mtime (the picker is for recent work; older ones aren't the use case).
#[tauri::command(async)]
pub fn discover_sessions() -> Vec<Value> {
    let projects = home().join(".claude").join("projects");
    let managed = managed_session_ids();
    let mut rows: Vec<(u64, Value)> = Vec::new();
    let dirs = match fs::read_dir(&projects) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    for d in dirs.flatten() {
        let pdir = d.path();
        if !pdir.is_dir() {
            continue;
        }
        let files = match fs::read_dir(&pdir) {
            Ok(f) => f,
            Err(_) => continue,
        };
        for f in files.flatten() {
            let path = f.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let sid = match path.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            if managed.contains(&sid) {
                continue;
            }
            let mtime = fs::metadata(&path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|m| m.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let (title, cwd) = discover_meta(&path);
            rows.push((
                mtime,
                json!({ "sessionId": sid, "title": title, "cwd": cwd, "mtime": mtime }),
            ));
        }
    }
    rows.sort_by_key(|(mtime, _)| std::cmp::Reverse(*mtime)); // newest first
    rows.into_iter().take(30).map(|(_, v)| v).collect()
}

/// Extract a markdown section body: text between "## <heading>\n" and the next "## ".
fn extract_section(content: &str, heading: &str) -> Option<String> {
    let marker = format!("## {heading}\n");
    let start = content.find(&marker)? + marker.len();
    let rest = &content[start..];
    let end = rest.find("\n## ").unwrap_or(rest.len());
    let body = rest[..end].trim();
    if body.is_empty() {
        None
    } else {
        Some(body.to_string())
    }
}

// (goal, next_steps, pr_link) read from a running session's notes.md. pr_link comes
// from the frontmatter — the durable source — and the caller prefers it over the
// (vestigial) transcript prLink.
fn read_notes_meta(notes_path: &str) -> (Value, Value, Value) {
    match fs::read_to_string(notes_path) {
        Ok(c) => {
            let pr_link = parse_frontmatter(&c)
                .get("pr_link")
                .filter(|s| !s.is_empty())
                .map(|s| Value::String(s.clone()))
                .unwrap_or(Value::Null);
            (
                extract_section(&c, "Goal").map(Value::String).unwrap_or(Value::Null),
                extract_section(&c, "Next steps").map(Value::String).unwrap_or(Value::Null),
                pr_link,
            )
        }
        Err(_) => (Value::Null, Value::Null, Value::Null),
    }
}

/// (running sids, their notes_paths) — a CHEAP scan for the historical-tab exclusion:
/// reads sessions/*.json (sid + non-bg + alive pid) and active-sessions.json only,
/// with NO transcript reads or git spawns (unlike get_sessions, which this replaces
/// inside get_historical_sessions).
fn running_session_ids() -> (HashSet<String>, HashSet<String>) {
    let claude = home().join(".claude");
    let active: Value = fs::read_to_string(claude.join("active-sessions.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}));
    let mut ids = HashSet::new();
    let mut notes = HashSet::new();
    let entries = match fs::read_dir(claude.join("sessions")) {
        Ok(e) => e,
        Err(_) => return (ids, notes),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let data: Value = match fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
        {
            Some(d) => d,
            None => continue,
        };
        if data.get("kind").and_then(Value::as_str) == Some("bg") {
            continue;
        }
        if !alive(data.get("pid").and_then(Value::as_i64).unwrap_or(0)) {
            continue;
        }
        if let Some(sid) = data.get("sessionId").and_then(Value::as_str) {
            if let Some(np) = active.get(sid).and_then(|m| m.get("notes_path")).and_then(Value::as_str) {
                notes.insert(np.to_string());
            }
            ids.insert(sid.to_string());
        }
    }
    (ids, notes)
}

#[tauri::command(async)]
pub fn get_sessions() -> Vec<Value> {
    let claude = home().join(".claude");
    let active: Value = fs::read_to_string(claude.join("active-sessions.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}));

    let mut out = Vec::new();
    let entries = match fs::read_dir(claude.join("sessions")) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let data: Value = match fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
        {
            Some(d) => d,
            None => continue,
        };
        let sid = match data.get("sessionId").and_then(Value::as_str) {
            Some(s) => s.to_string(),
            None => continue,
        };
        // Skip Claude Code background jobs (kind:"bg") and dead processes.
        if data.get("kind").and_then(Value::as_str) == Some("bg") {
            continue;
        }
        let pid = data.get("pid").and_then(Value::as_i64).unwrap_or(0);
        if !alive(pid) {
            continue;
        }

        let entry_meta = active.get(&sid).cloned().unwrap_or_else(|| json!({}));
        let notes_path = entry_meta.get("notes_path").and_then(Value::as_str).map(String::from);
        let (goal, next_steps, pr_link_fm) = match &notes_path {
            Some(p) => read_notes_meta(p),
            None => (Value::Null, Value::Null, Value::Null),
        };
        let launch_cwd = data.get("cwd").and_then(Value::as_str).unwrap_or("");
        // The transcript records where the session actually works (it cd's into a
        // repo/worktree); the launch cwd is just where `claude` started. Use the
        // transcript's latest cwd for the live git worktree + branch, and pull the
        // last activity / PR link from it too.
        let tr = read_transcript(&sid);
        let work_cwd = tr.cwd.clone().unwrap_or_else(|| launch_cwd.to_string());
        let (branch_git, worktree) = git_info(&work_cwd);
        let git_branch = if branch_git.is_null() {
            tr.git_branch.map(Value::String).unwrap_or(Value::Null)
        } else {
            branch_git
        };

        // PR link: explicit frontmatter wins; else (REVIEW only) the PR URL pasted
        // into the transcript, disambiguated by the number in the session name.
        let category = entry_meta.get("category").and_then(Value::as_str).unwrap_or("");
        let name_str = data.get("name").and_then(Value::as_str).unwrap_or("");
        let pr_link = if !pr_link_fm.is_null() {
            pr_link_fm
        } else if category == "REVIEW" {
            pick_pr_url(&tr.pr_urls, name_str).map(Value::String).unwrap_or(Value::Null)
        } else {
            Value::Null
        };

        out.push(json!({
            "sessionId": sid,
            "name": data.get("name").and_then(Value::as_str).unwrap_or(""),
            "cwd": launch_cwd,
            "pid": pid,
            "status": data.get("status").and_then(Value::as_str).unwrap_or("idle"),
            "state": "active",   // lifecycle state: live pid (vs stale/closed/archived)
            "updatedAt": data.get("updatedAt").cloned().unwrap_or(Value::Null),
            "notesPath": notes_path,
            "category": entry_meta.get("category").cloned().unwrap_or(Value::Null),
            "ticket": entry_meta.get("ticket").cloned().unwrap_or(Value::Null),
            "goal": goal,
            "nextSteps": next_steps,
            "gitBranch": git_branch,
            "worktree": worktree,
            "lastActivity": tr.last_activity.map(Value::String).unwrap_or(Value::Null),
            "lastActivityAt": tr.last_activity_at.map(Value::String).unwrap_or(Value::Null),
            "prLink": pr_link,
        }));
    }
    out
}

/// Parse the leading `---\n…\n---` YAML-ish frontmatter into key→value pairs
/// (stripping surrounding quotes; empty values are dropped = treated as absent).
fn parse_frontmatter(content: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    if let Some(stripped) = content.strip_prefix("---\n") {
        if let Some(end) = stripped.find("\n---") {
            for line in stripped[..end].lines() {
                if let Some(idx) = line.find(':') {
                    let key = line[..idx].trim();
                    let val = line[idx + 1..]
                        .trim()
                        .trim_matches(|c| c == '"' || c == '\'' || c == '\\')
                        .trim();
                    if !key.is_empty() && !val.is_empty() {
                        out.insert(key.to_string(), val.to_string());
                    }
                }
            }
        }
    }
    out
}

/// Days since the Unix epoch for a proleptic-Gregorian Y/M/D (Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// Parse a leading `YYYY-MM-DD` into days-since-epoch.
fn date_to_days(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let y: i64 = s.get(0..4)?.parse().ok()?;
    let m: i64 = s.get(5..7)?.parse().ok()?;
    let d: i64 = s.get(8..10)?.parse().ok()?;
    Some(days_from_civil(y, m, d))
}

/// True when the transcript was modified on a LATER calendar day than the session's
/// last `/close` — i.e. the session was reopened (resumed) and worked on without a
/// fresh `/close`. Day granularity sidesteps timezone/time parsing; strictly-later is
/// conservative (a genuinely-closed, untouched session never trips it).
fn reopened_after_close(tr: &Transcript, close_date: &str) -> bool {
    let close_days = match date_to_days(close_date) {
        Some(d) => d,
        None => return false,
    };
    let mtime_days = match tr.mtime.and_then(|m| m.duration_since(SystemTime::UNIX_EPOCH).ok()) {
        Some(d) => (d.as_secs() / 86400) as i64,
        None => return false,
    };
    mtime_days > close_days
}

/// First `YYYY-MM-DD` (optionally ` HH:MM`) found in a line.
fn lead_date(line: &str) -> Option<String> {
    let c: Vec<char> = line.chars().collect();
    let d = |i: usize| c.get(i).is_some_and(|ch| ch.is_ascii_digit());
    for i in 0..c.len() {
        if d(i) && d(i + 1) && d(i + 2) && d(i + 3) && c.get(i + 4) == Some(&'-')
            && d(i + 5) && d(i + 6) && c.get(i + 7) == Some(&'-') && d(i + 8) && d(i + 9)
        {
            if c.get(i + 10) == Some(&' ') && d(i + 11) && d(i + 12)
                && c.get(i + 13) == Some(&':') && d(i + 14) && d(i + 15)
            {
                return Some(c[i..i + 16].iter().collect());
            }
            return Some(c[i..i + 10].iter().collect());
        }
    }
    None
}

/// Work-lifecycle status from the `## Session history` section + the relevant date:
/// - `archived`: an ARCHIVED line.
/// - `closed`: wrapped up via `/close` — the LAST entry is a completed line (`/save`
///   marks its entries `(in progress)`, `/close` does not).
/// - `stale`: open work whose terminal is gone — last entry still `(in progress)`, or
///   the section is empty/absent (never saved/closed). These belong in the Running
///   tab, not Closed.
pub(crate) fn session_history_info(content: &str) -> (String, Option<String>) {
    let history = match extract_section(content, "Session history") {
        Some(h) => h,
        None => return ("stale".into(), None),
    };
    let lines: Vec<&str> = history.lines().filter(|l| l.trim_start().starts_with('-')).collect();
    if lines.is_empty() {
        return ("stale".into(), None);
    }
    if let Some(a) = lines.iter().find(|l| l.to_uppercase().contains("ARCHIVED")) {
        return ("archived".into(), lead_date(a));
    }
    // The NEWEST-dated entry decides the state — not the last physical line. A session
    // worked across several days can end up with history lines out of order (a later
    // edit inserting an earlier-dated entry); taking the last physical line then reads
    // a stale older date, which `reopened_after_close` mistakes for a post-close reopen
    // and wrongly flips closed→stale. Ties (same day) → the later physical line.
    let latest = lines[(0..lines.len())
        .max_by_key(|&i| (lead_date(lines[i]).as_deref().and_then(date_to_days), i))
        .unwrap()]; // lines is non-empty (checked above)
    if is_wrapped_up(latest) {
        ("closed".into(), lead_date(latest))
    } else {
        ("stale".into(), lead_date(latest))
    }
}

/// Does a `## Session history` line mark a wrap-up (`/close`)?
///
/// `/close` stamps a summary entry tagged `… | session=<id> | …` with NO in-progress
/// marker. `/save` writes the same shape but flagged `(in progress)` (still open), and
/// `/start` writes a bootstrap line without `session=` — both stay `stale`. Older
/// `/close` output used a `HH:MM → HH:MM` (or `?? → HH:MM`) time range instead of the
/// `session=` tag; still honoured for back-compat. (A `→` buried in a free-text summary
/// like "ADR 0028→0026" isn't preceded by HH:MM, so it doesn't false-positive.)
fn is_wrapped_up(line: &str) -> bool {
    // `/save` checkpoints are explicitly mid-session — never a close.
    if line.contains("(in progress)") {
        return false;
    }
    // Current `/close` format: a summary entry carrying `session=<id>`.
    if line.contains("session=") {
        return true;
    }
    // Legacy `/close` format: a leading "HH:MM → HH:MM" (or "?? → HH:MM") time range.
    let Some(pos) = line.find('→') else {
        return false;
    };
    let left = line[..pos].trim_end();
    if left.ends_with("??") {
        return true;
    }
    let b = left.as_bytes();
    b.len() >= 5
        && b[b.len() - 1].is_ascii_digit()
        && b[b.len() - 2].is_ascii_digit()
        && b[b.len() - 3] == b':'
        && b[b.len() - 4].is_ascii_digit()
        && b[b.len() - 5].is_ascii_digit()
}

fn fv(fm: &HashMap<String, String>, key: &str) -> Value {
    fm.get(key).map(|s| Value::String(s.clone())).unwrap_or(Value::Null)
}

/// One pass over every category dir → all historical (non-running) sessions, each
/// tagged with its `historyStatus` bucket. Callers filter (one status) or partition
/// (all three) — doing the scan ONCE is the win: boot's badge-seed and every board
/// poll need all three buckets at once (previously 3 separate full scans each time).
fn scan_historical() -> Vec<Value> {
    let cfg = crate::config::load();
    let scan_dirs = cfg.get("scanDirs").and_then(Value::as_array).cloned().unwrap_or_default();

    // Exclude sessions that are currently live (running tab owns them). Cheap scan —
    // no transcript/git work (was a full get_sessions() that duplicated the running poll).
    let (running_ids, active_notes) = running_session_ids();

    let mut out = Vec::new();
    for sd in &scan_dirs {
        let base = match sd.get("base").and_then(Value::as_str) {
            Some(b) => b,
            None => continue,
        };
        let category = sd.get("category").and_then(Value::as_str).unwrap_or("");
        let entries = match fs::read_dir(base) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let notes = dir.join("notes.md");
            let content = match fs::read_to_string(&notes) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let (mut hist_status, hist_date) = session_history_info(&content);
            let fm = parse_frontmatter(&content);
            let notes_path = notes.to_string_lossy().into_owned();
            let tr = fm.get("session_id").map(|sid| read_transcript(sid));
            // A "closed" session whose transcript was touched on a LATER day than its
            // last /close was reopened (resumed) + worked on without re-closing →
            // surface it as stale (open work) rather than closed. (Resume/restart don't
            // write the notes, so this transcript-mtime check is the only reliable
            // signal; genuinely-closed sessions, untouched since, stay closed.)
            if hist_status == "closed" {
                if let (Some(t), Some(date)) = (tr.as_ref(), hist_date.as_deref()) {
                    if reopened_after_close(t, date) {
                        hist_status = "stale".to_string();
                    }
                }
            }
            // Lifecycle bucket (closed | stale | archived) is carried on each session
            // as `historyStatus`; the caller filters/partitions. Exclude live sessions
            // (the Running tab owns them) regardless of bucket.
            if let Some(sid) = fm.get("session_id") {
                if running_ids.contains(sid) {
                    continue;
                }
            }
            if active_notes.contains(&notes_path) {
                continue;
            }

            let updated_at = fs::metadata(&notes)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| Value::from(d.as_millis() as f64))
                .unwrap_or(Value::Null);
            let name = fm.get("name").cloned().unwrap_or_else(|| {
                dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
            });
            let cat = fm.get("category").cloned().unwrap_or_else(|| category.to_string());

            // Resume is keyed by the dir `claude` was LAUNCHED from (not where it
            // later cd'd to) — use the transcript's first cwd. Fall back to the
            // category's scope root (the parent of <root>/<CAT>) so a work session
            // resumes from the configured work root, not the home directory.
            let scope_root = std::path::Path::new(base)
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            // Resumable only if the transcript still exists (else --resume can't
            // find the conversation — the UI should offer Restart instead).
            let resumable = tr.as_ref().map(|t| t.found).unwrap_or(false);
            // PR link: explicit frontmatter wins; else (REVIEW only) the PR URL pasted
            // into the transcript, disambiguated by the number in the session name.
            let pr_link = {
                let explicit = fv(&fm, "pr_link");
                if !explicit.is_null() {
                    explicit
                } else if cat == "REVIEW" {
                    tr.as_ref()
                        .and_then(|t| pick_pr_url(&t.pr_urls, name.as_str()))
                        .map(Value::String)
                        .unwrap_or(Value::Null)
                } else {
                    Value::Null
                }
            };
            let cwd = tr.and_then(|t| t.launch_cwd).unwrap_or(scope_root);

            out.push(json!({
                "notesPath": notes_path,
                "sessionId": fv(&fm, "session_id"),
                "cwd": cwd,
                "resumable": resumable,
                "category": cat,
                "ticket": fv(&fm, "ticket"),
                "name": name,
                "branch": fv(&fm, "branch"),
                "prLink": pr_link,
                "startedAt": fv(&fm, "started_at"),
                "updatedAt": updated_at,
                "state": hist_status.clone(),   // stale | closed | archived
                "historyStatus": hist_status,
                "historyDate": hist_date,
                "goal": extract_section(&content, "Goal").map(Value::String).unwrap_or(Value::Null),
                "nextSteps": extract_section(&content, "Next steps").map(Value::String).unwrap_or(Value::Null),
            }));
        }
    }
    out
}

/// Sessions in a single lifecycle bucket (stale | closed | archived). One scan,
/// filtered — used when a single tab is visited.
#[tauri::command(async)]
pub fn get_historical_sessions(status: String) -> Vec<Value> {
    scan_historical()
        .into_iter()
        .filter(|s| s.get("historyStatus").and_then(Value::as_str) == Some(status.as_str()))
        .collect()
}

/// All three buckets from ONE scan: `{ stale, closed, archived }`. Used by the boot
/// badge-seed and the board index, which both need every bucket at once — replaces
/// three separate full directory scans with one.
#[tauri::command(async)]
pub fn get_historical_sessions_all() -> Value {
    bucket_by_status(scan_historical())
}

/// Partition tagged historical sessions into `{ stale, closed, archived }`. Pure (no
/// I/O) → unit-tested. `stale` is the default bucket (open work, terminal gone).
fn bucket_by_status(all: Vec<Value>) -> Value {
    let (mut stale, mut closed, mut archived) = (Vec::new(), Vec::new(), Vec::new());
    for s in all {
        match s.get("historyStatus").and_then(Value::as_str) {
            Some("closed") => closed.push(s),
            Some("archived") => archived.push(s),
            _ => stale.push(s),
        }
    }
    json!({ "stale": stale, "closed": closed, "archived": archived })
}

#[cfg(test)]
mod tests {
    use super::{
        bucket_by_status, date_to_days, discover_meta_lines, extract_pr_urls, lead_date,
        parse_frontmatter, pick_pr_url, reopened_after_close, session_history_info, Transcript,
    };
    use serde_json::json;

    #[test]
    fn parse_frontmatter_strips_quotes_drops_empty_requires_closing() {
        let fm = "---\nname: \"My Session\"\ncategory: FEAT\nempty: \nticket: 'ABC-1'\n---\nbody";
        let m = parse_frontmatter(fm);
        assert_eq!(m.get("name").map(String::as_str), Some("My Session"));
        assert_eq!(m.get("category").map(String::as_str), Some("FEAT"));
        assert_eq!(m.get("ticket").map(String::as_str), Some("ABC-1"));
        assert!(!m.contains_key("empty")); // empty value → dropped (treated as absent)
        assert!(parse_frontmatter("---\nname: x\nno closing marker").is_empty()); // no closing ---
        assert!(parse_frontmatter("# just a heading\n").is_empty()); // no frontmatter
    }

    #[test]
    fn lead_date_finds_first_date_with_optional_time() {
        assert_eq!(lead_date("- 2026-06-10 14:43 | x").as_deref(), Some("2026-06-10 14:43"));
        assert_eq!(lead_date("- 2026-06-10 | x").as_deref(), Some("2026-06-10"));
        assert_eq!(lead_date("no date here"), None);
    }

    #[test]
    fn session_history_info_recognises_close_save_start_archive() {
        let status = |hist: &str| {
            let content = format!("## Goal\nx\n\n## Session history\n{hist}\n");
            session_history_info(&content).0
        };
        // /close — current format: `… | session=<id> | summary`, no (in progress)
        assert_eq!(
            status("- 2026-06-19 21:11 | session=abc | transcript=/p.jsonl | Merged the fix"),
            "closed"
        );
        // /save checkpoint — same shape but explicitly mid-session
        assert_eq!(
            status("- 2026-06-19 19:22 (in progress) | session=abc | transcript=/p.jsonl | Triaged"),
            "stale"
        );
        // /start bootstrap — no session= marker
        assert_eq!(status("- 2026-06-18 16:53 — session started (BUG | slug | TICKET)."), "stale");
        // legacy /close — leading "HH:MM → HH:MM" time range
        assert_eq!(status("- 2026-06-10 | 09:00 → 11:30 | wrapped up"), "closed");
        // a /save AFTER a close (reopened, last line in progress) → stale
        assert_eq!(
            status("- 2026-06-18 | session=abc | closed it\n- 2026-06-19 (in progress) | session=abc | back at it"),
            "stale"
        );
        // ARCHIVED marker wins regardless of position
        assert_eq!(status("- 2026-06-19 | session=abc | done\n- ARCHIVED 2026-06-20"), "archived");
        // no history section → stale
        assert_eq!(session_history_info("## Goal\nx\n").0, "stale");
    }

    #[test]
    fn session_history_info_uses_newest_dated_entry_not_last_physical_line() {
        // Out-of-order history: the close (06-20) sits ABOVE an older entry (06-18).
        // The state + date must come from the newest-dated line, else the stale 06-18
        // date trips reopened_after_close and the session wrongly reads as stale.
        let content = "## Session history\n\
            - 2026-06-20 00:03 | session=abc | Closed for the weekend\n\
            - 2026-06-18 16:01 | session=abc | earlier CI rerun note\n";
        let (status, date) = session_history_info(content);
        assert_eq!(status, "closed");
        assert_eq!(date.as_deref(), Some("2026-06-20 00:03"));
    }

    #[test]
    fn discover_meta_lines_takes_first_real_user_msg_and_first_cwd() {
        let lines = vec![
            r#"{"type":"user","cwd":"/Users/dev/proj","message":{"content":"<command-name>/foo</command-name>"}}"#.to_string(),
            r#"{"type":"assistant","cwd":"/Users/dev/proj","message":{"content":[{"type":"text","text":"working"}]}}"#.to_string(),
            r#"{"type":"user","cwd":"/Users/dev/elsewhere","message":{"content":"Fix the checkout bug"}}"#.to_string(),
        ];
        let (title, cwd) = discover_meta_lines(lines.into_iter());
        assert_eq!(title.as_deref(), Some("Fix the checkout bug")); // command echo skipped
        assert_eq!(cwd.as_deref(), Some("/Users/dev/proj")); // FIRST cwd (launch dir)
        // injected noise (skill body, system-reminder) is skipped; real prompt wins
        let noisy = vec![
            r#"{"type":"user","message":{"content":"Base directory for this skill is /x"}}"#.to_string(),
            r#"{"type":"user","message":{"content":"Generate the release notes"}}"#.to_string(),
        ];
        assert_eq!(discover_meta_lines(noisy.into_iter()).0.as_deref(), Some("Generate the release notes"));
        // array with an injected block THEN the real prompt → picks the real one
        let arr = vec![r#"{"type":"user","message":{"content":[{"type":"text","text":"<system-reminder>x</system-reminder>"},{"type":"text","text":"hello there"}]}}"#.to_string()];
        assert_eq!(discover_meta_lines(arr.into_iter()).0.as_deref(), Some("hello there"));
        // no real user message → no title
        let none = vec![r#"{"type":"assistant","message":{"content":[{"type":"text","text":"x"}]}}"#.to_string()];
        assert_eq!(discover_meta_lines(none.into_iter()).0, None);
    }

    #[test]
    fn reopened_after_close_is_strictly_a_later_day() {
        use std::time::{Duration, UNIX_EPOCH};
        let close = "2026-06-10";
        let day = date_to_days(close).unwrap() as u64;
        let with_mtime = |secs: u64| Transcript {
            mtime: Some(UNIX_EPOCH + Duration::from_secs(secs)),
            ..Default::default()
        };
        // same calendar day (a few hours later) → NOT reopened
        assert!(!reopened_after_close(&with_mtime(day * 86400 + 5 * 3600), close));
        // next day → reopened
        assert!(reopened_after_close(&with_mtime((day + 1) * 86400), close));
        // no transcript mtime → false
        assert!(!reopened_after_close(&Transcript::default(), close));
    }

    #[test]
    fn bucket_by_status_partitions_and_defaults_unknown_to_stale() {
        let all = vec![
            json!({ "name": "a", "historyStatus": "closed" }),
            json!({ "name": "b", "historyStatus": "archived" }),
            json!({ "name": "c", "historyStatus": "stale" }),
            json!({ "name": "d", "historyStatus": "closed" }),
            json!({ "name": "e" }), // no status → defaults to stale
        ];
        let out = bucket_by_status(all);
        assert_eq!(out["closed"].as_array().unwrap().len(), 2);
        assert_eq!(out["archived"].as_array().unwrap().len(), 1);
        assert_eq!(out["stale"].as_array().unwrap().len(), 2); // c + the untagged e
        // every input lands in exactly one bucket (no loss, no dupes)
        let total = ["stale", "closed", "archived"]
            .iter()
            .map(|k| out[*k].as_array().unwrap().len())
            .sum::<usize>();
        assert_eq!(total, 5);
    }

    #[test]
    fn date_to_days_is_monotonic_and_parses() {
        let d10 = date_to_days("2026-06-10 14:43").unwrap();
        let d18 = date_to_days("2026-06-18").unwrap();
        assert!(d18 > d10, "later date → more days");
        assert_eq!(date_to_days("2026-06-10"), date_to_days("2026-06-10 09:00"));
        assert!(date_to_days("nope").is_none());
        // 8 days apart
        assert_eq!(d18 - d10, 8);
    }

    fn state_of(notes: &str) -> String {
        session_history_info(notes).0
    }

    #[test]
    fn history_closed_when_last_entry_is_a_completed_line() {
        let n = "## Session history\n- 2026-06-10 09:00 → 09:40 | session=x | wrapped up\n";
        assert_eq!(state_of(n), "closed");
    }

    #[test]
    fn history_stale_when_last_entry_is_in_progress() {
        // /save leaves an "(in progress)" line; killing the terminal never closes it.
        let n = "## Session history\n- 2026-06-10 09:00 (in progress) | session=x | saved\n";
        assert_eq!(state_of(n), "stale");
    }

    #[test]
    fn history_stale_when_never_saved() {
        assert_eq!(state_of("## Session history\n"), "stale");
        assert_eq!(state_of("# Title\nno history section"), "stale");
    }

    #[test]
    fn history_archived_takes_precedence() {
        let n = "## Session history\n- 2026-06-10 09:00 → 09:40 | did stuff\n- 2026-06-11 | ARCHIVED | from dashboard\n";
        assert_eq!(state_of(n), "archived");
    }

    #[test]
    fn history_stale_when_last_entry_is_a_start_bootstrap_line() {
        // A /start bootstrap line is NOT a wrap-up (no HH:MM → time range).
        let n = "## Session history\n- 2026-06-11: /start — workspace bootstrapped, context imported.\n";
        assert_eq!(state_of(n), "stale");
    }

    #[test]
    fn history_stale_when_arrow_is_free_text_not_a_time_range() {
        // A "→" inside the summary must not be read as the /close time-range arrow.
        let n = "## Session history\n- 2026-06-11: note about ADR 0028→0026 migration\n";
        assert_eq!(state_of(n), "stale");
    }

    #[test]
    fn history_closed_with_unknown_start_time() {
        // /close fallback "?? → HH:MM" still counts as wrapped up.
        let n = "## Session history\n- 2026-06-11 ?? → 16:30 | session=x | wrapped up\n";
        assert_eq!(state_of(n), "closed");
    }

    #[test]
    fn history_closed_after_saves_then_close() {
        // Several /save (in progress) lines, then a final /close completed line → closed.
        let n = "## Session history\n- 2026-06-09 (in progress) | s1\n- 2026-06-10 (in progress) | s2\n- 2026-06-11 10:00 → 10:30 | wrapped up\n";
        assert_eq!(state_of(n), "closed");
    }

    #[test]
    fn extracts_pr_urls_and_ignores_non_pr_github_links() {
        let text = r#"please review https://github.com/o/r/pull/35 and also
            see https://github.com/o/r/issues/9 plus "https://github.com/a/b/pull/4966/files""#;
        let urls = extract_pr_urls(text);
        assert!(urls.contains(&"https://github.com/o/r/pull/35".to_string()));
        assert!(urls.contains(&"https://github.com/a/b/pull/4966/files".to_string()));
        assert!(!urls.iter().any(|u| u.contains("/issues/")));
    }

    #[test]
    fn pick_prefers_url_matching_the_name_number() {
        let urls = vec![
            "https://github.com/o/r/pull/4966".to_string(),
            "https://github.com/o/r/pull/35".to_string(),
            "https://github.com/o/r/pull/4966".to_string(),
        ];
        // Name says PR 35 → that wins even though 4966 is more frequent.
        assert_eq!(
            pick_pr_url(&urls, "review vespa-skill (PR 35)").as_deref(),
            Some("https://github.com/o/r/pull/35")
        );
    }

    #[test]
    fn pick_falls_back_to_most_frequent_without_name_hint() {
        let urls = vec![
            "https://github.com/o/r/pull/10".to_string(),
            "https://github.com/o/r/pull/20".to_string(),
            "https://github.com/o/r/pull/20".to_string(),
        ];
        assert_eq!(pick_pr_url(&urls, "no number here").as_deref(), Some("https://github.com/o/r/pull/20"));
        assert_eq!(pick_pr_url(&[], "x"), None);
    }

    #[test]
    fn name_number_match_is_standalone_not_substring() {
        let urls = vec!["https://github.com/o/r/pull/35".to_string()];
        // "350" must NOT match "35"; with no other candidate, falls back to frequency.
        assert_eq!(
            pick_pr_url(&urls, "ticket 350 something").as_deref(),
            Some("https://github.com/o/r/pull/35") // fallback (only candidate), not a name match
        );
    }
}
