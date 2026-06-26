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

fn config_path() -> PathBuf {
    home().join(".config").join("ai-agents-orchestrator").join("config.json")
}

/// Expand a leading `~` / `~/` to the home directory (empty/other strings pass through).
fn expand(p: &str) -> String {
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
        {"name":"FEAT","color":"#7df0c0","scope":"work"},
        {"name":"BUG","color":"#ff9eb1","scope":"work"},
        {"name":"REVIEW","color":"#d9a86e","scope":"work"},
        {"name":"CHORE","color":"#ffe17a","scope":"work"},
        {"name":"TEST","color":"#cdd0d6","scope":"work"},
        {"name":"PERSO","color":"#8fd9ff","scope":"personal"}
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

/// Pure config derivation (no I/O) — merges over defaults and migrates v1 → v2.
///
/// **v2** generalises the old two-root model: `roots` is a named list (`{name,path}`)
/// and each category names the root it lives under (`root`), so the same category name
/// can exist under several roots. **v1** (`workRoot`/`personalRoot` + a category `scope`
/// of work|personal) is migrated: roots → `Work` + `Perso`, `scope` → `root`. Legacy
/// fields (workRoot/personalRoot, category `scope`) are kept in the output so existing
/// renderer/skill code keeps working until it's moved over to roots.
fn derive(user: &Value) -> Value {
    let work_root = expand(user.get("workRoot").and_then(Value::as_str).unwrap_or("~/work"));
    let personal_root = expand(user.get("personalRoot").and_then(Value::as_str).unwrap_or("~"));

    // Roots: explicit v2 list, else migrate the two v1 roots to Work + Perso.
    let roots: Vec<(String, String)> = match user.get("roots").and_then(Value::as_array) {
        Some(arr) if !arr.is_empty() => arr
            .iter()
            .filter_map(|r| {
                let name = r.get("name").and_then(Value::as_str)?.trim().to_string();
                if name.is_empty() {
                    return None;
                }
                Some((name, expand(r.get("path").and_then(Value::as_str).unwrap_or(""))))
            })
            .collect(),
        _ => vec![
            ("Work".to_string(), work_root.clone()),
            ("Perso".to_string(), personal_root.clone()),
        ],
    };
    let root_path = |name: &str| roots.iter().find(|(n, _)| n == name).map(|(_, p)| p.clone());

    let cats_in = match user.get("categories") {
        Some(Value::Array(a)) if !a.is_empty() => a.clone(),
        _ => default_categories().as_array().unwrap().clone(),
    };
    // Each category gets a `root` (migrated from `scope` when absent); `scope` is kept.
    let categories: Vec<Value> = cats_in
        .iter()
        .map(|c| {
            let mut c = c.clone();
            let has_root = c.get("root").and_then(Value::as_str).is_some_and(|s| !s.is_empty());
            if !has_root {
                let scope = c.get("scope").and_then(Value::as_str).unwrap_or("work");
                c["root"] = json!(if scope == "personal" { "Perso" } else { "Work" });
            }
            c
        })
        .collect();

    let obs = user.get("obsidian").cloned().unwrap_or_else(|| json!({}));
    let obsidian = json!({
        "enabled": obs.get("enabled").and_then(Value::as_bool).unwrap_or(false),
        "workVaultPath": expand(obs.get("workVaultPath").and_then(Value::as_str)
            .or_else(|| obs.get("vaultPath").and_then(Value::as_str)).unwrap_or("")),
        "personalVaultPath": expand(obs.get("personalVaultPath").and_then(Value::as_str).unwrap_or("")),
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
    for c in &categories {
        let name = c.get("name").and_then(Value::as_str).unwrap_or("");
        if name.is_empty() {
            continue;
        }
        let root_name = c.get("root").and_then(Value::as_str).unwrap_or("Work");
        // Unknown root name (only via a hand-edited config — the GUI keeps roots +
        // categories in sync) → fall back to work_root. aoconfig.py base_for_entry MUST
        // match this exactly, else the scanner and the skills resolve different dirs.
        let base_root = root_path(root_name).unwrap_or_else(|| work_root.clone());
        scan_dirs.push(json!({ "category": name, "base": format!("{base_root}/{name}"), "root": root_name }));
        order.push(Value::String(name.to_string()));
        color_map.insert(name.to_string(), c.get("color").cloned().unwrap_or(Value::Null));
    }

    let roots_out: Vec<Value> = roots.iter().map(|(n, p)| json!({ "name": n, "path": p })).collect();

    json!({
        "version": 2,
        "roots": roots_out,
        // Kept for back-compat with code not yet moved to `roots`.
        "workRoot": work_root,
        "personalRoot": personal_root,
        "categories": categories,
        "obsidian": obsidian,
        "ticketBaseUrl": ticket_base,
        "terminalApp": terminal_app,
        "scanDirs": scan_dirs,
        "order": order,
        "colorMap": Value::Object(color_map),
        // Exposed so the renderer can abbreviate absolute paths to ~/… for display.
        "home": home().to_string_lossy(),
    })
}

/// Validate a config (mirrors the JS validate) — the regex gate is the real guard.
fn validate(c: &Value) -> Result<(), String> {
    // Roots (v2): each needs a non-empty label (the path is user-chosen, like workRoot).
    // Collect the declared root names so a category can't reference a non-existent root.
    let mut root_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    let has_roots_list = c.get("roots").and_then(Value::as_array).is_some();
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
        // Location: a v2 `root` label, or a legacy `scope` of work|personal.
        let cat_root = cat.get("root").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty());
        match cat_root {
            // A `root` must name a declared root (when a roots list is present) — a
            // typo'd root would silently tag sessions to a non-existent root and hide
            // them under every filter (audit finding #5).
            Some(r) if has_roots_list && !root_names.contains(r) => {
                return Err(format!("category '{name}' references unknown root '{r}'"));
            }
            Some(_) => {}
            None => match cat.get("scope").and_then(Value::as_str) {
                Some("work") | Some("personal") => {}
                other => return Err(format!("bad scope: {}", other.unwrap_or(""))),
            },
        }
    }
    Ok(())
}

/// Validate then atomically write the user config.
fn save(cfg: &Value) -> Result<(), String> {
    validate(cfg)?;
    let path = config_path();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(&tmp, body).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

/// The default config written on a fresh install (v2 schema). Kept in sync with the
/// seed in `scripts/install.sh` — the two install paths (git clone + the in-app
/// skills installer) must produce the same starting config.
pub fn default_config() -> Value {
    json!({
        "version": 2,
        "roots": [
            { "name": "Work",  "path": "~/work" },
            { "name": "Perso", "path": "~" }
        ],
        "categories": [
            { "name": "FEAT",   "color": "#7df0c0", "root": "Work" },
            { "name": "BUG",    "color": "#ff9eb1", "root": "Work" },
            { "name": "REVIEW", "color": "#d9a86e", "root": "Work" },
            { "name": "CHORE",  "color": "#ffe17a", "root": "Work" },
            { "name": "TEST",   "color": "#cdd0d6", "root": "Work" },
            { "name": "PERSO",  "color": "#8fd9ff", "root": "Perso" }
        ],
        "obsidian": { "enabled": false, "workVaultPath": "", "personalVaultPath": "" },
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
    use super::{default_config, derive, validate};
    use serde_json::json;

    // The in-app skills installer seeds default_config() via save() → validate() on first
    // launch. If it didn't validate, install would copy the skills then error out — so lock
    // the invariant here (this path otherwise only runs on a real first launch).
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

    #[test]
    fn derive_migrates_v1_scope_to_named_roots() {
        let v1 = json!({
            "workRoot": "/w", "personalRoot": "/p",
            "categories": [
                {"name":"FEAT","color":"#7df0c0","scope":"work"},
                {"name":"PERSO","color":"#8fd9ff","scope":"personal"}
            ]
        });
        let d = derive(&v1);
        assert_eq!(d["version"], 2);
        let roots = d["roots"].as_array().unwrap();
        assert!(roots.iter().any(|r| r["name"] == "Work" && r["path"] == "/w"));
        assert!(roots.iter().any(|r| r["name"] == "Perso" && r["path"] == "/p"));
        // scope migrated to root + scanDirs use the matching root path
        let sd = d["scanDirs"].as_array().unwrap();
        let feat = sd.iter().find(|s| s["category"] == "FEAT").unwrap();
        assert_eq!(feat["base"], "/w/FEAT");
        assert_eq!(feat["root"], "Work");
        let perso = sd.iter().find(|s| s["category"] == "PERSO").unwrap();
        assert_eq!(perso["base"], "/p/PERSO");
        assert_eq!(perso["root"], "Perso");
        assert!(validate(&v1).is_ok());
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
    fn derive_same_name_two_roots_without_explicit_roots_list() {
        // What the Settings UI saves for "AI-SYSTEM under both Work and Perso": two
        // categories carrying `root`, NO explicit `roots` array — derive must migrate
        // Work/Perso from workRoot/personalRoot and emit a scanDir for each.
        let cfg = json!({
            "workRoot": "/w", "personalRoot": "/p",
            "categories": [
                {"name":"AI-SYSTEM","color":"#aaaaaa","root":"Work"},
                {"name":"AI-SYSTEM","color":"#bbbbbb","root":"Perso"}
            ]
        });
        assert!(validate(&cfg).is_ok());   // no roots list ⇒ root not cross-checked
        let d = derive(&cfg);
        let dirs: Vec<(&str, &str)> = d["scanDirs"].as_array().unwrap().iter()
            .filter(|s| s["category"] == "AI-SYSTEM")
            .map(|s| (s["base"].as_str().unwrap(), s["root"].as_str().unwrap()))
            .collect();
        assert!(dirs.contains(&("/w/AI-SYSTEM", "Work")));
        assert!(dirs.contains(&("/p/AI-SYSTEM", "Perso")));
        assert_eq!(dirs.len(), 2);
    }

    #[test]
    fn validate_rejects_category_root_not_in_roots_list() {
        // A category referencing a root that isn't declared → rejected (would silently
        // tag sessions to a non-existent root and hide them under every filter).
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
        // v1 (no roots list): a category root isn't cross-checked (back-compat).
        let v1 = json!({
            "categories": [{"name":"FEAT","color":"#7df0c0","scope":"work"}]
        });
        assert!(validate(&v1).is_ok());
    }
}
