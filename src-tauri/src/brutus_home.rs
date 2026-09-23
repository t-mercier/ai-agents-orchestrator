//! Brutus's folder and what the app writes into it before every run.

// TEMPORARY until the runner (brutus.rs) and reader.rs consume these — remove with them.
#![allow(dead_code)]

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) fn dir() -> PathBuf {
    crate::config::config_dir().join("brutus")
}

const MEMORY_SEED: &str = "# Memory\n\nWhat Brutus keeps about you. You can edit or empty this file.\n";

/// Create the folder and `memory.md`, and return the folder's RESOLVED path: a permission
/// rule must name the real path (`/tmp` is `/private/tmp` on macOS) or it matches nothing.
pub(crate) fn ensure() -> Result<PathBuf, String> {
    let d = dir();
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let mem = d.join("memory.md");
    if !mem.exists() {
        fs::write(&mem, MEMORY_SEED).map_err(|e| e.to_string())?;
    }
    fs::canonicalize(&d).map_err(|e| e.to_string())
}

/// The single write he is allowed. `Edit(…)` covers every file-editing tool — Claude Code
/// ignores `Write(…)` rules — and `//` makes the path absolute; one `/` would be relative
/// to this settings file and silently deny everything.
pub(crate) fn settings_json(resolved_dir: &Path) -> Value {
    let mem = resolved_dir.join("memory.md");
    json!({ "permissions": { "allow": [format!("Edit(/{})", mem.to_string_lossy())] } })
}

/// What he may read: the category folders (where notes.md live) and the knowledge
/// folders — never a space root, which can be a whole repo tree or `~` itself. Existing
/// only, canonicalized, deduped, and never `home` or one of its ancestors: under
/// `--restricted` these folders ARE the read boundary.
pub(crate) fn read_dirs(cfg: &Value, home: &Path) -> Vec<String> {
    let home = fs::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());
    let mut out: Vec<String> = Vec::new();
    let mut push = |p: &str| {
        if p.trim().is_empty() {
            return;
        }
        let Ok(c) = fs::canonicalize(p) else { return };
        if !c.is_dir() || home.starts_with(&c) {
            return;
        }
        let s = c.to_string_lossy().into_owned();
        if !out.contains(&s) {
            out.push(s);
        }
    };
    for sd in cfg.get("scanDirs").and_then(Value::as_array).into_iter().flatten() {
        if let Some(b) = sd.get("base").and_then(Value::as_str) {
            push(b);
        }
    }
    for r in cfg.get("roots").and_then(Value::as_array).into_iter().flatten() {
        if let Some(v) = r.get("vaultPath").and_then(Value::as_str) {
            push(v);
        }
    }
    out
}

fn cell(v: &str) -> String {
    v.replace('|', "/").replace('\n', " ").trim().to_string()
}

fn strs(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default()
}

fn tickets_cell(s: &Value) -> String {
    let mut tickets = strs(s, "tickets");
    if tickets.is_empty() {
        if let Some(t) = s.get("ticket").and_then(Value::as_str).filter(|t| !t.is_empty()) {
            tickets.push(t.to_string());
        }
    }
    let states = strs(s, "ticketStates");
    tickets
        .iter()
        .map(|t| {
            let st = states.iter().find_map(|l| l.strip_prefix(&format!("{t}: ")));
            match st {
                Some(w) => format!("{t} ({w})"),
                None => t.clone(),
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn prs_cell(s: &Value, prs: &Value) -> String {
    let mut links = strs(s, "prLinks");
    if links.is_empty() {
        if let Some(l) = s.get("prLink").and_then(Value::as_str).filter(|l| !l.is_empty()) {
            links.push(l.to_string());
        }
    }
    links
        .iter()
        .map(|u| {
            let n = u.rsplit('/').next().unwrap_or(u);
            match prs.get(u).and_then(|p| p.get("state")).and_then(Value::as_str) {
                Some(st) => format!("#{n} ({st})"),
                None => format!("#{n}"),
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn row(s: &Value, status: &str, prs: &Value) -> String {
    let f = |k: &str| s.get(k).and_then(Value::as_str).unwrap_or("");
    let last = [f("lastActivity"), f("lastActivityAt"), f("updatedAt")]
        .into_iter()
        .find(|v| !v.is_empty())
        .unwrap_or("");
    format!(
        "| {} | {} | {} | {} | {} | {} | {} | {} |",
        cell(f("name")), cell(f("root")), cell(f("category")), cell(status),
        cell(&tickets_cell(s)), cell(&prs_cell(s, prs)), cell(last), cell(f("notesPath")),
    )
}

/// The dashboard as the app sees it. Live sessions carry their process status; stale ones
/// are listed as such; closed ones only from `cutoff` (YYYY-MM-DD) on; archived never.
pub(crate) fn dashboard_md(
    live: &[Value], hist: &Value, prs: &Value, knowledge: &[String], cutoff: &str, stamp: &str,
) -> String {
    let mut md = format!(
        "# Dashboard\n\nGenerated {stamp}. Knowledge folders: {}\n\n\
         | Session | Space | Category | Status | Tickets | PRs | Last activity | Notes |\n\
         |---|---|---|---|---|---|---|---|\n",
        if knowledge.is_empty() { "none".to_string() } else { knowledge.join(", ") }
    );
    for s in live {
        let st = s.get("status").and_then(Value::as_str).unwrap_or("idle");
        md.push_str(&row(s, st, prs));
        md.push('\n');
    }
    for s in hist.get("stale").and_then(Value::as_array).into_iter().flatten() {
        md.push_str(&row(s, "stale", prs));
        md.push('\n');
    }
    for s in hist.get("closed").and_then(Value::as_array).into_iter().flatten() {
        let date = s.get("historyDate").and_then(Value::as_str).unwrap_or("");
        if date >= cutoff {
            md.push_str(&row(s, &format!("closed {date}"), prs));
            md.push('\n');
        }
    }
    md
}

pub(crate) fn memory_count(text: &str) -> usize {
    text.lines().filter(|l| l.trim_start().starts_with("- ")).count()
}

/// True when `cwd` is Brutus's folder — his runs are Claude Code processes like any other,
/// and must not be listed as sessions.
pub(crate) fn is_brutus_cwd(cwd: &str) -> bool {
    if cwd.is_empty() {
        return false;
    }
    let mine = fs::canonicalize(dir()).unwrap_or_else(|_| dir());
    let theirs = fs::canonicalize(cwd).unwrap_or_else(|_| PathBuf::from(cwd));
    theirs == mine
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn settings_allow_exactly_one_edit_on_memory_with_a_double_slash_path() {
        let s = settings_json(Path::new("/private/tmp/x/brutus"));
        assert_eq!(s, json!({ "permissions": { "allow": ["Edit(//private/tmp/x/brutus/memory.md)"] } }));
    }

    #[test]
    fn reads_are_the_category_and_knowledge_folders_never_a_root_or_home() {
        let t = std::env::temp_dir().join(format!("ao-brutus-dirs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&t);
        let home = t.join("home");
        for d in ["home/work/BUG", "home/work/FEAT", "home/vault"] {
            std::fs::create_dir_all(t.join(d)).unwrap();
        }
        let h = home.to_string_lossy();
        let cfg = json!({
            "scanDirs": [
                { "base": format!("{h}/work/BUG") }, { "base": format!("{h}/work/FEAT") },
                { "base": format!("{h}/work/BUG") },          // duplicate
                { "base": format!("{h}/work/GONE") },         // does not exist
                { "base": format!("{h}") },                   // a category AT home: refused
            ],
            "roots": [
                { "path": format!("{h}/work"), "vaultPath": format!("{h}/vault") },
                { "path": format!("{h}") },                   // a root at home: never passed
            ],
        });
        let dirs = read_dirs(&cfg, &home);
        let canon = |p: &str| std::fs::canonicalize(t.join(p)).unwrap().to_string_lossy().into_owned();
        assert_eq!(dirs, vec![canon("home/work/BUG"), canon("home/work/FEAT"), canon("home/vault")]);
        let _ = std::fs::remove_dir_all(&t);
    }

    #[test]
    fn the_dashboard_lists_live_stale_and_recent_closed_but_not_old_or_archived() {
        let live = vec![json!({ "name": "checkout", "root": "Work", "category": "FEAT", "status": "waiting",
            "tickets": ["FEAT-1", "FEAT-2"], "ticketStates": ["FEAT-1: In Review"],
            "prLinks": ["https://github.com/o/r/pull/12"], "lastActivity": "2026-09-23 10:00",
            "notesPath": "/w/FEAT/checkout/notes.md" })];
        let hist = json!({
            "stale": [{ "name": "old-export", "category": "FEAT", "historyDate": "2026-09-10", "notesPath": "/w/FEAT/old/notes.md" }],
            "closed": [
                { "name": "recent", "category": "BUG", "historyDate": "2026-09-20", "notesPath": "/w/BUG/recent/notes.md" },
                { "name": "ancient", "category": "BUG", "historyDate": "2026-08-01", "notesPath": "/w/BUG/ancient/notes.md" },
            ],
            "archived": [{ "name": "gone", "category": "BUG", "historyDate": "2026-09-22", "notesPath": "/x" }],
        });
        let prs = json!({ "https://github.com/o/r/pull/12": { "state": "merged" } });
        let md = dashboard_md(&live, &hist, &prs, &["/v".to_string()], "2026-09-09", "2026-09-23 10:05");
        assert!(md.contains("| checkout | Work | FEAT | waiting | FEAT-1 (In Review), FEAT-2 | #12 (merged) | 2026-09-23 10:00 | /w/FEAT/checkout/notes.md |"), "{md}");
        assert!(md.contains("| old-export |") && md.contains("| stale |"));
        assert!(md.contains("| recent |") && md.contains("closed 2026-09-20"));
        assert!(!md.contains("ancient"), "closed before the cutoff is left out");
        assert!(!md.contains("gone"), "archived is left out");
        assert!(md.contains("Knowledge folders: /v"));
        assert!(md.contains("Generated 2026-09-23 10:05"));
    }

    #[test]
    fn a_pipe_in_a_name_cannot_break_the_table() {
        let live = vec![json!({ "name": "a|b", "category": "FEAT", "status": "idle", "notesPath": "/n" })];
        let md = dashboard_md(&live, &json!({}), &json!({}), &[], "2026-01-01", "x");
        assert!(md.contains("| a/b |"));
    }

    #[test]
    fn memory_counts_bullets_only() {
        assert_eq!(memory_count("# Memory\n\n- 2026-09-23 likes short answers\n- x\ntext\n"), 2);
        assert_eq!(memory_count(""), 0);
    }
}
