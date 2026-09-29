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
    /// The last `KEEP` bytes of stdout: the agent's answer.
    pub stdout: String,
    /// The last `KEEP` bytes of stderr: for a failure's message only.
    pub stderr: String,
}

/// Run `line` through the user's login shell in `dir` (a Finder-launched app has no agent
/// CLI on its PATH, and that PATH is often set in the interactive rc files, hence `-i`).
///
/// The turn runs in a session of its own (`setsid`): it has no controlling terminal, so a
/// shell started under `cargo tauri dev` in a terminal is never stopped by the kernel for
/// touching it, and its process group is the session's. `set +m` turns job control off, so
/// under bash a background job stays in that group instead of getting one of its own. Stop,
/// the timeout and the end of the turn all end the whole group.
/// `on_spawn` gets the process group as soon as it exists, so the caller can record it for
/// the app's quit and for a later launch after a crash.
pub(crate) fn run_turn(line: &str, dir: &str, limit: Duration, stop: &Arc<AtomicBool>, on_spawn: &dyn Fn(i32)) -> Result<TurnResult, String> {
    let shell = crate::shell::user_shell();
    run_turn_with(&shell, line, dir, limit, stop, on_spawn)
}

/// How long the output readers get once the turn has ended and its group is killed. A
/// process that left the group (it called setsid itself) may still hold the pipe; its
/// output past this point is not waited for.
const DRAIN_DEADLINE: Duration = Duration::from_secs(2);

type Kept = Arc<std::sync::Mutex<Vec<u8>>>;

fn drain(mut r: Box<dyn Read + Send>) -> (Kept, std::thread::JoinHandle<()>) {
    let kept: Kept = Arc::new(std::sync::Mutex::new(Vec::new()));
    let k2 = kept.clone();
    let h = std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        loop {
            match r.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let mut k = k2.lock().unwrap_or_else(|e| e.into_inner());
                    k.extend_from_slice(&buf[..n]);
                    if k.len() > 2 * KEEP {
                        let cut = k.len() - KEEP;
                        k.drain(..cut);
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
    });
    (kept, h)
}

pub(crate) fn run_turn_with(shell: &str, line: &str, dir: &str, limit: Duration, stop: &Arc<AtomicBool>, on_spawn: &dyn Fn(i32)) -> Result<TurnResult, String> {
    use std::os::unix::process::CommandExt;
    let mut cmd = Command::new(shell);
    cmd.args(["-ilc", &format!("set +m; {line}")])
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // SAFETY: setsid(2) is async-signal-safe, the one call made between fork and exec.
    unsafe {
        cmd.pre_exec(|| if libc::setsid() == -1 { Err(std::io::Error::last_os_error()) } else { Ok(()) });
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let pgid = child.id() as i32;
    on_spawn(pgid);
    let (out, out_h) = drain(Box::new(child.stdout.take().ok_or("no stdout")?));
    let (err, err_h) = drain(Box::new(child.stderr.take().ok_or("no stderr")?));
    let kill_group = |sig| {
        // SAFETY: kill(2) on the process group this function created.
        unsafe { libc::kill(-pgid, sig) };
    };
    let start = Instant::now();
    let outcome = loop {
        match child.try_wait() {
            // A turn Stop was asked for dies of the signal that ended it: a stop, not a failure.
            Ok(Some(_)) if stop.load(Ordering::SeqCst) => break Outcome::Stopped,
            Ok(Some(status)) => break if status.success() { Outcome::Done } else { Outcome::Failed(status.code().unwrap_or(-1)) },
            Ok(None) => {}
            Err(e) => {
                kill_group(libc::SIGKILL);
                let _ = child.wait();
                return Err(e.to_string());
            }
        }
        let why = if stop.load(Ordering::SeqCst) {
            Some(Outcome::Stopped)
        } else if start.elapsed() >= limit {
            Some(Outcome::TimedOut)
        } else {
            None
        };
        if let Some(o) = why {
            kill_group(libc::SIGTERM);
            std::thread::sleep(Duration::from_millis(300));
            kill_group(libc::SIGKILL);
            let _ = child.wait();
            break o;
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    // Whatever the turn left running is ended with it; then the readers get a deadline.
    kill_group(libc::SIGKILL);
    let until = Instant::now() + DRAIN_DEADLINE;
    while !(out_h.is_finished() && err_h.is_finished()) && Instant::now() < until {
        std::thread::sleep(Duration::from_millis(20));
    }
    let text = |k: &Kept| {
        let mut b = k.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if b.len() > KEEP {
            b.drain(..b.len() - KEEP);
        }
        String::from_utf8_lossy(&b).into_owned()
    };
    Ok(TurnResult { outcome, stdout: text(&out), stderr: text(&err) })
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

    fn go_with(shell: &str, line: &str, limit_ms: u64) -> TurnResult {
        run_turn_with(shell, line, "/", Duration::from_millis(limit_ms), &Arc::new(AtomicBool::new(false)), &|_| {}).unwrap()
    }
    fn go(line: &str, limit_ms: u64) -> TurnResult {
        go_with(&crate::shell::fallback_shell(), line, limit_ms)
    }

    // The case run_within cannot survive: far more output than a pipe holds.
    #[test]
    fn a_turn_that_prints_a_megabyte_finishes_and_keeps_its_end() {
        let r = go("head -c 1048576 /dev/zero | tr '\\0' 'x'; echo; echo SUMMARY-LINE", 20_000);
        assert_eq!(r.outcome, Outcome::Done);
        assert!(r.stdout.len() <= KEEP + 16, "{}", r.stdout.len());
        assert!(r.stdout.trim_end().ends_with("SUMMARY-LINE"));
    }

    // A login shell prints its own notices on stderr (on the author's machine, nvm's). The
    // answer an agent gives is stdout: stderr must never land after it, where the LGTM
    // rule reads the last line.
    #[test]
    fn stderr_is_kept_apart_from_the_answer() {
        let r = go("echo LGTM; echo 'N/A: version v20 is not yet installed' >&2", 10_000);
        assert_eq!(r.outcome, Outcome::Done);
        assert_eq!(r.stdout.trim_end(), "LGTM");
        assert!(r.stderr.contains("not yet installed"));
    }

    #[test]
    fn a_failing_turn_reports_its_exit_code_and_stderr() {
        let r = go("echo nope >&2; exit 3", 10_000);
        assert_eq!(r.outcome, Outcome::Failed(3));
        assert!(r.stderr.contains("nope"));
    }

    // An agent can leave a process running that still holds the output (a dev server). The
    // turn ends when the agent does, and what was left behind is ended with it.
    #[test]
    fn a_child_left_holding_the_pipe_does_not_hold_the_turn() {
        let t = Instant::now();
        let r = go("sleep 30 & echo started", 60_000);
        assert_eq!(r.outcome, Outcome::Done);
        assert!(t.elapsed() < Duration::from_secs(8), "waited {:?}", t.elapsed());
        assert!(r.stdout.contains("started"));
    }

    // Under bash, job control gives a background job a process group of its own, which a
    // kill of the shell's group missed; the turn then ran to the end of `sleep 30`.
    #[test]
    fn a_turn_past_its_limit_is_ended_with_everything_it_started_under_bash_and_zsh() {
        // zsh is not on every CI runner; each shell this machine has is checked.
        for shell in ["/bin/bash", "/bin/zsh"].into_iter().filter(|s| std::path::Path::new(s).exists()) {
            let marker = std::env::temp_dir().join(format!("ao-collab-orphan-{}-{}", std::process::id(), shell.replace('/', "")));
            let _ = std::fs::remove_file(&marker);
            let t = Instant::now();
            let r = go_with(shell, &format!("(sleep 3; touch {}) & sleep 30", marker.display()), 700);
            assert_eq!(r.outcome, Outcome::TimedOut, "{shell}");
            assert!(t.elapsed() < Duration::from_secs(6), "{shell}: {:?}", t.elapsed());
            std::thread::sleep(Duration::from_secs(4));
            assert!(!marker.exists(), "{shell}: the background child was killed with its group");
        }
    }

    // Stop kills the turn's group, so its process dies of a signal: that is a stop, not a
    // failure with exit -1.
    #[test]
    fn stop_ends_a_running_turn_as_stopped() {
        let stop = Arc::new(AtomicBool::new(false));
        let s2 = stop.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            s2.store(true, Ordering::SeqCst);
        });
        let seen = std::sync::Mutex::new(0);
        let r = run_turn_with(&crate::shell::fallback_shell(), "sleep 30", "/", Duration::from_secs(60), &stop, &|g| *seen.lock().unwrap() = g).unwrap();
        assert!(*seen.lock().unwrap() > 0, "the group was handed over at spawn");
        assert_eq!(r.outcome, Outcome::Stopped);
    }

    #[test]
    fn a_process_killed_from_outside_while_stopping_is_stopped() {
        let stop = Arc::new(AtomicBool::new(false));
        let s2 = stop.clone();
        let r = run_turn_with(&crate::shell::fallback_shell(), "sleep 30", "/", Duration::from_secs(60), &stop, &move |g| {
            let s3 = s2.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(300));
                s3.store(true, Ordering::SeqCst);
                unsafe { libc::kill(-g, libc::SIGKILL) };
            });
        })
        .unwrap();
        assert_eq!(r.outcome, Outcome::Stopped);
    }

    #[test]
    fn the_tail_never_cuts_a_character() {
        assert_eq!(tail("héllo", 4), "llo");
        assert_eq!(tail("abc", 10), "abc");
    }
}
