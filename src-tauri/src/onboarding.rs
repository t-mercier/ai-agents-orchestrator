//! First-run setup's backend: the commands the wizard calls, and the one write path it
//! drives — a headless `/import-session` per ticked session, with the rollback that keeps
//! a half-done import from blocking every retry.
//!
//! Pulled out of lib.rs on 2026-09-09 by the boundary audit's "lib.rs is not a home for
//! commands" rule: these five had accumulated there by default, not by decision. What
//! stays in lib.rs is what more than one domain needs (`is_deletable_session_dir` is
//! shared with the delete path; `WRAP_TIMEOUT` with wrap_session).

use crate::{
    category_root_dir, config, is_deletable_session_dir, is_safe_category, is_valid_session_id,
    pty, reader, sanitize_session_name, slugify, validate_root_override, WRAP_TIMEOUT,
};

/// Where to resume an import from, and the skill invocation that writes its notes.md.
/// (The interactive import this used to share with went in 0.12.0; kept separate so the
/// prompt is built in exactly one place.)
fn import_invocation(session_id: &str, category: &str, safe_name: &str, want_root: &str) -> (String, String) {
    let dir = reader::resolve_session_cwd(session_id)
        .unwrap_or_else(|| config::home().to_string_lossy().into_owned());
    let mut prompt = if safe_name.is_empty() {
        format!("/import-session {category}")
    } else {
        format!("/import-session {category} {safe_name}")
    };
    if !want_root.is_empty() {
        prompt.push_str(&format!(" --root {want_root}"));
    }
    (dir, prompt)
}

/// Which of these paths resolve. Batched: first-run setup checks every configured space
/// in one round-trip, and a space pointing at a folder that does not exist is the single
/// likeliest thing wrong on a fresh install — the seed ships `Work` → `~/work`.
#[tauri::command]
pub fn paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| config::expand(p)).map(|p| std::path::Path::new(&p).exists()).collect()
}

/// Does first-run setup need to open? Asked once, at launch.
#[tauri::command]
pub fn needs_onboarding() -> bool {
    let managed = reader::load_active_sessions()
        .as_object()
        .map_or(0, serde_json::Map::len);
    config::onboarding_needed(config::onboarding_marked(), managed)
}

/// Called when the wizard closes — finished OR skipped. Skipping still marks it: the rescue
/// entry in Settings is what brings it back, so re-opening it unasked at every launch would
/// just be nagging someone who already said no.
#[tauri::command]
pub fn finish_onboarding() -> Result<(), String> {
    config::mark_onboarded()
}

/// The `notes.md` the /import-session skill WILL create, predicted the way embedded
/// `start_session` predicts its own: `<base>/<CATEGORY>/<folder>/notes.md`. `base` is the
/// chosen space when one is given (a category can sit under several), otherwise the
/// category's own root. `folder` mirrors the skill's fallback for a name that slugifies to
/// nothing: `imported-<first 8 of the session id>`.
///
/// Used to clean up after a half-done import. The skill writes the notes (Step 5) BEFORE it
/// registers the session (Step 6), so a run that dies between the two leaves a notes.md no
/// registry entry points at — and the skill's own "Already managed" guard then refuses every
/// retry. Predicting the path is what lets the failure path undo it.
pub(crate) fn import_notes_path(
    cfg: &serde_json::Value,
    category: &str,
    safe_name: &str,
    want_root: &str,
    session_id: &str,
) -> Option<String> {
    let cats = cfg.get("categories").and_then(serde_json::Value::as_array)?;
    let base = if want_root.is_empty() {
        let cat_def = cats
            .iter()
            .find(|c| c.get("name").and_then(serde_json::Value::as_str) == Some(category))?;
        category_root_dir(cfg, cat_def)
    } else {
        cfg.get("roots")
            .and_then(serde_json::Value::as_array)?
            .iter()
            .find(|r| r.get("name").and_then(serde_json::Value::as_str) == Some(want_root))
            .and_then(|r| r.get("path").and_then(serde_json::Value::as_str))?
            .to_string()
    };
    let mut folder = slugify(safe_name);
    if folder.is_empty() {
        folder = format!("imported-{}", session_id.chars().take(8).collect::<String>());
    }
    Some(format!("{base}/{category}/{folder}/notes.md"))
}

/// Adopt one existing session WITHOUT opening a terminal — the headless twin of
/// `import_session`, and the only import path the app still offers.
///
/// First-run setup imports several sessions in a row. Doing that through the interactive
/// path would open one terminal per session, so this runs the same skill the way
/// `wrap_session` runs its own: `claude --resume … -p`, through a login shell, with a
/// ceiling so a hung run cannot stall the sequence.
///
/// Success is read from the registry, not from the exit code. `/import-session` reporting
/// done having skipped the registration would otherwise count as an import, and the
/// session would be missing from the list with nothing to explain why.
#[tauri::command(async)]
pub fn import_session_headless(
    session_id: String,
    category: String,
    name: String,
    root: String,
) -> Result<(), String> {
    if !is_valid_session_id(&session_id) {
        return Err("invalid sessionId".into());
    }
    let category = category.trim().to_uppercase();
    if !is_safe_category(&category) {
        return Err("invalid category".into());
    }
    let cfg = config::load();
    let known = cfg.get("categories").and_then(serde_json::Value::as_array).is_some_and(|arr| {
        arr.iter().any(|c| c.get("name").and_then(serde_json::Value::as_str) == Some(&category))
    });
    if !known {
        return Err(format!("unknown category: {category}"));
    }
    let want_root = root.trim();
    validate_root_override(&cfg, want_root)?;
    let safe_name = sanitize_session_name(&name);
    let (dir, prompt) = import_invocation(&session_id, &category, &safe_name, want_root);
    // Predicted before the run so the failure path can tell a notes.md this run created
    // from one that was already on disk — the second is somebody's existing session and
    // must never be touched.
    let expected = import_notes_path(&cfg, &category, &safe_name, want_root, &session_id)
        .map(std::path::PathBuf::from);
    let preexisting = expected.as_ref().is_some_and(|p| p.exists());

    let inner = format!(
        "cd {} && AO_HEADLESS=1 claude --resume {}{} --permission-mode acceptEdits -p {}",
        pty::shell_quote(&dir),
        pty::shell_quote(&session_id),
        pty::model_flag(),
        pty::shell_quote(&prompt),
    );
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut child = std::process::Command::new(&shell)
        .args(["-ilc", &inner])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let start = std::time::Instant::now();
    let mut timed_out = false;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < WRAP_TIMEOUT => {
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                // Not a verdict yet — a slow import that DID register is a success, and the
                // registry check below is the only thing that can tell the two apart.
                timed_out = true;
                break;
            }
        }
    }
    if reader::load_active_sessions().get(&session_id).is_none() {
        // Trust the registry, not the exit code: the skill can print success and still have
        // stopped at its own collision guard. Unregistered means not imported — and if this
        // run got as far as writing the notes, roll that back so a retry is not refused by
        // the skill's "Already managed" abort.
        if !preexisting {
            if let Some(notes) = expected {
                discard_partial_import(&cfg, &notes);
            }
        }
        return Err(if timed_out {
            "the import timed out".into()
        } else {
            "the session was not registered — nothing was imported".to_string()
        });
    }
    Ok(())
}

/// Remove the notes.md a failed import left behind, and its session folder if that folder
/// now holds nothing else. Guarded by `is_deletable_session_dir`, the same guard the delete
/// path uses: two levels below a configured space, so a mis-derived path can at worst take
/// the file it just wrote and never a space or a category.
pub(crate) fn discard_partial_import(cfg: &serde_json::Value, notes: &std::path::Path) {
    if !notes.exists() {
        return;
    }
    let Some(dir) = notes.parent() else { return };
    let roots: Vec<std::path::PathBuf> = cfg
        .get("roots")
        .and_then(serde_json::Value::as_array)
        .map(|rs| {
            rs.iter()
                .filter_map(|r| r.get("path").and_then(serde_json::Value::as_str))
                .map(std::path::PathBuf::from)
                .collect()
        })
        .unwrap_or_default();
    if !is_deletable_session_dir(dir, &roots) {
        return;
    }
    let _ = std::fs::remove_file(notes);
    // Only if empty — `remove_dir` refuses a non-empty directory, which is the guard.
    let _ = std::fs::remove_dir(dir);
}

#[cfg(test)]
mod tests {
    use super::{discard_partial_import, import_notes_path};
    use serde_json::json;

    /// Must predict the SAME path the skill computes, or the rollback would delete the
    /// wrong file — or, worse, nothing, leaving the orphan that blocks every retry.
    #[test]
    fn import_notes_path_matches_the_skill_target_dir() {
        let cfg = json!({
            "home": "/home/u",
            "roots": [{"name":"Work","path":"/w"},{"name":"Perso","path":"/p"}],
            "categories": [
                {"name":"FEAT","color":"#7df0c0","root":"Work"},
                {"name":"PERSO","color":"#8fd9ff","root":"Perso"}
            ],
        });
        // No space given → the category's own root.
        assert_eq!(
            import_notes_path(&cfg, "FEAT", "Fix the tile cache", "", "abcdef1234").unwrap(),
            "/w/FEAT/fix-the-tile-cache/notes.md"
        );
        // A space given → that space wins, which is how a category living under two
        // roots gets disambiguated.
        assert_eq!(
            import_notes_path(&cfg, "FEAT", "Fix it", "Perso", "abcdef1234").unwrap(),
            "/p/FEAT/fix-it/notes.md"
        );
        // A name with no ASCII alphanumerics slugifies to "" → the skill's own fallback,
        // first 8 chars of the session id.
        assert_eq!(
            import_notes_path(&cfg, "FEAT", "...", "", "abcdef1234-5678").unwrap(),
            "/w/FEAT/imported-abcdef12/notes.md"
        );
        // Shorter than 8 chars must not panic on the slice.
        assert_eq!(
            import_notes_path(&cfg, "FEAT", "", "", "abc").unwrap(),
            "/w/FEAT/imported-abc/notes.md"
        );
        // An unknown category or space yields no prediction — better than guessing a path
        // the rollback would then delete.
        assert!(import_notes_path(&cfg, "GHOST", "x", "", "abcdef12").is_none());
        assert!(import_notes_path(&cfg, "FEAT", "x", "Ghost", "abcdef12").is_none());
    }

    /// The rollback deletes the notes it just wrote and the folder around it — and stops at
    /// a category dir, which the delete path also refuses.
    #[test]
    fn discard_partial_import_takes_the_session_dir_and_nothing_above_it() {
        let base = std::env::temp_dir().join(format!("ao-orphan-{}", std::process::id()));
        let session_dir = base.join("FEAT").join("half-done");
        std::fs::create_dir_all(&session_dir).unwrap();
        let notes = session_dir.join("notes.md");
        std::fs::write(&notes, "orphan").unwrap();
        let cfg = json!({ "roots": [{ "name": "Work", "path": base.to_string_lossy() }] });

        discard_partial_import(&cfg, &notes);
        assert!(!notes.exists(), "the orphan notes are gone");
        assert!(!session_dir.exists(), "the empty session folder goes with it");
        assert!(base.join("FEAT").exists(), "the category dir stays");

        // A sibling file in the folder keeps the folder: remove_dir refuses a non-empty dir.
        std::fs::create_dir_all(&session_dir).unwrap();
        std::fs::write(&notes, "orphan").unwrap();
        std::fs::write(session_dir.join("scratch.txt"), "mine").unwrap();
        discard_partial_import(&cfg, &notes);
        assert!(!notes.exists());
        assert!(session_dir.exists(), "a folder with other files survives");

        // One level below a root is a category dir → refused outright, file included.
        let cat_notes = base.join("FEAT").join("notes.md");
        std::fs::write(&cat_notes, "not mine").unwrap();
        discard_partial_import(&cfg, &cat_notes);
        assert!(cat_notes.exists(), "never delete inside a category dir");

        let _ = std::fs::remove_dir_all(&base);
    }
}
