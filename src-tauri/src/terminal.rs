//! Terminal launching helpers for running commands in user's chosen terminal.
//! Adapters for iTerm2 and Terminal.app with fallback logic and window reveal support.

use crate::config;

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
pub(crate) fn launch_in_terminal(cmd: &str) -> Result<(), String> {
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
pub(crate) fn session_tty(pid: i64) -> Option<String> {
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
pub(crate) fn scan_terminals(tty: &str, select: bool) -> bool {
    if std::path::Path::new("/Applications/iTerm.app").exists() && reveal_in("iTerm2", tty, select) {
        return true;
    }
    reveal_in("Terminal", tty, select)
}
