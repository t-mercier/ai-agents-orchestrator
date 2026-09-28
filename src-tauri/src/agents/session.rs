//! Creating a Codex or Copilot session. The app writes its notes.md itself: the app skills
//! that create a Claude Code session's notes do not run inside those tools yet. The file has
//! the frontmatter `/start-session` writes, plus `agent:`, so every reader of notes.md
//! treats it like any other session.

use super::AgentId;
use std::io::Write;
use std::path::Path;

pub(crate) struct NewNotes<'a> {
    pub agent: AgentId,
    pub session_id: &'a str,
    pub category: &'a str,
    pub ticket: &'a str,
    pub name: &'a str,
    pub pr_link: &'a str,
    pub start_in: &'a str,
    pub started_at: &'a str,
    pub today: &'a str,
}

/// The notes.md text, section for section what `/start-session` writes.
pub(crate) fn notes_text(n: &NewNotes) -> String {
    let mut fm = vec![
        format!("session_id: {}", n.session_id),
        format!("agent: {}", n.agent.as_str()),
        format!("category: {}", n.category),
        format!("ticket: {}", n.ticket),
        format!("name: {}", n.name),
        "branch: to fill".to_string(),
        format!("pr_link: {}", n.pr_link),
    ];
    if !n.start_in.is_empty() {
        fm.push(format!("start_in: {}", n.start_in));
    }
    fm.push(format!("started_at: {}", n.started_at));
    let title = if n.name.is_empty() { n.ticket } else { n.name };
    format!(
        "---\n{}\n---\n\n# {title}\n\n## Goal\n\n## Branch\nto fill\n\n## Decisions made\n- {}: session started in {}.\n\n\
         ## Files touched\n\n## Open questions\n\n## Next steps\n\n## Session history\n",
        fm.join("\n"),
        n.today,
        display_name(n.agent),
    )
}

pub(crate) fn display_name(agent: AgentId) -> &'static str {
    match agent {
        AgentId::Claude => "Claude Code",
        AgentId::Codex => "Codex",
        AgentId::Copilot => "Copilot",
    }
}

/// What the agent is told first. Without the app skills, this is what makes notes.md its
/// memory: where the file is, and what to keep in it.
pub(crate) fn first_prompt(name: &str, notes_path: &str) -> String {
    format!(
        "This is an AI Agents Orchestrator session, \"{name}\". Its notes are at {notes_path}: read them first. \
         Keep them current as you work: dated entries under \"Decisions made\", the files you change under \
         \"Files touched\", and an up-to-date \"Next steps\". Fill in \"Goal\" now if it is empty, then ask me \
         what to do."
    )
}

/// Write a new notes.md, creating its folder. Refuses to overwrite: a file already at that
/// path is somebody's existing session.
pub(crate) fn create(path: &Path, text: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => format!("a session already exists at {}", path.display()),
            _ => e.to_string(),
        })?;
    f.write_all(text.as_bytes()).map_err(|e| e.to_string())
}

/// A random (version 4) UUID, for Copilot's `--session-id`. Read from the OS generator
/// rather than adding a crate for sixteen bytes.
pub(crate) fn uuid_v4() -> Result<String, String> {
    use std::io::Read;
    let mut b = [0u8; 16];
    std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut b)).map_err(|e| e.to_string())?;
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    Ok(format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notes(agent: AgentId, sid: &'static str) -> NewNotes<'static> {
        NewNotes {
            agent, session_id: sid, category: "FEAT", ticket: "", name: "try codex",
            pr_link: "", start_in: "", started_at: "2026-09-29 00:40", today: "2026-09-29",
        }
    }

    #[test]
    fn the_notes_carry_the_agent_and_read_like_any_session() {
        let text = notes_text(&notes(AgentId::Codex, ""));
        assert!(text.starts_with("---\nsession_id: \nagent: codex\ncategory: FEAT\n"));
        let meta = crate::reader::parse_frontmatter(&text);
        assert_eq!(meta.get("agent").map(String::as_str), Some("codex"));
        assert_eq!(meta.get("category").map(String::as_str), Some("FEAT"));
        for section in ["## Goal", "## Decisions made", "## Next steps", "## Session history"] {
            assert!(text.contains(section), "{section}");
        }
        assert!(text.contains("- 2026-09-29: session started in Codex."));
    }

    #[test]
    fn an_existing_session_is_never_overwritten() {
        let dir = std::env::temp_dir().join(format!("ao-agents-create-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let p = dir.join("FEAT/try-codex/notes.md");
        create(&p, "first").unwrap();
        assert!(create(&p, "second").is_err());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "first");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_session_id_is_a_valid_v4_uuid() {
        let a = uuid_v4().unwrap();
        assert_eq!(a.len(), 36);
        assert_eq!(&a[14..15], "4");
        assert!(crate::is_valid_session_id(&a));
        assert_ne!(a, uuid_v4().unwrap());
    }

    #[test]
    fn the_first_prompt_names_the_notes_file() {
        let p = first_prompt("try codex", "/w/FEAT/try-codex/notes.md");
        assert!(p.contains("/w/FEAT/try-codex/notes.md"));
        assert!(p.contains("\"try codex\""));
    }
}
