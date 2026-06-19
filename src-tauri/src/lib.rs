mod config;
mod pty;
mod reader;

use tauri::Manager;

/// Open an http(s) URL in the system browser. The scheme check already prevents a
/// leading `-`; `--` terminates `open`'s option parsing (defense-in-depth).
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http(s) URLs are allowed".into());
    }
    std::process::Command::new("open")
        .arg("--")
        .arg(&url)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Reveal a path (e.g. a session folder) in Finder. Reject leading-dash paths
/// (argv flag smuggling), canonicalize to an absolute path, and pass `--` so a
/// crafted path can never be parsed as an `open` flag.
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    if path.starts_with('-') {
        return Err("invalid path".into());
    }
    let abs = std::path::PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    std::process::Command::new("open")
        .arg("--")
        .arg(&abs)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Run a shell command in a new iTerm2 tab. The command is delivered to osascript
/// as an `on run argv` argument — never interpolated into the AppleScript body —
/// so there is no AppleScript/shell injection (mirrors the Electron ADR-005 shape).
/// Callers must shell-quote any values interpolated into `cmd`.
fn run_in_iterm_tab(cmd: &str) -> Result<(), String> {
    std::process::Command::new("osascript")
        .args([
            "-e", "on run argv",
            "-e", "set cmd to item 1 of argv",
            "-e", "tell application \"iTerm2\"",
            "-e", "activate",
            "-e", "if (count of windows) = 0 then create window with default profile",
            "-e", "set newTab to (create tab with default profile in current window)",
            "-e", "tell current session of newTab to write text cmd",
            "-e", "end tell",
            "-e", "end run",
        ])
        .arg(cmd)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Run a shell command in a new Terminal.app window. Same `on run argv` shape as
/// the iTerm adapter — the command is an argv arg, never interpolated into the
/// AppleScript body, so no injection. Terminal.app is always present on macOS,
/// so this is the bulletproof fallback.
fn run_in_terminal_app(cmd: &str) -> Result<(), String> {
    std::process::Command::new("osascript")
        .args([
            "-e", "on run argv",
            "-e", "tell application \"Terminal\"",
            "-e", "activate",
            "-e", "do script (item 1 of argv)",
            "-e", "end tell",
            "-e", "end run",
        ])
        .arg(cmd)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Launch `cmd` in the user's chosen terminal. The selector comes from
/// config.terminalApp and is matched against a strict allowlist (the config JSON
/// is hand-editable, so it's never trusted as more than a selector). Blank or
/// unknown → default: iTerm if installed, else Terminal.app. The command itself
/// is unchanged — already validated + shell-quoted by the caller.
fn launch_in_terminal(cmd: &str) -> Result<(), String> {
    let sel = config::load()
        .get("terminalApp")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    match sel.as_str() {
        "iterm" => run_in_iterm_tab(cmd),
        "terminal" => run_in_terminal_app(cmd),
        // system default / unknown / blank
        _ if std::path::Path::new("/Applications/iTerm.app").exists() => run_in_iterm_tab(cmd),
        _ => run_in_terminal_app(cmd),
    }
}

/// The controlling tty of a pid (e.g. "/dev/ttys003"), via `ps`. None when the
/// process has no terminal tty — e.g. it runs in our embedded pty rather than a
/// real terminal window (so there's nothing to reveal).
fn session_tty(pid: i64) -> Option<String> {
    if pid <= 0 {
        return None;
    }
    let out = std::process::Command::new("ps")
        .args(["-o", "tty=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    let t = String::from_utf8_lossy(&out.stdout).trim().to_string();
    // ps prints "ttys003", or "??" / "" when there is no controlling terminal.
    if !t.starts_with("ttys") {
        return None;
    }
    Some(format!("/dev/{t}"))
}

/// Find the tab whose tty matches in `app_name` ("iTerm2" | "Terminal"); if
/// `select`, bring it to front. Returns true if found. `tty` is an argv arg (never
/// interpolated into the script body) → no injection. The `is running` guard keeps
/// a mere check from launching the terminal app.
fn reveal_in(app_name: &str, tty: &str, select: bool) -> bool {
    let script = if app_name == "iTerm2" {
        r#"on run argv
  set tgt to item 1 of argv
  set md to item 2 of argv
  if application "iTerm2" is running then
    tell application "iTerm2"
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if (tty of s) is tgt then
              if md is "select" then
                -- `tell s to select` alone selects the session WITHIN its tab but
                -- does NOT bring its window forward, so `activate` showed whatever
                -- window was current (wrong one). `select w` raises the right
                -- window; then select the tab + the (possibly split-pane) session.
                select w
                tell t to select
                tell s to select
                activate
              end if
              return "1"
            end if
          end repeat
        end repeat
      end repeat
    end tell
  end if
  return "0"
end run"#
    } else {
        r#"on run argv
  set tgt to item 1 of argv
  set md to item 2 of argv
  if application "Terminal" is running then
    tell application "Terminal"
      repeat with w in windows
        repeat with t in tabs of w
          if (tty of t) is tgt then
            if md is "select" then
              set selected of t to true
              set frontmost of w to true
              activate
            end if
            return "1"
          end if
        end repeat
      end repeat
    end tell
  end if
  return "0"
end run"#
    };
    let out = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .arg(tty)
        .arg(if select { "select" } else { "check" })
        .output();
    matches!(out, Ok(o) if String::from_utf8_lossy(&o.stdout).trim() == "1")
}

/// Look for the session's window wherever it might be — iTerm (if installed) then
/// Terminal.app — independent of the launch preference. `select` brings it forward.
fn scan_terminals(tty: &str, select: bool) -> bool {
    if std::path::Path::new("/Applications/iTerm.app").exists() && reveal_in("iTerm2", tty, select) {
        return true;
    }
    reveal_in("Terminal", tty, select)
}

/// Can we reveal an existing terminal window for this session? (Used to decide
/// whether to OFFER the "Reveal window" button.) Check-only: no focus change, and
/// the `is running` guard means it won't launch a terminal.
#[tauri::command(async)]
fn can_reveal_terminal(pid: i64) -> bool {
    match session_tty(pid) {
        Some(tty) => scan_terminals(&tty, false),
        None => false,
    }
}

/// Bring the session's existing terminal window/tab to the front (instead of
/// opening a second instance). Errors if it can't be found.
#[tauri::command(async)]
fn reveal_terminal(pid: i64) -> Result<(), String> {
    let tty = session_tty(pid).ok_or("session has no terminal tty")?;
    if scan_terminals(&tty, true) {
        Ok(())
    } else {
        Err("couldn't find that terminal window".into())
    }
}

/// Strict category token — the real injection boundary, since the config JSON is
/// hand-editable and bypasses config.validate(). Mirrors the Electron SAFE_CATEGORY.
fn is_safe_category(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 20
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Resume a session's full conversation in the user's terminal. sessionId is regex-
/// restricted; the cwd is POSIX single-quoted, and `claude --model 'opus[1m]'`
/// must stay quoted (the `[1m]` would otherwise be glob-expanded by the shell).
#[tauri::command]
fn open_in_terminal(cwd: String, session_id: String) -> Result<(), String> {
    if session_id.is_empty()
        || !session_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("invalid session id".into());
    }
    // Closed sessions may send an empty/relative cwd — only cd when it's absolute.
    let cmd = if std::path::Path::new(&cwd).is_absolute() {
        format!(
            "cd {} && claude --resume {} --model {}",
            pty::shell_quote(&cwd),
            session_id,
            pty::shell_quote(pty::CLAUDE_MODEL),
        )
    } else {
        format!(
            "claude --resume {} --model {}",
            session_id,
            pty::shell_quote(pty::CLAUDE_MODEL),
        )
    };
    launch_in_terminal(&cmd)
}

/// A git branch name safe to pass to `git checkout` and into a shell command.
/// Allowlist (no shell metachars survive shell_quote anyway, but this also blocks
/// git ref ambiguities): no leading dash (flag smuggling), no leading/trailing `/`,
/// no `..` or `@{` (revision/reflog syntax). Used with `git checkout <b> --` so a
/// branch can never be reinterpreted as a pathspec.
fn is_safe_branch(b: &str) -> bool {
    !b.is_empty()
        && b.len() <= 200
        && !b.starts_with('-')
        && !b.starts_with('/')
        && !b.ends_with('/')
        && !b.contains("..")
        && !b.contains("@{")
        && b.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'/' | b'-'))
}

/// Validate a repo path BEFORE spawning iTerm: absolute, no leading dash, exists,
/// is a directory, and is actually a git repo. Returns the canonical path. This is
/// the only feedback channel — once iTerm is spawned, a failed `cd`/`checkout` is
/// invisible to the form (the spawn already succeeded), so we pre-flight here.
fn validate_repo(repo: &str) -> Result<std::path::PathBuf, String> {
    if repo.starts_with('-') {
        return Err("invalid repo path".into());
    }
    let p = std::path::Path::new(repo);
    if !p.is_absolute() {
        return Err("repo must be an absolute path".into());
    }
    let abs = p.canonicalize().map_err(|_| "repo folder not found".to_string())?;
    if !abs.is_dir() {
        return Err("repo is not a directory".into());
    }
    let is_git = std::process::Command::new("git")
        .arg("-C")
        .arg(&abs)
        .args(["rev-parse", "--git-dir"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !is_git {
        return Err("that folder is not a git repository".into());
    }
    Ok(abs)
}

/// Launch a NEW session: open `claude` + the `/start` skill in a new iTerm tab.
/// Launches from a chosen repo (cd + checkout the branch so the session starts on
/// it) when given, else the category's scope root. The app writes nothing itself —
/// /start creates the workspace (ADR-001/ADR-012). Category must pass the strict
/// token regex AND exist in config. Repo/branch are pre-flight-validated so errors
/// surface in the form, not as a dead iTerm tab.
#[tauri::command]
fn start_session(
    category: String,
    name: String,
    ticket: String,
    repo: String,
    branch: String,
    pr_link: String,
) -> Result<(), String> {
    let cfg = config::load();
    let cats = cfg.get("categories").and_then(serde_json::Value::as_array);
    let cat_def = cats.and_then(|arr| {
        arr.iter().find(|c| c.get("name").and_then(serde_json::Value::as_str) == Some(&category))
    });
    let cat_def = match cat_def {
        Some(c) if is_safe_category(&category) => c,
        _ => return Err("invalid category".into()),
    };

    // Title (the session name): unicode letters/digits (French accents OK), spaces,
    // and a small punctuation set. Excludes backtick, $, ", \\ and newline — the
    // chars that break the downstream shell-quote / YAML frontmatter / iTerm title.
    // Whitespace is collapsed; capped at 120.
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .filter(|c| c.is_alphanumeric() || *c == ' ' || "-_.,'()".contains(*c))
        .collect();
    let safe_name: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let safe_name: String = safe_name.chars().take(120).collect::<String>().trim().to_string();
    if safe_name.is_empty() {
        return Err("title required".into());
    }

    // Ticket: accept a project-key form (ABC-123); uppercased, else dropped.
    let t = ticket.trim();
    let safe_ticket = if is_ticket(t) { t.to_uppercase() } else { String::new() };

    // Optional repo + branch: validate up front (see validate_repo). A branch with
    // no repo is meaningless (nothing to check it out in) — reject early.
    let repo = repo.trim();
    let branch = branch.trim();
    if !branch.is_empty() && repo.is_empty() {
        return Err("pick a repo to check the branch out in".into());
    }
    let repo_abs = if repo.is_empty() { None } else { Some(validate_repo(repo)?) };
    if !branch.is_empty() {
        if !is_safe_branch(branch) {
            return Err("invalid branch name".into());
        }
        // Confirm the branch resolves in this repo (local or remote-tracking ref).
        let abs = repo_abs.as_ref().unwrap();
        let exists = std::process::Command::new("git")
            .arg("-C")
            .arg(abs)
            .args(["rev-parse", "--verify", "--quiet"])
            .arg(branch)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !exists {
            return Err(format!("branch '{branch}' not found in that repo"));
        }
    }

    // Optional reviewed-PR link (REVIEW sessions). Validated up front; appended as a
    // `--pr <url>` token the /start skill recognises and writes to the frontmatter.
    let pr = pr_link.trim();
    if !pr.is_empty() && !is_pr_url(pr) {
        return Err("not a GitHub PR URL (https://github.com/owner/repo/pull/N)".into());
    }

    // /start parses: <CATEGORY> [<TICKET>] <name> [--pr <url>]
    let parts: Vec<&str> = [category.as_str(), safe_ticket.as_str(), safe_name.as_str()]
        .into_iter()
        .filter(|p| !p.is_empty())
        .collect();
    let mut prompt = format!("/start {}", parts.join(" "));
    if !pr.is_empty() {
        prompt.push_str(&format!(" --pr {pr}"));
    }
    let model = pty::CLAUDE_MODEL;

    // Launch dir: the repo (start ON the branch) when given, else the scope root.
    let cmd = if let Some(abs) = &repo_abs {
        let cd = pty::shell_quote(&abs.to_string_lossy());
        if branch.is_empty() {
            format!("cd {} && claude --model {} {}", cd, pty::shell_quote(model), pty::shell_quote(&prompt))
        } else {
            // `git checkout <branch> --` — the trailing `--` stops the branch from
            // being reinterpreted as a pathspec; `&&` so a failed checkout aborts
            // (visible in iTerm) rather than starting on the wrong branch.
            format!(
                "cd {} && git checkout {} -- && claude --model {} {}",
                cd,
                pty::shell_quote(branch),
                pty::shell_quote(model),
                pty::shell_quote(&prompt),
            )
        }
    } else {
        let scope = cat_def.get("scope").and_then(serde_json::Value::as_str).unwrap_or("work");
        let root_key = if scope == "personal" { "personalRoot" } else { "workRoot" };
        let home = cfg.get("home").and_then(serde_json::Value::as_str).unwrap_or("/");
        let launch_dir = cfg.get(root_key).and_then(serde_json::Value::as_str).unwrap_or(home);
        format!("cd {} && claude --model {} {}", pty::shell_quote(launch_dir), pty::shell_quote(model), pty::shell_quote(&prompt))
    };
    launch_in_terminal(&cmd)
}

/// Reopen a closed/archived session: launch `claude` + the `/restart` skill, which
/// reloads the session's notes into a fresh session and re-registers it as active
/// (un-archiving it). Launcher only — the app writes nothing (ADR-001/ADR-012).
/// Distinct from resume: `/restart` reloads the notes summary, not the raw transcript,
/// so it works for sessions with no recorded sessionId (e.g. "to fill").
#[tauri::command]
fn restore_session(slug: String, session_id: String) -> Result<(), String> {
    // Slug is a folder name (allows '.') — validate at the boundary before it
    // reaches the filesystem/prompt. sessionId, if present, must be a clean id.
    if slug.is_empty() || !slug.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-') {
        return Err("invalid slug".into());
    }
    if !session_id.is_empty()
        && !session_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("invalid sessionId".into());
    }
    // cd into the session's launch dir (so /restart can check out its branch),
    // resolved from the transcript; fall back to home.
    let dir = if session_id.is_empty() {
        None
    } else {
        reader::resolve_session_cwd(&session_id)
    }
    .unwrap_or_else(|| config::home().to_string_lossy().into_owned());

    let prompt = format!("/restart {slug}");
    let cmd = format!(
        "cd {} && claude --model {} {}",
        pty::shell_quote(&dir),
        pty::shell_quote(pty::CLAUDE_MODEL),
        pty::shell_quote(&prompt),
    );
    launch_in_terminal(&cmd)
}

/// True for a project-key ticket like `ABC-123` (letter, alnum*, dash, digits).
fn is_ticket(t: &str) -> bool {
    let (key, num) = match t.split_once('-') {
        Some(kv) => kv,
        None => return false,
    };
    !key.is_empty()
        && key.bytes().next().is_some_and(|b| b.is_ascii_alphabetic())
        && key.bytes().all(|b| b.is_ascii_alphanumeric())
        && !num.is_empty()
        && num.bytes().all(|b| b.is_ascii_digit())
}

/// Percent-encode a string for safe use as a URL query value (unreserved chars
/// pass through; everything else becomes %XX). The detached window reads it back
/// via URLSearchParams, which decodes it.
fn percent_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Stable, always-valid window label for a session key (which may be a notesPath
/// full of `/` and `.` that Tauri rejects as a label). FNV-1a → hex.
fn label_for(key: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in key.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("detail-{h:016x}")
}

/// Detach a session into its own window (port of the Electron detach-session). The
/// key (running notesPath/sessionId, or historical key) is passed as a query param;
/// detail.html's detail-window.js looks the session up across all tabs. Re-detaching
/// the same session focuses the existing window instead of opening a duplicate.
#[tauri::command]
fn detach_session(app: tauri::AppHandle, key: String) -> Result<(), String> {
    if key.is_empty() {
        return Err("invalid key".into());
    }
    let label = label_for(&key);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.set_focus();
        return Ok(());
    }
    let url = format!("detail.html?key={}", percent_encode(&key));
    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(url.into()))
        .title("")
        .inner_size(560.0, 720.0)
        .min_inner_size(360.0, 420.0)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Toggle the calling window's always-on-top ("pin"). Acts only on the sender's
/// own window; returns the requested state (the renderer tracks it from there).
#[tauri::command]
fn set_always_on_top(window: tauri::WebviewWindow, flag: bool) -> bool {
    let _ = window.set_always_on_top(flag);
    flag
}

/// Write `body` to `path` atomically (tmp + rename), so a crash never leaves a
/// half-written session file.
fn atomic_write(path: &std::path::Path, body: &str) -> Result<(), String> {
    let tmp = path.with_extension("ao-tmp");
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Resolve a notes.md path the app is allowed to WRITE: a real `notes.md` file
/// confined under a configured root (workRoot / personalRoot). Shared by the two
/// source-of-truth writes (archive + pr_link) so the confinement rule lives once.
fn notes_md_under_root(notes_path: &str) -> Result<std::path::PathBuf, String> {
    if notes_path.starts_with('-') {
        return Err("invalid path".into());
    }
    let abs = std::path::Path::new(notes_path)
        .canonicalize()
        .map_err(|_| "notes.md not found".to_string())?;
    if !abs.is_file() || abs.file_name().and_then(|n| n.to_str()) != Some("notes.md") {
        return Err("not a notes.md file".into());
    }
    let cfg = config::load();
    let under_root = ["workRoot", "personalRoot"].iter().any(|k| {
        cfg.get(*k)
            .and_then(serde_json::Value::as_str)
            .and_then(|r| std::path::Path::new(r).canonicalize().ok())
            .map(|root| abs.starts_with(&root))
            .unwrap_or(false)
    });
    if !under_root {
        return Err("notes.md is outside the configured roots".into());
    }
    Ok(abs)
}

/// A GitHub pull-request URL: `https://github.com/<owner>/<repo>/pull/<number>`,
/// optionally followed by `/…`, `#…` or `?…`. No whitespace (also keeps it safe to
/// embed in the /start shell command, which we shell-quote anyway).
fn is_pr_url(url: &str) -> bool {
    if url.chars().any(|c| c.is_whitespace()) {
        return false;
    }
    let Some(rest) = url.strip_prefix("https://github.com/") else {
        return false;
    };
    let parts: Vec<&str> = rest.splitn(4, '/').collect();
    if parts.len() < 4 || parts[0].is_empty() || parts[1].is_empty() || parts[2] != "pull" {
        return false;
    }
    parts[3].chars().next().is_some_and(|c| c.is_ascii_digit())
}

/// Insert / replace / clear the `pr_link:` line in the leading `---` frontmatter.
/// Empty `url` removes the line (no stale link). Content with no frontmatter block
/// is returned unchanged (every session notes.md has frontmatter).
fn set_pr_link_in_frontmatter(content: &str, url: &str) -> String {
    let Some(rest) = content.strip_prefix("---\n") else {
        return content.to_string();
    };
    let Some(end) = rest.find("\n---") else {
        return content.to_string();
    };
    let (fm, tail) = (&rest[..end], &rest[end..]); // tail starts at "\n---…"
    let mut lines: Vec<String> = Vec::new();
    let mut found = false;
    for l in fm.lines() {
        if l.trim_start().starts_with("pr_link:") {
            found = true;
            if !url.is_empty() {
                lines.push(format!("pr_link: {url}"));
            }
        } else {
            lines.push(l.to_string());
        }
    }
    if !found && !url.is_empty() {
        lines.push(format!("pr_link: {url}"));
    }
    format!("---\n{}{}", lines.join("\n"), tail)
}

/// Append an ARCHIVED bullet at the end of the `## Session history` section
/// (creating the section if absent). Pure + unit-tested — mirrors what /archive
/// writes. The dashboard classifies a session as Archived from any history line
/// containing "ARCHIVED" (reader.rs::session_history_info).
fn stamp_archived(content: &str, line: &str) -> String {
    const MARKER: &str = "## Session history";
    match content.find(MARKER) {
        Some(hpos) => {
            // End of the header line, then the section runs to the next "## " / EOF.
            let after_header = content[hpos..].find('\n').map(|i| hpos + i + 1).unwrap_or(content.len());
            let sec_end = content[after_header..]
                .find("\n## ")
                .map(|i| after_header + i)
                .unwrap_or(content.len());
            let body = content[after_header..sec_end].trim_end();
            let new_body = if body.is_empty() { format!("{line}\n") } else { format!("{body}\n{line}\n") };
            format!("{}{}{}", &content[..after_header], new_body, &content[sec_end..])
        }
        None => format!("{}\n\n{MARKER}\n{line}\n", content.trim_end()),
    }
}

/// Archive a session FROM THE DASHBOARD (ADR-013 — the app's one source-of-truth
/// write, a deliberate derogation from ADR-001): stamps ARCHIVED into notes.md and
/// drops the session from active-sessions.json. Mirrors the /archive skill. Writes
/// are atomic and confined to a real notes.md under a configured root.
#[tauri::command(async)]
fn archive_session(notes_path: String) -> Result<(), String> {
    let abs = notes_md_under_root(&notes_path)?;

    // 1) Stamp ARCHIVED into notes.md (atomic).
    let content = std::fs::read_to_string(&abs).map_err(|e| e.to_string())?;
    let date = std::process::Command::new("date")
        .arg("+%Y-%m-%d %H:%M")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_default();
    let line = format!("- {date} | ARCHIVED | archived from the dashboard");
    atomic_write(&abs, &stamp_archived(&content, &line))?;

    // 2) Drop matching entries from active-sessions.json (atomic). Match the path
    // both as sent and canonicalized (the registry may store either form).
    let active = config::home().join(".claude").join("active-sessions.json");
    if let Ok(s) = std::fs::read_to_string(&active) {
        if let Ok(serde_json::Value::Object(mut map)) = serde_json::from_str(&s) {
            let canon = abs.to_string_lossy();
            let before = map.len();
            map.retain(|_, v| {
                let np = v.get("notes_path").and_then(serde_json::Value::as_str);
                np != Some(notes_path.as_str()) && np != Some(canon.as_ref())
            });
            if map.len() != before {
                let body = serde_json::to_string_pretty(&serde_json::Value::Object(map))
                    .map_err(|e| e.to_string())?;
                atomic_write(&active, &body)?;
            }
        }
    }
    Ok(())
}

/// Set / update / clear the reviewed-PR link on a session (ADR-013 family — the app's
/// 2nd bounded source-of-truth write). Validates a GitHub PR URL (empty = clear),
/// then rewrites the `pr_link:` frontmatter line atomically, confined under a root.
#[tauri::command(async)]
fn set_pr_link(notes_path: String, url: String) -> Result<(), String> {
    let url = url.trim();
    if !url.is_empty() && !is_pr_url(url) {
        return Err("not a GitHub PR URL (https://github.com/owner/repo/pull/N)".into());
    }
    let abs = notes_md_under_root(&notes_path)?;
    let content = std::fs::read_to_string(&abs).map_err(|e| e.to_string())?;
    atomic_write(&abs, &set_pr_link_in_frontmatter(&content, url))
}

/// Open a native folder picker for Settings; returns the chosen absolute path, or
/// null if cancelled. MUST stay `async`: the native panel (rfd) runs on the main
/// thread and `blocking_pick_folder` blocks the caller on a channel — only safe
/// when invoked off the main thread, which `command(async)` guarantees. A sync
/// command here would deadlock the app the moment Browse is clicked.
#[tauri::command(async)]
fn pick_directory(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(pty::PtyManager::new())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config::get_config,
            config::set_config,
            reader::get_sessions,
            reader::get_historical_sessions,
            open_external,
            open_path,
            open_in_terminal,
            start_session,
            restore_session,
            detach_session,
            set_always_on_top,
            pick_directory,
            archive_session,
            set_pr_link,
            can_reveal_terminal,
            reveal_terminal,
            pty::pty_spawn,
            pty::pty_input,
            pty::pty_resize,
            pty::pty_kill,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // On app exit, kill embedded ptys so their `claude` children don't orphan
            // (which would keep the session "running" with no terminal after reopen).
            if let tauri::RunEvent::ExitRequested { .. } = event {
                app_handle.state::<pty::PtyManager>().kill_all();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{is_pr_url, set_pr_link_in_frontmatter, stamp_archived};

    const LINE: &str = "- 2026-06-14 10:00 | ARCHIVED | archived from the dashboard";

    #[test]
    fn pr_url_accepts_canonical_and_suffixed() {
        assert!(is_pr_url("https://github.com/owner/repo/pull/35"));
        assert!(is_pr_url("https://github.com/o/r/pull/1/files"));
        assert!(is_pr_url("https://github.com/o/r/pull/9#discussion_r1"));
        assert!(is_pr_url("https://github.com/o/r/pull/42?w=1"));
    }

    #[test]
    fn pr_url_rejects_non_pr_and_junk() {
        assert!(!is_pr_url("https://github.com/o/r/issues/3")); // not a PR
        assert!(!is_pr_url("https://github.com/o/r/pull/abc")); // no number
        assert!(!is_pr_url("https://github.com/o/r/pull/")); // missing number
        assert!(!is_pr_url("https://gitlab.com/o/r/pull/3")); // wrong host
        assert!(!is_pr_url("http://github.com/o/r/pull/3")); // not https
        assert!(!is_pr_url("https://github.com/o/r/pull/3 extra")); // whitespace
        assert!(!is_pr_url(""));
    }

    const FM: &str = "---\nname: x\ncategory: REVIEW\nbranch: feat/y\n---\n\n# x\nbody\n";

    #[test]
    fn pr_link_inserts_when_absent() {
        let out = set_pr_link_in_frontmatter(FM, "https://github.com/o/r/pull/5");
        assert!(out.contains("pr_link: https://github.com/o/r/pull/5"));
        // Other keys + body preserved, single frontmatter block.
        assert!(out.contains("category: REVIEW") && out.contains("# x\nbody"));
        assert_eq!(out.matches("\n---").count(), 1);
    }

    #[test]
    fn pr_link_replaces_existing() {
        let with = set_pr_link_in_frontmatter(FM, "https://github.com/o/r/pull/1");
        let out = set_pr_link_in_frontmatter(&with, "https://github.com/o/r/pull/2");
        assert!(out.contains("pull/2") && !out.contains("pull/1"));
        assert_eq!(out.matches("pr_link:").count(), 1);
    }

    #[test]
    fn pr_link_empty_clears_the_line() {
        let with = set_pr_link_in_frontmatter(FM, "https://github.com/o/r/pull/1");
        let out = set_pr_link_in_frontmatter(&with, "");
        assert!(!out.contains("pr_link:"));
        assert!(out.contains("category: REVIEW")); // rest intact
    }

    #[test]
    fn pr_link_noop_without_frontmatter() {
        let plain = "# no frontmatter\nbody\n";
        assert_eq!(set_pr_link_in_frontmatter(plain, "https://github.com/o/r/pull/1"), plain);
    }

    #[test]
    fn appends_after_existing_history_entries() {
        let notes = "# Title\n\n## Session history\n- 2026-05-04 12:31 | session=abc | did stuff\n";
        let out = stamp_archived(notes, LINE);
        assert!(out.contains("did stuff"));
        assert!(out.contains("ARCHIVED"));
        // ARCHIVED comes after the existing entry, inside the section.
        assert!(out.find("did stuff").unwrap() < out.find("ARCHIVED").unwrap());
    }

    #[test]
    fn inserts_inside_section_when_history_is_not_last() {
        let notes = "## Session history\n- a | session=x\n\n## Next steps\n1. do\n";
        let out = stamp_archived(notes, LINE);
        // ARCHIVED must land before the next section header, not after it.
        assert!(out.find("ARCHIVED").unwrap() < out.find("## Next steps").unwrap());
        assert!(out.contains("## Next steps")); // section preserved
    }

    #[test]
    fn creates_section_when_absent() {
        let notes = "# Title\n\n## Goal\nstuff";
        let out = stamp_archived(notes, LINE);
        assert!(out.contains("## Session history"));
        assert!(out.contains("ARCHIVED"));
    }

    #[test]
    fn handles_empty_history_section() {
        let notes = "## Session history\n";
        let out = stamp_archived(notes, LINE);
        assert!(out.contains("ARCHIVED"));
    }
}
