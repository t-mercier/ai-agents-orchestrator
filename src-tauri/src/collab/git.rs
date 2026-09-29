//! The git a collab needs: where it started, what changed since, and the throw-away
//! worktrees of Parallel mode. Every call is `git` with separate arguments, never a shell
//! line, so no value here is ever parsed by a shell.

use std::path::Path;
use std::process::Command;

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// The commit the working tree is on, which the collab's diffs are taken against.
pub(crate) fn head(repo: &Path) -> Result<String, String> {
    git(repo, &["rev-parse", "HEAD"])
}

pub(crate) fn is_repo(dir: &Path) -> bool {
    git(dir, &["rev-parse", "--is-inside-work-tree"]).is_ok_and(|s| s == "true")
}

/// No uncommitted change and no untracked file: a collab starts from a known commit, so its
/// review is of the agents' work and not of the user's.
pub(crate) fn is_clean(repo: &Path) -> Result<bool, String> {
    git(repo, &["status", "--porcelain", "--untracked-files=normal"]).map(|s| s.is_empty())
}

/// `git diff --no-index` exits 1 when the files differ, which is the answer, not a failure.
fn diff_new_file(repo: &Path, file: &str) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C").arg(repo)
        .args(["diff", "--no-ext-diff", "--no-textconv", "--no-index", "--", "/dev/null", file])
        .output()
        .map_err(|e| e.to_string())?;
    match out.status.code() {
        Some(0) | Some(1) => Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string()),
        _ => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
    }
}

/// Everything that changed since `base`, committed or not, new files included: an agent
/// told not to commit may still do it, and a new file is invisible to a plain `git diff`.
/// The index is never written — the new files are diffed against nothing, one by one — and
/// no diff driver of the repository runs. Returns `(stat, diff)`, the diff cut at `max`
/// bytes with a note saying so; the stat always lists every file.
pub(crate) fn changes_since(repo: &Path, base: &str, max: usize) -> Result<(String, String), String> {
    if !base.bytes().all(|b| b.is_ascii_hexdigit()) || base.len() < 7 {
        return Err(format!("not a commit: {base}"));
    }
    let mut stat = git(repo, &["diff", "--no-ext-diff", "--no-textconv", "--stat", base, "--"])?;
    let mut diff = git(repo, &["diff", "--no-ext-diff", "--no-textconv", base, "--"])?;
    let untracked = git(repo, &["ls-files", "--others", "--exclude-standard"])?;
    for file in untracked.lines().filter(|l| !l.is_empty()) {
        stat.push_str(&format!("\n {file} (new)"));
        if diff.len() < max {
            let d = diff_new_file(repo, file)?;
            if !d.is_empty() {
                if !diff.is_empty() {
                    diff.push('\n');
                }
                diff.push_str(&d);
            }
        }
    }
    if diff.len() > max {
        let mut cut = max;
        while !diff.is_char_boundary(cut) {
            cut -= 1;
        }
        diff.truncate(cut);
        diff.push_str("\n[… diff cut here: it is longer than the review can take; the stat above lists every file]");
    }
    Ok((stat.trim_start_matches('\n').to_string(), diff))
}

/// A branch or folder name made from the user's session name: lowercase letters, digits
/// and `-` only, so it is valid to git and to the file system whatever was typed.
#[allow(dead_code)] // Parallel mode (plan 3)
pub(crate) fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').chars().take(40).collect()
}

/// A worktree for one Parallel agent, on a new branch from `base`.
#[allow(dead_code)] // Parallel mode (plan 3)
pub(crate) fn add_worktree(repo: &Path, path: &Path, branch: &str, base: &str) -> Result<(), String> {
    let p = path.to_str().ok_or("path is not valid UTF-8")?;
    git(repo, &["worktree", "add", "-b", branch, p, base]).map(|_| ())
}

/// Remove a Parallel worktree, and its branch unless `keep_branch`.
#[allow(dead_code)] // Parallel mode (plan 3)
pub(crate) fn remove_worktree(repo: &Path, path: &Path, branch: &str, keep_branch: bool) -> Result<(), String> {
    let p = path.to_str().ok_or("path is not valid UTF-8")?;
    git(repo, &["worktree", "remove", "--force", p])?;
    if !keep_branch {
        git(repo, &["branch", "-D", branch])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("ao-collab-git-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        for a in [&["init", "-q"][..], &["config", "user.email", "t@example.com"], &["config", "user.name", "t"]] {
            git(&d, a).unwrap();
        }
        std::fs::write(d.join("a.txt"), "one\n").unwrap();
        git(&d, &["add", "."]).unwrap();
        git(&d, &["commit", "-qm", "base"]).unwrap();
        d
    }

    #[test]
    fn changes_include_edits_new_files_and_commits_made_anyway() {
        let d = repo("changes");
        let base = head(&d).unwrap();
        std::fs::write(d.join("a.txt"), "one\ntwo\n").unwrap();
        std::fs::write(d.join("new.txt"), "fresh\n").unwrap();
        let (stat, diff) = changes_since(&d, &base, 60_000).unwrap();
        assert!(stat.contains("a.txt") && stat.contains("new.txt"), "{stat}");
        assert!(diff.contains("+two") && diff.contains("+fresh"));
        assert!(git(&d, &["diff", "--cached", "--name-only"]).unwrap().is_empty(), "nothing left staged");
        assert!(!d.join(".git/index.lock").exists());
        // The index is never written, not even for a moment: its bytes are unchanged.
        let before = std::fs::read(d.join(".git/index")).unwrap();
        changes_since(&d, &base, 60_000).unwrap();
        assert_eq!(std::fs::read(d.join(".git/index")).unwrap(), before);
        assert!(!is_clean(&d).unwrap(), "edits and a new file");
        git(&d, &["add", "."]).unwrap();
        git(&d, &["commit", "-qm", "agent committed"]).unwrap();
        assert!(changes_since(&d, &base, 60_000).unwrap().1.contains("+two"), "a commit made anyway still shows");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_fresh_checkout_is_clean() {
        let d = repo("clean");
        assert!(is_clean(&d).unwrap());
        std::fs::write(d.join("untracked.txt"), "x").unwrap();
        assert!(!is_clean(&d).unwrap());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_long_diff_is_cut_and_says_so() {
        let d = repo("long");
        let base = head(&d).unwrap();
        std::fs::write(d.join("a.txt"), "x\n".repeat(50_000)).unwrap();
        let (_, diff) = changes_since(&d, &base, 1_000).unwrap();
        assert!(diff.len() < 1_200 && diff.contains("diff cut here"));
        assert!(changes_since(&d, "HEAD; rm -rf /", 10).is_err(), "only a commit id");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_parallel_worktree_is_added_kept_or_removed_with_its_branch() {
        let d = repo("wt");
        let base = head(&d).unwrap();
        let wt = std::env::temp_dir().join(format!("ao-collab-wt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&wt);
        add_worktree(&d, &wt, "ao/collab/x-codex", &base).unwrap();
        assert!(wt.join("a.txt").exists());
        remove_worktree(&d, &wt, "ao/collab/x-codex", false).unwrap();
        assert!(!wt.exists());
        assert!(git(&d, &["branch", "--list", "ao/collab/x-codex"]).unwrap().is_empty());
        add_worktree(&d, &wt, "ao/collab/x-claude", &base).unwrap();
        remove_worktree(&d, &wt, "ao/collab/x-claude", true).unwrap();
        assert!(!git(&d, &["branch", "--list", "ao/collab/x-claude"]).unwrap().is_empty(), "kept");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_name_becomes_a_safe_slug() {
        assert_eq!(slug("Fix l'import — Élodie!"), "fix-l-import-lodie");
        assert_eq!(slug("../../etc"), "etc");
        assert!(!is_repo(Path::new("/")));
    }
}
