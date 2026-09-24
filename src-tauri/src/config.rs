//! Shared config (port of the Electron data/config.js).
//! Reads/writes ~/.config/ai-agents-orchestrator/config.json and derives the
//! scanDirs / order / colorMap the renderer expects (same shape as before, so
//! the front-end code is unchanged).
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::SystemTime;

/// Home dir — shared with reader.rs so it isn't defined twice.
pub fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

// Derived-config cache, keyed by config.json's mtime. The poll path calls load()
// repeatedly (per command, per session-scan); re-reading + re-parsing + re-deriving
// the file every time is wasted work. set_config changes the mtime, so the next
// load() rebuilds automatically — no explicit invalidation needed.
// (config.json mtime, derived config) — the cache validates on mtime equality.
type CacheEntry = (Option<SystemTime>, Value);
static CONFIG_CACHE: LazyLock<Mutex<Option<CacheEntry>>> = LazyLock::new(|| Mutex::new(None));

/// The app's own config folder. Its siblings of config.json (the PR-state cache) live
/// here too, so there is one place to look and one place to delete.
pub(crate) fn config_dir() -> PathBuf {
    home().join(".config").join("ai-agents-orchestrator")
}

fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

/// Expand a leading `~` / `~/` to the home directory (empty/other strings pass through).
pub fn expand(p: &str) -> String {
    if p == "~" {
        home().to_string_lossy().into_owned()
    } else if let Some(rest) = p.strip_prefix("~/") {
        home().join(rest).to_string_lossy().into_owned()
    } else {
        p.to_string()
    }
}

fn default_categories() -> Value {
    json!([
        {"name":"FEAT","color":"#7df0c0","root":"Work"},
        {"name":"BUG","color":"#ff9eb1","root":"Work"},
        {"name":"REVIEW","color":"#d9a86e","root":"Work"},
        {"name":"CHORE","color":"#ffe17a","root":"Work"},
        {"name":"TEST","color":"#cdd0d6","root":"Work"},
        {"name":"PERSO","color":"#8fd9ff","root":"Perso"}
    ])
}

/// Load the user config merged over defaults, with derived scanDirs/order/colorMap.
/// Cached by the config file's mtime (see CONFIG_CACHE).
pub fn load() -> Value {
    let path = config_path();
    let mtime = fs::metadata(&path).and_then(|m| m.modified()).ok();
    if let Some((cached_mtime, val)) = CONFIG_CACHE.lock().unwrap().as_ref() {
        if *cached_mtime == mtime {
            return val.clone();
        }
    }
    let derived = build_config(&path);
    *CONFIG_CACHE.lock().unwrap() = Some((mtime, derived.clone()));
    derived
}

/// Read + derive the config from disk (uncached).
fn build_config(path: &Path) -> Value {
    // Absent file = first run → defaults are expected (silent). A file that EXISTS
    // but won't parse is a real misconfiguration: warn so a beta tester who broke
    // their config.json sees why their categories silently reset to defaults.
    let user: Value = match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|e| {
            eprintln!(
                "[ai-agents-orchestrator] {} is not valid JSON ({e}); falling back to defaults",
                path.display()
            );
            json!({})
        }),
        Err(_) => json!({}),
    };
    derive(&user)
}

/// The assistant's four styles. A key, never free text: the backend turns it into prompt
/// wording, so the renderer can choose a style without ever sending prompt text.
pub(crate) const ASSISTANT_STYLES: [&str; 5] = ["concise", "friendly", "casual", "nerdy", "sarcastic"];
const ASSISTANT_NAME_MAX: usize = 24;

/// A display name: control characters out, trimmed, at most 24 characters (not bytes —
/// "Élodie" must not be cut mid-character).
pub(crate) fn clean_assistant_name(raw: &str) -> String {
    let no_ctrl: String = raw.chars().filter(|c| !c.is_control()).collect();
    no_ctrl.trim().chars().take(ASSISTANT_NAME_MAX).collect()
}

fn assistant_of(user: &Value) -> Value {
    let a = user.get("assistant");
    let name = a
        .and_then(|a| a.get("name"))
        .and_then(Value::as_str)
        .map(clean_assistant_name)
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Brutus".to_string());
    let style = a
        .and_then(|a| a.get("style"))
        .and_then(Value::as_str)
        .filter(|s| ASSISTANT_STYLES.contains(s))
        .unwrap_or("concise");
    json!({ "name": name, "style": style })
}

/// The pinned skills per scope, strings only, blanks dropped. Carried through derive
/// because derive's output is the only config the app reads: a key it leaves out is a
/// key the app writes and then never sees again.
fn pinned_skills_of(user: &Value) -> Value {
    let list = |scope: &str| -> Vec<Value> {
        user.get("pinnedSkills")
            .and_then(|p| p.get(scope))
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .map(|n| json!(n))
            .collect()
    };
    json!({ "global": list("global"), "session": list("session") })
}

/// Pure config derivation (no I/O) — v2 only (migrate-on-launch handled separately).
///
/// **v2** generalises the old two-root model: `roots` is a named list (`{name,path}`)
/// and each category names the root it lives under (`root`), so the same category name
/// can exist under several roots. Reads raw v2 config (legacy fields ignored).
fn derive(user: &Value) -> Value {
    // v2 schema: roots is the single source of truth.
    let roots: Vec<(String, String, String)> = match user.get("roots").and_then(Value::as_array) {
        Some(arr) if !arr.is_empty() => arr
            .iter()
            .filter_map(|r| {
                let name = r.get("name").and_then(Value::as_str)?.trim().to_string();
                if name.is_empty() {
                    return None;
                }
                let path = expand(r.get("path").and_then(Value::as_str).unwrap_or(""));
                let vault_path = expand(r.get("vaultPath").and_then(Value::as_str).unwrap_or(""));
                Some((name, path, vault_path))
            })
            .collect(),
        _ => vec![], // Empty roots list is invalid; validate() will reject.
    };

    // Default fallback roots if none provided (for safety — the v2 schema requires roots).
    let roots = if roots.is_empty() {
        vec![
            ("Work".to_string(), expand("~/work"), "".to_string()),
            ("Perso".to_string(), expand("~"), "".to_string()),
        ]
    } else {
        roots
    };

    let root_path = |name: &str| roots.iter().find(|(n, _, _)| n == name).map(|(_, p, _)| p.clone());

    let cats_in = match user.get("categories") {
        Some(Value::Array(a)) if !a.is_empty() => a.clone(),
        _ => default_categories().as_array().unwrap().clone(),
    };
    // Each category must carry a `root` — no scope field in v2.
    let categories: Vec<Value> = cats_in
        .iter()
        .filter_map(|c| {
            let mut c = c.clone();
            let root_name = c.get("root").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
            match root_name {
                Some(r) => {
                    // Ensure the root exists; if not, use the first root (safety net).
                    if root_path(r).is_none() {
                        if let Some((first_root, _, _)) = roots.first() {
                            c["root"] = json!(first_root);
                        }
                    }
                    Some(c)
                }
                None => None, // Drop categories with no root.
            }
        })
        .collect();

    // `knowledge` is the current name; `obsidian` is read as legacy so an existing
    // config keeps working untouched. The feature was never Obsidian-specific — a vault is
    // a folder of Markdown, and Obsidian is only one way to browse it — and the old name
    // made users without Obsidian assume the whole thing wasn't for them.
    let know = user
        .get("knowledge")
        .or_else(|| user.get("obsidian"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let knowledge = json!({
        "enabled": know.get("enabled").and_then(Value::as_bool).unwrap_or(false),
    });

    let ticket_base = user
        .get("ticketBaseUrl")
        .or_else(|| user.get("jiraBaseUrl"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let terminal_app = user.get("terminalApp").and_then(Value::as_str).unwrap_or("").to_string();

    // Derive scanDirs (root's path + /<CAT>), order, colorMap.
    let mut scan_dirs = Vec::new();
    let mut order = Vec::new();
    let mut color_map = serde_json::Map::new();
    let first_root_path = roots.first().map(|(_, p, _)| p.clone()).unwrap_or_else(|| expand("~/work"));
    for c in &categories {
        let name = c.get("name").and_then(Value::as_str).unwrap_or("");
        if name.is_empty() {
            continue;
        }
        let root_name = c.get("root").and_then(Value::as_str).unwrap_or("Work");
        // Unknown root name (only via a hand-edited config — the GUI keeps roots +
        // categories in sync) → fall back to first root (v2 safety net).
        // aoconfig.py base_for_entry MUST match this exactly.
        let base_root = root_path(root_name).unwrap_or_else(|| first_root_path.clone());
        scan_dirs.push(json!({ "category": name, "base": format!("{base_root}/{name}"), "root": root_name }));
        order.push(Value::String(name.to_string()));
        color_map.insert(name.to_string(), c.get("color").cloned().unwrap_or(Value::Null));
    }

    let roots_out: Vec<Value> = roots
        .iter()
        .map(|(n, p, v)| {
            let mut obj = json!({ "name": n, "path": p });
            if !v.is_empty() {
                obj["vaultPath"] = json!(v);
            }
            obj
        })
        .collect();

    json!({
        "version": 2,
        "roots": roots_out,
        "categories": categories,
        "knowledge": knowledge,
        "ticketBaseUrl": ticket_base,
        // Empty = send no `--model`, so `claude` uses ~/.claude/settings.json. See
        // pty::model_flag: the app used to force opus[1m] and silently override it.
        "claudeModel": user.get("claudeModel").and_then(Value::as_str).unwrap_or("").trim(),
        "terminalApp": terminal_app,
        // Brutus: always present and already normalised, so no reader has to guess.
        "assistant": assistant_of(user),
        "pinnedSkills": pinned_skills_of(user),
        "scanDirs": scan_dirs,
        "order": order,
        "colorMap": Value::Object(color_map),
        // Exposed so the renderer can abbreviate absolute paths to ~/… for display.
        "home": home().to_string_lossy(),
    })
}

/// Validate a config — v2 schema only.
fn validate(c: &Value) -> Result<(), String> {
    // Roots (v2): each needs a non-empty label.
    let mut root_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    if let Some(roots) = c.get("roots").and_then(Value::as_array) {
        for r in roots {
            let name = r.get("name").and_then(Value::as_str).unwrap_or("");
            if name.trim().is_empty() || name.len() > 30 {
                return Err(format!("bad root name: {name}"));
            }
            root_names.insert(name.to_string());
        }
    }
    let cats = c
        .get("categories")
        .and_then(Value::as_array)
        .filter(|a| !a.is_empty())
        .ok_or("categories required")?;
    for cat in cats {
        let name = cat.get("name").and_then(Value::as_str).unwrap_or("");
        if name.is_empty()
            || name.len() > 20
            || !name.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
        {
            return Err(format!("bad category name: {name}"));
        }
        let color = cat.get("color").and_then(Value::as_str).unwrap_or("");
        if color.len() != 7
            || !color.starts_with('#')
            || !color[1..].chars().all(|ch| ch.is_ascii_hexdigit())
        {
            return Err(format!("bad color: {color}"));
        }
        // v2: category must carry a valid `root` that names a declared root.
        let cat_root = cat.get("root").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
        match cat_root {
            Some(r) if !root_names.is_empty() && !root_names.contains(r) => {
                return Err(format!("category '{name}' references unknown root '{r}'"));
            }
            Some(_) => {}
            None => return Err(format!("category '{name}' must carry a 'root' field")),
        }
    }
    if let Some(style) = c.get("assistant").and_then(|a| a.get("style")).and_then(Value::as_str) {
        if !ASSISTANT_STYLES.contains(&style) {
            return Err(format!("unknown assistant style: {style}"));
        }
    }
    Ok(())
}

/// Validate then atomically write the user config (shared atomic_write: tmp +
/// fsync + rename).
fn save(cfg: &Value) -> Result<(), String> {
    save_to(&config_path(), cfg)
}

/// Keys `derive()` computes rather than reads. Callers hand `set_config` the derived
/// config back, so these are dropped before the write: rebuilt on every load, a copy on
/// disk is only ever stale.
const DERIVED_KEYS: [&str; 4] = ["scanDirs", "order", "colorMap", "home"];

fn save_to(path: &Path, cfg: &Value) -> Result<(), String> {
    validate(cfg)?;
    let mut cfg = cfg.clone();
    if let Some(obj) = cfg.as_object_mut() {
        for key in DERIVED_KEYS {
            obj.remove(key);
        }
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    crate::atomic_write(path, &body)
}

/// Migrate v1 config to v2 on disk (idempotent, run-once at startup).
/// Triggered by the shape: if any legacy field is present AND not already flagged
/// `migratedToV2`, migrate the config and back up the original.
/// Returns Ok(true) if migration happened, Ok(false) if no migration was needed.
#[allow(dead_code)] // Will be called from lib.rs setup()
pub fn migrate_v1_if_needed() -> Result<bool, String> {
    let path = config_path();
    if !path.exists() {
        return Ok(false); // No config yet; will be seeded on first launch.
    }

    let raw = match fs::read_to_string(&path) {
        Ok(s) => match serde_json::from_str::<Value>(&s) {
            Ok(v) => v,
            Err(_) => return Ok(false), // Corrupt file; leave it alone.
        },
        Err(_) => return Ok(false), // Can't read; leave it alone.
    };

    let v2_config = match migrate_v1_value(&raw) {
        Some(v) => v,
        None => return Ok(false), // already v2 (flagged, or no legacy shape).
    };

    // Back up the original v1 config, then write the v2 config atomically.
    let backup_path = path.with_file_name("config.json.v1-backup");
    fs::copy(&path, &backup_path).map_err(|e| format!("failed to backup config: {e}"))?;
    save(&v2_config)?;

    Ok(true)
}

/// Pure v1→v2 transform (no I/O) — the migration logic, unit-testable in isolation.
/// Returns the v2 config to write, or `None` when `raw` is already v2 (flagged, or no
/// legacy shape). Detection is by SHAPE, not `version`, because settings.js wrote
/// `roots` AND the legacy scalars together under `version: 1`.
fn migrate_v1_value(raw: &Value) -> Option<Value> {
    // Already migrated → nothing to do.
    if raw.get("migratedToV2").and_then(Value::as_bool).unwrap_or(false) {
        return None;
    }

    // Detect a v1 config by shape: any legacy field present.
    let has_legacy = raw.get("workRoot").is_some()
        || raw.get("personalRoot").is_some()
        || raw
            .get("knowledge")
            .or_else(|| raw.get("obsidian"))
            .map(|o| o.get("workVaultPath").is_some() || o.get("personalVaultPath").is_some())
            .unwrap_or(false)
        || raw
            .get("categories")
            .and_then(Value::as_array)
            .map(|cats| cats.iter().any(|c| c.get("scope").is_some() && c.get("root").is_none()))
            .unwrap_or(false);
    if !has_legacy {
        return None; // already v2.
    }

    let work_root = expand(raw.get("workRoot").and_then(Value::as_str).unwrap_or("~/work"));
    let personal_root = expand(raw.get("personalRoot").and_then(Value::as_str).unwrap_or("~"));
    let work_vault = expand(
        raw.get("knowledge")
            .or_else(|| raw.get("obsidian"))
            .and_then(|o| o.get("workVaultPath").or_else(|| o.get("vaultPath")))
            .and_then(Value::as_str)
            .unwrap_or(""),
    );
    let personal_vault = expand(
        raw.get("knowledge")
            .or_else(|| raw.get("obsidian"))
            .and_then(|o| o.get("personalVaultPath"))
            .and_then(Value::as_str)
            .unwrap_or(""),
    );

    // Prefer an existing v2 `roots` list — a present list (custom names, >2 spaces, real
    // paths) must NOT be discarded and rebuilt from the scalars (that would reset a
    // customized Work path to the ~/work default). Synthesize Work/Perso only when absent.
    let mut v2_roots: Vec<Value> = match raw.get("roots").and_then(Value::as_array) {
        Some(rs) if !rs.is_empty() => rs.clone(),
        _ => vec![
            json!({ "name": "Work", "path": work_root }),
            json!({ "name": "Perso", "path": personal_root }),
        ],
    };
    // Fold the legacy work/personal vault split onto the matching root by name,
    // without clobbering a vaultPath a root already carries.
    for r in v2_roots.iter_mut() {
        if let Some(obj) = r.as_object_mut() {
            let has_vault =
                obj.get("vaultPath").and_then(Value::as_str).is_some_and(|s| !s.is_empty());
            if !has_vault {
                let v = match obj.get("name").and_then(Value::as_str).unwrap_or("") {
                    "Work" => work_vault.as_str(),
                    "Perso" => personal_vault.as_str(),
                    _ => "",
                };
                if !v.is_empty() {
                    obj.insert("vaultPath".to_string(), json!(v));
                }
            }
        }
    }

    // Categories: migrate `scope` → `root` when root is absent; drop `scope`. The root
    // must be one the config declares, or validate() rejects the migration at every
    // launch: the root at workRoot/personalRoot, else the first/second declared root.
    let (work_name, personal_name) = scope_roots(&v2_roots, &work_root, &personal_root);
    let mut v2_cats: Vec<Value> = vec![];
    if let Some(cats) = raw.get("categories").and_then(Value::as_array) {
        for cat in cats {
            let mut c = cat.clone();
            if c.get("root").is_none() {
                let scope = c.get("scope").and_then(Value::as_str).unwrap_or("work");
                c["root"] = json!(if scope == "personal" { &personal_name } else { &work_name });
            }
            if let Some(obj) = c.as_object_mut() {
                obj.remove("scope");
            }
            v2_cats.push(c);
        }
    }

    Some(json!({
        "version": 2,
        "roots": v2_roots,
        "categories": v2_cats,
        "knowledge": { "enabled": raw.get("knowledge").or_else(|| raw.get("obsidian"))
            .and_then(|o| o.get("enabled")).cloned().unwrap_or(json!(false)) },
        "ticketBaseUrl": raw.get("ticketBaseUrl").cloned().unwrap_or(json!("")),
        "claudeModel": raw.get("claudeModel").cloned().unwrap_or(json!("")),
        "terminalApp": raw.get("terminalApp").cloned().unwrap_or(json!("")),
        "migratedToV2": true,
    }))
}

/// The declared roots a v1 `scope` of "work" and "personal" map to, by name.
fn scope_roots(roots: &[Value], work_path: &str, personal_path: &str) -> (String, String) {
    let name = |r: &Value| r.get("name").and_then(Value::as_str).unwrap_or("").to_string();
    let pick = |path: &str, index: usize, taken: Option<&str>| -> String {
        let by_path = roots.iter().map(name).zip(roots.iter()).find(|(n, r)| {
            Some(n.as_str()) != taken
                && r.get("path").and_then(Value::as_str).map(expand).as_deref() == Some(path)
        });
        if let Some((n, _)) = by_path {
            return n;
        }
        roots.get(index).or_else(|| roots.first()).map(name).unwrap_or_default()
    };
    let work = pick(work_path, 0, None);
    let personal = pick(personal_path, 1, Some(&work));
    (work, personal)
}

/// The default config written on a fresh install (v2 schema). Kept in sync with the
/// seed in `scripts/install.sh` — the two install paths (git clone + the in-app
/// skills installer) must produce the same starting config.
pub fn default_config() -> Value {
    json!({
        "version": 2,
        "roots": [
            { "name": "Work",  "path": "~/work", "vaultPath": "" },
            { "name": "Perso", "path": "~", "vaultPath": "" }
        ],
        "categories": [
            { "name": "FEAT",   "color": "#7df0c0", "root": "Work" },
            { "name": "BUG",    "color": "#ff9eb1", "root": "Work" },
            { "name": "REVIEW", "color": "#d9a86e", "root": "Work" },
            { "name": "CHORE",  "color": "#ffe17a", "root": "Work" },
            { "name": "TEST",   "color": "#cdd0d6", "root": "Work" },
            { "name": "PERSO",  "color": "#8fd9ff", "root": "Perso" }
        ],
        "knowledge": { "enabled": false },
        "skillProposals": true,
        "ticketBaseUrl": ""
    })
}

/// Write the default config if none exists yet. Returns whether a file was written.
/// Used by the in-app skills installer so a `.dmg`-only user gets a working config
/// (the skills' Python helper reads the raw file from disk).
pub fn seed_default_if_absent() -> Result<bool, String> {
    if config_path().exists() {
        return Ok(false);
    }
    save(&default_config())?;
    Ok(true)
}

/// Absolute base dir for every configured category (`<root path>/<CAT>`), so the
/// installer can pre-create them (mirrors `install.sh` step 4). Reads the derived
/// `scanDirs`, so root resolution stays single-sourced in `derive()`.
pub fn category_base_dirs() -> Vec<PathBuf> {
    load()
        .get("scanDirs")
        .and_then(Value::as_array)
        .map(|dirs| {
            dirs.iter()
                .filter_map(|d| d.get("base").and_then(Value::as_str))
                .map(PathBuf::from)
                .collect()
        })
        .unwrap_or_default()
}

/// First-run setup keeps its own marker file rather than a key in `config.json`:
/// `derive()` rebuilds a fixed object, so any key it does not name is dropped from the
/// config the Settings pane sends back — `skillProposals` already survives only because
/// nothing round-trips it. A flag that decides whether a wizard opens cannot depend on
/// that.
fn onboarding_marker_path() -> PathBuf {
    config_dir().join("onboarded")
}

pub fn onboarding_marked() -> bool {
    onboarding_marker_path().exists()
}

pub fn mark_onboarded() -> Result<(), String> {
    let path = onboarding_marker_path();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    crate::atomic_write(&path, "")
}

/// Whether to open first-run setup. An absent marker is NOT enough: every install that
/// predates the wizard has one, and those users already have their sessions in the app.
/// Offering to import for someone with a populated registry would be a wizard about work
/// they finished long ago — so a non-empty registry counts as setup already done.
pub fn onboarding_needed(marked: bool, managed_sessions: usize) -> bool {
    !marked && managed_sessions == 0
}

#[tauri::command]
pub fn get_config() -> Value {
    load()
}

#[tauri::command]
pub fn set_config(cfg: Value) -> Result<(), String> {
    save(&cfg)
}

#[cfg(test)]
mod tests {
    use super::{
        clean_assistant_name, default_config, derive, migrate_v1_value, onboarding_needed, save_to, validate,
    };
    use serde_json::json;

    // The in-app skills installer seeds default_config() via save() → validate() on first
    // launch. If it didn't validate, install would copy the skills then error out — so lock
    // the invariant here (this path otherwise only runs on a real first launch).
    // The rule that keeps the wizard away from the people who least need it: her own
    // install has no marker (it predates the feature) and 113 managed sessions.
    #[test]
    fn assistant_defaults_to_brutus_concise_and_normalises_what_it_is_given() {
        let d = derive(&default_config());
        assert_eq!(d["assistant"], json!({ "name": "Brutus", "style": "concise" }));

        let mut c = default_config();
        c["assistant"] = json!({ "name": "  Jarvis\u{7}  ", "style": "nerdy" });
        assert_eq!(derive(&c)["assistant"], json!({ "name": "Jarvis", "style": "nerdy" }));

        c["assistant"] = json!({ "name": "", "style": "shouty" });
        assert_eq!(derive(&c)["assistant"], json!({ "name": "Brutus", "style": "concise" }),
            "an empty name and an unknown style fall back, never pass through");
    }

    #[test]
    fn assistant_name_is_capped_at_24_characters_not_bytes() {
        let long = "Ééééééééééééééééééééééééééé"; // 27 two-byte chars
        assert_eq!(clean_assistant_name(long).chars().count(), 24);
    }

    #[test]
    fn validate_rejects_an_unknown_assistant_style() {
        let mut c = default_config();
        c["assistant"] = json!({ "name": "B", "style": "shouty" });
        assert!(validate(&c).is_err());
        c["assistant"]["style"] = json!("casual");
        assert!(validate(&c).is_ok());
        c["assistant"]["style"] = json!("sarcastic");
        assert!(validate(&c).is_ok(), "the fifth style, asked for on 2026-09-23");
        assert_eq!(derive(&c)["assistant"]["style"], "sarcastic");
    }

    // Shipped: the renderer wrote pinnedSkills into config.json, and derive() — whose output
    // is the only config the app ever reads — did not carry the key, so every pinned skill
    // vanished at the next read. They survive a read now, blanks dropped.
    #[test]
    fn pinned_skills_survive_a_read() {
        let mut c = default_config();
        c["pinnedSkills"] = json!({ "global": ["route", ""], "session": ["learn", 7] });
        assert_eq!(derive(&c)["pinnedSkills"], json!({ "global": ["route"], "session": ["learn"] }));
        assert_eq!(derive(&default_config())["pinnedSkills"], json!({ "global": [], "session": [] }));
    }

    #[test]
    fn onboarding_opens_only_for_an_install_with_nothing_in_it() {
        assert!(onboarding_needed(false, 0), "fresh install → the wizard opens");
        assert!(!onboarding_needed(false, 113), "pre-wizard install with sessions → never");
        assert!(!onboarding_needed(true, 0), "already run → never again on its own");
        assert!(!onboarding_needed(true, 5));
    }

    #[test]
    fn default_config_passes_validation() {
        assert!(validate(&default_config()).is_ok());
    }

    // derive() must also accept the seed and produce v2 with both roots + a scanDir per category.
    #[test]
    fn default_config_derives_cleanly() {
        let d = derive(&default_config());
        assert_eq!(d["version"], 2);
        assert_eq!(d["roots"].as_array().unwrap().len(), 2);
        assert_eq!(d["scanDirs"].as_array().unwrap().len(), 6);
    }

    // The skill-learning loop (skillProposals) ships on: a fresh install must not require
    // finding and hand-setting a key that appears nowhere in Settings to get the product's
    // own default behaviour.
    #[test]
    fn default_config_ships_skill_proposals_on() {
        assert_eq!(default_config()["skillProposals"], true);
    }


    // The `obsidian` → `knowledge` rename must never break an existing config: the legacy
    // key is still read, and the derived output only ever carries the new name.
    #[test]
    fn knowledge_reads_the_legacy_obsidian_key_and_emits_the_new_name() {
        let legacy = json!({
            "roots": [{"name":"Work","path":"/w"}],
            "categories": [{"name":"FEAT","color":"#aaaaaa","root":"Work"}],
            "obsidian": { "enabled": true }
        });
        let d = derive(&legacy);
        assert_eq!(d["knowledge"]["enabled"], true, "legacy obsidian.enabled honoured");
        assert!(d.get("obsidian").is_none(), "derived config drops the legacy name");

        // The new name wins when both are present (a half-migrated file).
        let both = json!({
            "roots": [{"name":"Work","path":"/w"}],
            "categories": [{"name":"FEAT","color":"#aaaaaa","root":"Work"}],
            "knowledge": { "enabled": true },
            "obsidian": { "enabled": false }
        });
        assert_eq!(derive(&both)["knowledge"]["enabled"], true);

        // Neither present → off, as before.
        let neither = json!({
            "roots": [{"name":"Work","path":"/w"}],
            "categories": [{"name":"FEAT","color":"#aaaaaa","root":"Work"}]
        });
        assert_eq!(derive(&neither)["knowledge"]["enabled"], false);
    }

    #[test]
    fn derive_v2_allows_same_category_under_two_roots() {
        let v2 = json!({
            "roots": [{"name":"Work","path":"/w"},{"name":"Perso","path":"/p"}],
            "categories": [
                {"name":"AI-SYSTEM","color":"#aaaaaa","root":"Work"},
                {"name":"AI-SYSTEM","color":"#bbbbbb","root":"Perso"}
            ]
        });
        let d = derive(&v2);
        let bases: Vec<&str> = d["scanDirs"].as_array().unwrap().iter()
            .filter(|s| s["category"] == "AI-SYSTEM")
            .map(|s| s["base"].as_str().unwrap())
            .collect();
        assert!(bases.contains(&"/w/AI-SYSTEM"), "Work AI-SYSTEM scanned");
        assert!(bases.contains(&"/p/AI-SYSTEM"), "Perso AI-SYSTEM scanned"); // same name, two roots
        assert!(validate(&v2).is_ok());
    }

    #[test]
    fn derive_empty_roots_list_gets_default_work_perso() {
        // Empty roots list (v2 only) → derive returns default Work/Perso roots (safety net).
        let cfg = json!({
            "categories": [
                {"name":"FEAT","color":"#7df0c0","root":"Work"}
            ]
        });
        // Without roots list, validation doesn't cross-check the root name.
        assert!(validate(&cfg).is_ok());
        let d = derive(&cfg);
        let roots = d["roots"].as_array().unwrap();
        // derive() fills in default Work/Perso.
        assert_eq!(roots.len(), 2);
        assert!(roots.iter().any(|r| r["name"] == "Work"));
        assert!(roots.iter().any(|r| r["name"] == "Perso"));
    }

    #[test]
    fn validate_rejects_category_root_not_in_roots_list() {
        // A category referencing a root that isn't declared → rejected.
        let bad = json!({
            "roots": [{"name":"Work","path":"/w"},{"name":"Perso","path":"/p"}],
            "categories": [{"name":"FEAT","color":"#7df0c0","root":"Wok"}]
        });
        assert!(validate(&bad).is_err());
        // The same config with the correct root name validates.
        let good = json!({
            "roots": [{"name":"Work","path":"/w"},{"name":"Perso","path":"/p"}],
            "categories": [{"name":"FEAT","color":"#7df0c0","root":"Work"}]
        });
        assert!(validate(&good).is_ok());
    }

    #[test]
    fn validate_rejects_category_without_root() {
        // v2: category must carry a root.
        let no_root = json!({
            "roots": [{"name":"Work","path":"/w"},{"name":"Perso","path":"/p"}],
            "categories": [{"name":"FEAT","color":"#7df0c0"}]
        });
        assert!(validate(&no_root).is_err());
    }

    // Migration tests (v1 → v2 on disk).

    #[test]
    fn migrate_v1_value_migrates_pure_v1() {
        // Pure v1 (no `roots`): synthesize Work/Perso from the scalars, fold vaults,
        // scope→root, drop scope, set flag. The output must validate as v2.
        let v1 = json!({
            "version": 1,
            "workRoot": "/w",
            "personalRoot": "/p",
            "categories": [
                {"name":"FEAT","color":"#7df0c0","scope":"work"},
                {"name":"PERSO","color":"#8fd9ff","scope":"personal"}
            ],
            "obsidian": { "enabled": true, "workVaultPath": "/w/vault", "personalVaultPath": "/p/vault" }
        });
        let v2 = migrate_v1_value(&v1).expect("pure v1 must migrate");
        let roots = v2["roots"].as_array().unwrap();
        assert_eq!(roots[0]["name"], "Work");
        assert_eq!(roots[0]["path"], "/w");
        assert_eq!(roots[0]["vaultPath"], "/w/vault");
        assert_eq!(roots[1]["vaultPath"], "/p/vault");
        assert_eq!(v2["categories"][0]["root"], "Work");
        assert_eq!(v2["categories"][1]["root"], "Perso");
        assert!(v2["categories"][0].get("scope").is_none());
        assert_eq!(v2["migratedToV2"], json!(true));
        assert!(validate(&v2).is_ok());
    }

    #[test]
    fn migrate_v1_value_preserves_an_existing_roots_list() {
        // Regression guard: settings.js wrote `roots` AND the legacy scalars together.
        // Migration must KEEP the existing roots (custom paths, extra spaces) rather than
        // rebuild plain Work/Perso from workRoot/personalRoot. Vaults fold onto the
        // matching root by name.
        let v1 = json!({
            "version": 1,
            "roots": [
                {"name":"Work","path":"/custom/tomtom"},
                {"name":"Perso","path":"/home/me"},
                {"name":"Side","path":"/side/projects"}
            ],
            "workRoot": "/w-drifted",       // stale — must be ignored
            "personalRoot": "/p-drifted",   // stale — must be ignored
            "categories": [{"name":"FEAT","color":"#7df0c0","root":"Work"}],
            "obsidian": { "enabled": true, "workVaultPath": "/tt/vault", "personalVaultPath": "/me/vault" }
        });
        let v2 = migrate_v1_value(&v1).expect("legacy-tainted v2 must migrate");
        let roots = v2["roots"].as_array().unwrap();
        assert_eq!(roots.len(), 3, "the custom roots list must be preserved, not rebuilt");
        assert_eq!(roots[0]["path"], "/custom/tomtom", "Work path must NOT reset to workRoot/~work");
        assert_eq!(roots[2]["name"], "Side", "extra spaces must survive");
        assert_eq!(roots[0]["vaultPath"], "/tt/vault", "workVaultPath folds onto Work");
        assert_eq!(roots[1]["vaultPath"], "/me/vault", "personalVaultPath folds onto Perso");
        assert!(roots[2].get("vaultPath").is_none(), "a non-Work/Perso root gets no vault");
        assert_eq!(v2["migratedToV2"], json!(true));
        assert!(validate(&v2).is_ok());
    }

    #[test]
    fn migrate_v1_value_maps_scope_onto_custom_named_roots() {
        // Custom-named roots with scope-only categories: scope must land on a root that
        // exists, never on a "Work"/"Perso" the config does not declare. The path match
        // wins over the position.
        let v1 = json!({
            "version": 1,
            "roots": [
                {"name":"Side","path":"/side"},
                {"name":"Job","path":"/job"},
                {"name":"Home","path":"/home/me"}
            ],
            "workRoot": "/job",
            "personalRoot": "/home/me",
            "categories": [
                {"name":"FEAT","color":"#7df0c0","scope":"work"},
                {"name":"PERSO","color":"#8fd9ff","scope":"personal"}
            ]
        });
        let v2 = migrate_v1_value(&v1).expect("scope-only categories must migrate");
        assert_eq!(v2["categories"][0]["root"], "Job");
        assert_eq!(v2["categories"][1]["root"], "Home");
        assert!(validate(&v2).is_ok(), "{:?}", validate(&v2));

        // No path matches: fall back to the first and second declared roots.
        let drifted = json!({
            "version": 1,
            "roots": [{"name":"Job","path":"/job"}, {"name":"Home","path":"/home/me"}],
            "workRoot": "/elsewhere",
            "personalRoot": "/nowhere",
            "categories": [
                {"name":"FEAT","color":"#7df0c0","scope":"work"},
                {"name":"PERSO","color":"#8fd9ff","scope":"personal"}
            ]
        });
        let v2 = migrate_v1_value(&drifted).expect("must migrate");
        assert_eq!(v2["categories"][0]["root"], "Job");
        assert_eq!(v2["categories"][1]["root"], "Home");
        assert!(validate(&v2).is_ok(), "{:?}", validate(&v2));
    }

    // Settings and the board send back the config they were given, which is the DERIVED
    // one. What reaches the file must still be only what the user sets: the computed keys
    // are rebuilt on every load, and a stale copy on disk only misleads.
    #[test]
    fn saving_a_derived_config_writes_only_persisted_keys() {
        let dir = std::env::temp_dir().join(format!("ao-config-save-{}", std::process::id()));
        let path = dir.join("config.json");
        let derived = derive(&default_config());
        let saved = save_to(&path, &derived);
        let on_disk: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap_or_default()).unwrap_or_default();
        let _ = std::fs::remove_dir_all(&dir);

        assert!(saved.is_ok(), "{saved:?}");
        for key in ["scanDirs", "order", "colorMap", "home"] {
            assert!(on_disk.get(key).is_none(), "{key} was written to disk");
        }
        assert_eq!(derive(&on_disk), derived);
    }

    #[test]
    fn migrate_v1_value_skips_already_v2() {
        // Flagged, or a clean v2 with no legacy shape → no migration (idempotent).
        let flagged = json!({ "version": 2, "roots": [{"name":"Work","path":"/w"}], "migratedToV2": true });
        assert!(migrate_v1_value(&flagged).is_none());
        let clean_v2 = json!({
            "version": 2,
            "roots": [{"name":"Work","path":"/w","vaultPath":""}],
            "categories": [{"name":"FEAT","color":"#7df0c0","root":"Work"}],
            "obsidian": {"enabled": false}
        });
        assert!(migrate_v1_value(&clean_v2).is_none(), "no legacy shape → not migrated");
    }
}
