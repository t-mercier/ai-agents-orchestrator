//! ao-statusline.sh installation and management.
//!
//! Embeds the ao-statusline.sh wrapper script in the binary and installs it to
//! ~/.claude/ao-statusline.sh at app startup. This wrapper captures Claude Code's
//! rate-limit + context data and writes it to the dashboard's usage cache, then
//! delegates to the user's own statusline command (if any).

use crate::config;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

/// The ao-statusline.sh wrapper script, embedded at compile time.
const AO_STATUSLINE_SCRIPT: &str = include_str!("../../scripts/ao-statusline.sh");

/// Install the ao-statusline.sh wrapper to ~/.claude/ao-statusline.sh (idempotent).
/// On error, logs a warning but doesn't fail — the app runs fine without this
/// (sessions just don't feed the usage bar).
pub fn install_if_needed() {
    let target = config::home().join(".claude").join("ao-statusline.sh");
    if let Err(e) = install_into(&target) {
        eprintln!("[ai-agents-orchestrator] Failed to install ao-statusline.sh: {e}");
    }
}

fn install_into(target: &Path) -> std::io::Result<()> {
    fs::create_dir_all(target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid target path")
    })?)?;
    fs::write(target, AO_STATUSLINE_SCRIPT)?;
    let perms = fs::Permissions::from_mode(0o755);
    fs::set_permissions(target, perms)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn install_writes_executable_script() {
        let tmp = std::env::temp_dir().join(format!("ao-statusline-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();
        let target = tmp.join("ao-statusline.sh");

        install_into(&target).unwrap();

        let content = fs::read_to_string(&target).unwrap();
        // Assert on a stable behavioural marker (the cache path the wrapper writes),
        // not the comment's filename — the script has been renamed once already.
        assert!(content.contains("statusline-cache.json"));

        let metadata = fs::metadata(&target).unwrap();
        let mode = metadata.permissions().mode();
        assert_eq!(mode & 0o111, 0o111, "script should be executable");

        let _ = fs::remove_dir_all(&tmp);
    }
}
