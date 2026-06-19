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

/// Read + merge + derive the config from disk (uncached).
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

    let work_root = expand(user.get("workRoot").and_then(Value::as_str).unwrap_or("~/work"));
    let personal_root = expand(user.get("personalRoot").and_then(Value::as_str).unwrap_or("~"));

    let categories = match user.get("categories") {
        Some(Value::Array(a)) if !a.is_empty() => Value::Array(a.clone()),
        _ => default_categories(),
    };

    let obs = user.get("obsidian").cloned().unwrap_or_else(|| json!({}));
    let obsidian = json!({
        "enabled": obs.get("enabled").and_then(Value::as_bool).unwrap_or(false),
        // migrate the legacy single `vaultPath` → work vault
        "workVaultPath": expand(obs.get("workVaultPath").and_then(Value::as_str)
            .or_else(|| obs.get("vaultPath").and_then(Value::as_str)).unwrap_or("")),
        "personalVaultPath": expand(obs.get("personalVaultPath").and_then(Value::as_str).unwrap_or("")),
    });

    // Tracker-neutral URL prefix for clickable ticket IDs (Jira, Linear, GitHub
    // Issues, Azure DevOps…). Accept the legacy `jiraBaseUrl` key for old configs.
    let ticket_base = user
        .get("ticketBaseUrl")
        .or_else(|| user.get("jiraBaseUrl"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    // Selector for which terminal "Resume"/+New/Restart launch into (matched to a
    // strict allowlist at launch in lib.rs; "" = system default). Passed through verbatim.
    let terminal_app = user.get("terminalApp").and_then(Value::as_str).unwrap_or("").to_string();

    // Derive scanDirs (work → workRoot/<CAT>, personal → personalRoot/<CAT>), order, colorMap.
    let mut scan_dirs = Vec::new();
    let mut order = Vec::new();
    let mut color_map = serde_json::Map::new();
    if let Value::Array(cats) = &categories {
        for c in cats {
            let name = c.get("name").and_then(Value::as_str).unwrap_or("");
            if name.is_empty() {
                continue;
            }
            let scope = c.get("scope").and_then(Value::as_str).unwrap_or("work");
            let root = if scope == "personal" { &personal_root } else { &work_root };
            scan_dirs.push(json!({ "category": name, "base": format!("{root}/{name}") }));
            order.push(Value::String(name.to_string()));
            color_map.insert(name.to_string(), c.get("color").cloned().unwrap_or(Value::Null));
        }
    }

    json!({
        "version": 1,
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
        match cat.get("scope").and_then(Value::as_str) {
            Some("work") | Some("personal") => {}
            other => return Err(format!("bad scope: {}", other.unwrap_or(""))),
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

#[tauri::command]
pub fn get_config() -> Value {
    load()
}

#[tauri::command]
pub fn set_config(cfg: Value) -> Result<(), String> {
    save(&cfg)
}
