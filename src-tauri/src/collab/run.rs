//! One collab turn: a headless agent run, read as it writes.
//!
//! `prstatus::run_within` reads its child's output only once the child has exited, so a
//! child that prints more than a pipe holds (about 64 KiB) blocks on the write and is
//! killed as timed out. An agent turn prints far more than that, so this runner drains the
//! output on a thread while it waits.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// What a turn keeps of its output: the end, where the agent's summary is.
pub(crate) const KEEP: usize = 256 * 1024;

#[derive(Debug, PartialEq)]
pub(crate) enum Outcome {
    Done,
    Failed(i32),
    TimedOut,
    Stopped,
}

#[derive(Debug)]
pub(crate) struct TurnResult {
    pub outcome: Outcome,
    /// The last `KEEP` bytes of stdout and stderr, as text.
    pub output: String,
}

/// Run `line` through a login shell in `dir` (a Finder-launched app has no agent CLI on its
/// PATH), in its own process group so Stop and the timeout end the CLI and everything it
/// started, not only the shell.
pub(crate) fn run_turn(line: &str, dir: &str, limit: Duration, stop: &Arc<AtomicBool>) -> Result<TurnResult, String> {
    use std::os::unix::process::CommandExt;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut child = Command::new(&shell)
        .args(["-ilc", line])
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
        .map_err(|e| e.to_string())?;
    let pgid = child.id() as i32;
    let drain = |mut r: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut kept: Vec<u8> = Vec::new();
            let mut buf = [0u8; 16 * 1024];
            while let Ok(n) = r.read(&mut buf) {
                if n == 0 {
                    break;
                }
                kept.extend_from_slice(&buf[..n]);
                if kept.len() > 2 * KEEP {
                    kept.drain(..kept.len() - KEEP);
                }
            }
            kept
        })
    };
    let out = drain(Box::new(child.stdout.take().ok_or("no stdout")?));
    let err = drain(Box::new(child.stderr.take().ok_or("no stderr")?));
    let start = Instant::now();
    let outcome = loop {
        match child.try_wait() {
            Ok(Some(status)) => break if status.success() { Outcome::Done } else { Outcome::Failed(status.code().unwrap_or(-1)) },
            Ok(None) => {}
            Err(e) => return Err(e.to_string()),
        }
        let why = if stop.load(Ordering::SeqCst) {
            Some(Outcome::Stopped)
        } else if start.elapsed() >= limit {
            Some(Outcome::TimedOut)
        } else {
            None
        };
        if let Some(o) = why {
            // SAFETY: kill(2) on a process group this function created.
            unsafe { libc::kill(-pgid, libc::SIGTERM) };
            std::thread::sleep(Duration::from_millis(300));
            unsafe { libc::kill(-pgid, libc::SIGKILL) };
            let _ = child.wait();
            break o;
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let mut bytes = out.join().unwrap_or_default();
    let e = err.join().unwrap_or_default();
    if !e.is_empty() {
        bytes.extend_from_slice(b"\n");
        bytes.extend_from_slice(&e);
    }
    if bytes.len() > KEEP {
        bytes.drain(..bytes.len() - KEEP);
    }
    Ok(TurnResult { outcome, output: String::from_utf8_lossy(&bytes).into_owned() })
}

/// The last `max` bytes of `text`, starting on a character boundary.
pub(crate) fn tail(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut i = text.len() - max;
    while !text.is_char_boundary(i) {
        i += 1;
    }
    &text[i..]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn go(line: &str, limit_ms: u64) -> TurnResult {
        run_turn(line, "/", Duration::from_millis(limit_ms), &Arc::new(AtomicBool::new(false))).unwrap()
    }

    // The case run_within cannot survive: far more output than a pipe holds.
    #[test]
    fn a_turn_that_prints_a_megabyte_finishes_and_keeps_its_end() {
        let r = go("head -c 1048576 /dev/zero | tr '\\0' 'x'; echo; echo SUMMARY-LINE", 20_000);
        assert_eq!(r.outcome, Outcome::Done);
        assert!(r.output.len() <= KEEP + 16, "{}", r.output.len());
        assert!(r.output.trim_end().ends_with("SUMMARY-LINE"));
    }

    #[test]
    fn a_failing_turn_reports_its_exit_code_and_stderr() {
        let r = go("echo nope >&2; exit 3", 10_000);
        assert_eq!(r.outcome, Outcome::Failed(3));
        assert!(r.output.contains("nope"));
    }

    #[test]
    fn a_turn_past_its_limit_is_ended_with_everything_it_started() {
        let marker = std::env::temp_dir().join(format!("ao-collab-orphan-{}", std::process::id()));
        let _ = std::fs::remove_file(&marker);
        let t = Instant::now();
        let r = go(&format!("(sleep 3; touch {}) & sleep 30", marker.display()), 700);
        assert_eq!(r.outcome, Outcome::TimedOut);
        assert!(t.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_secs(4));
        assert!(!marker.exists(), "the background child was killed with its group");
    }

    #[test]
    fn stop_ends_a_running_turn() {
        let stop = Arc::new(AtomicBool::new(false));
        let s2 = stop.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            s2.store(true, Ordering::SeqCst);
        });
        let r = run_turn("sleep 30", "/", Duration::from_secs(60), &stop).unwrap();
        assert_eq!(r.outcome, Outcome::Stopped);
    }

    #[test]
    fn the_tail_never_cuts_a_character() {
        assert_eq!(tail("héllo", 4), "llo");
        assert_eq!(tail("abc", 10), "abc");
    }
}
