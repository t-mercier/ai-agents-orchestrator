//! Git helpers for session branch/worktree detection.
//! Provides cached access to git information (branch, worktree) per working directory.

use serde_json::Value;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// git_info spawns 2-3 `git` subprocesses per cwd; cache the result per cwd with a
/// short TTL so a 5s poll doesn't re-fork for every session every time. Branch/worktree
/// staleness up to the TTL is fine for a dashboard.
/// cwd → (cached-at, branch, worktree); entries expire after GIT_TTL.
type GitEntry = (Instant, Value, Value);
static GIT_CACHE: LazyLock<Mutex<HashMap<String, GitEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
const GIT_TTL: Duration = Duration::from_secs(15);

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
pub(crate) fn git_info(cwd: &str) -> (Value, Value) {
    if cwd.is_empty() {
        return (Value::Null, Value::Null);
    }
    if let Some((t, b, w)) = GIT_CACHE.lock().unwrap().get(cwd) {
        if t.elapsed() < GIT_TTL {
            return (b.clone(), w.clone());
        }
    }
    let (b, w) = git_info_uncached(cwd);
    let mut cache = GIT_CACHE.lock().unwrap();
    // Drop expired entries while we're here — cwds of closed/vanished sessions would
    // otherwise accumulate for the app's lifetime (nothing else ever removes them).
    cache.retain(|_, (t, _, _)| t.elapsed() < GIT_TTL);
    cache.insert(cwd.to_string(), (Instant::now(), b.clone(), w.clone()));
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
