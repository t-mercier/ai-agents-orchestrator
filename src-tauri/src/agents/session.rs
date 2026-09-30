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

/// A value that goes on one frontmatter line: a line break in it would write a key of its
/// own (a folder can be named with one).
pub(crate) fn one_line(value: &str) -> Result<&str, String> {
    if value.contains(['\n', '\r']) {
        Err(format!("a line break is not allowed here: {value:?}"))
    } else {
        Ok(value)
    }
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
         what to do. When I ask for another model's view (GPT, Copilot, Claude: \"start a multi-model investigation \
         with GPT\"), invite it and consult it with: python3 ~/.claude/skills/lib/ao_ask.py invite --session {q} <gpt | copilot | claude:opus> \
         (then follow what it prints). Run it outside your sandbox: it needs the network.",
        q = crate::pty::shell_quote(notes_path),
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

/// The shell line that reopens a Codex or Copilot session in an embedded terminal.
///
/// Resume continues its conversation. Restart, for a session whose conversation is gone,
/// starts a new one on the same notes: Copilot under a fresh id written into the notes,
/// Codex with the id cleared so the poll records the rollout it is about to write.
pub(crate) struct Relaunch {
    pub line: String,
    /// The folder the CLI starts in, canonical: what a new Codex session records as its cwd.
    pub dir: String,
    /// The session's id when it is known at launch (Resume, and a Copilot Restart).
    pub session_id: Option<String>,
}

/// `path` resolved (symlinks, `..`), or as given when it cannot be.
pub(crate) fn canonical(path: &str) -> String {
    std::fs::canonicalize(path).map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| path.to_string())
}

/// `model` is the one Settings sets for this agent (`config::agent_model`); empty sends none.
pub(crate) fn relaunch_line(agent: AgentId, notes_path: &str, cwd: &str, session_id: &str, restart: bool, model: &str) -> Result<Relaunch, String> {
    let dir = if Path::new(cwd).is_dir() {
        cwd.to_string()
    } else {
        Path::new(notes_path).parent().map(|p| p.to_string_lossy().into_owned()).ok_or("no folder to start in")?
    };
    let dir = canonical(&dir);
    let known: Option<String>;
    let line = if restart {
        let content = std::fs::read_to_string(notes_path).map_err(|e| e.to_string())?;
        let name = crate::reader::parse_frontmatter(&content).get("name").cloned().unwrap_or_default();
        let new_id = if agent == AgentId::Copilot { uuid_v4()? } else { String::new() };
        let ids: Vec<String> = if new_id.is_empty() { vec![] } else { vec![new_id.clone()] };
        let updated = crate::set_frontmatter_links(&content, "session_id", "session_ids", &ids);
        crate::atomic_write(Path::new(notes_path), &ensure_key(&updated, "session_id", &new_id))?;
        known = Some(new_id.clone()).filter(|i| !i.is_empty());
        new_line(agent, &new_id, &first_prompt(&name, notes_path), model)
    } else {
        if !crate::is_valid_session_id(session_id) {
            return Err(format!("not a session id: {session_id}"));
        }
        known = Some(session_id.to_string());
        super::command(agent, &super::Launch {
            resume: Some(session_id), prompt: None, model, mode: super::Mode::Interactive,
            claude_settings: "", writable_roots: &[],
        })
    };
    Ok(Relaunch { line: format!("cd {} && {line}", crate::pty::shell_quote(&dir)), dir, session_id: known })
}

/// The command that starts a new session. Copilot takes the id the app chose.
pub(crate) fn new_line(agent: AgentId, copilot_id: &str, prompt: &str, model: &str) -> String {
    let line = super::command(agent, &super::Launch {
        resume: None, prompt: Some(prompt), model, mode: super::Mode::Interactive,
        claude_settings: "", writable_roots: &[],
    });
    match agent {
        AgentId::Copilot if !copilot_id.is_empty() => {
            line.replacen("copilot", &format!("copilot --session-id {}", crate::pty::shell_quote(copilot_id)), 1)
        }
        _ => line,
    }
}

/// Record the id of a Codex session once its rollout is found, so Resume can find its
/// conversation after the terminal closes.
pub(crate) fn record_id(notes_path: &str, id: &str) -> Result<(), String> {
    if !crate::is_valid_session_id(id) {
        return Err(format!("not a session id: {id}"));
    }
    let path = Path::new(notes_path);
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    crate::atomic_write(path, &crate::set_frontmatter_links(&content, "session_id", "session_ids", &[id.to_string()]))
}

/// `set_frontmatter_links` drops a key whose list is empty; notes.md always carries
/// `session_id:`, empty or not, so put it back first when it went.
fn ensure_key(content: &str, key: &str, value: &str) -> String {
    let has = crate::reader::frontmatter_block(content)
        .is_some_and(|fm| fm.lines().any(|l| l.split_once(':').is_some_and(|(k, _)| k.trim() == key)));
    if has {
        return content.to_string();
    }
    match content.strip_prefix("---\n") {
        Some(rest) => format!("---\n{key}: {value}\n{rest}"),
        None => content.to_string(),
    }
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
    fn a_folder_with_a_line_break_cannot_write_a_frontmatter_key() {
        assert!(one_line("/w/x\nagent: claude").is_err());
        assert_eq!(one_line("/w/x y"), Ok("/w/x y"));
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
    fn a_session_runs_on_the_model_set_for_its_agent() {
        assert_eq!(
            new_line(AgentId::Copilot, "4fa67fb9-1148-41dc-acd9-4867ad017342", "hi", "gpt-5.6-sol"),
            "copilot --session-id '4fa67fb9-1148-41dc-acd9-4867ad017342' --model 'gpt-5.6-sol' -i 'hi'"
        );
        assert_eq!(new_line(AgentId::Codex, "", "hi", "gpt-5.4"), "codex -m 'gpt-5.4' 'hi'");
        let r = relaunch_line(AgentId::Codex, "/w/n.md", "/", "01a0e9da-76d9", false, "gpt-5.4").unwrap();
        assert_eq!(r.line, "cd '/' && codex resume -m 'gpt-5.4' '01a0e9da-76d9'");
    }

    #[test]
    fn a_new_copilot_session_runs_under_the_id_the_app_chose() {
        assert_eq!(
            new_line(AgentId::Copilot, "4fa67fb9-1148-41dc-acd9-4867ad017342", "hi", ""),
            "copilot --session-id '4fa67fb9-1148-41dc-acd9-4867ad017342' -i 'hi'"
        );
        assert_eq!(new_line(AgentId::Codex, "", "hi", ""), "codex 'hi'");
    }

    #[test]
    fn restart_gives_copilot_a_new_id_and_clears_codex_s() {
        let dir = std::env::temp_dir().join(format!("ao-agents-restart-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let p = dir.join("FEAT/x/notes.md");
        let mut n = notes(AgentId::Copilot, "fceb338b-f100-471c-9ed5-3975070c0ba2");
        n.name = "x";
        create(&p, &notes_text(&n)).unwrap();
        let r = relaunch_line(AgentId::Copilot, p.to_str().unwrap(), dir.to_str().unwrap(), "", true, "").unwrap();
        let line = r.line;
        let fm = crate::reader::parse_frontmatter(&std::fs::read_to_string(&p).unwrap());
        let new_id = fm.get("session_id").cloned().unwrap();
        assert_ne!(new_id, "fceb338b-f100-471c-9ed5-3975070c0ba2");
        assert!(line.contains(&format!("--session-id '{new_id}'")), "{line}");
        assert!(line.starts_with(&format!("cd '{}' && copilot", canonical(dir.to_str().unwrap()))));
        assert_eq!(r.session_id.as_deref(), Some(new_id.as_str()), "the terminal knows the new id from the start");

        let q = dir.join("FEAT/y/notes.md");
        create(&q, &notes_text(&notes(AgentId::Codex, "01a0e9da-76d9-7c12-882e-57b7554edd81"))).unwrap();
        relaunch_line(AgentId::Codex, q.to_str().unwrap(), "", "", true, "").unwrap();
        let text = std::fs::read_to_string(&q).unwrap();
        assert!(text.starts_with("---\nsession_id: \n"), "the key stays, empty: {text}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_found_codex_id_is_written_into_the_notes() {
        let dir = std::env::temp_dir().join(format!("ao-agents-record-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let p = dir.join("n/notes.md");
        create(&p, &notes_text(&notes(AgentId::Codex, ""))).unwrap();
        record_id(p.to_str().unwrap(), "01a0e9da-76d9-7c12-882e-57b7554edd81").unwrap();
        let fm = crate::reader::parse_frontmatter(&std::fs::read_to_string(&p).unwrap());
        assert_eq!(fm.get("session_id").map(String::as_str), Some("01a0e9da-76d9-7c12-882e-57b7554edd81"));
        assert_eq!(fm.get("agent").map(String::as_str), Some("codex"));
        assert!(record_id(p.to_str().unwrap(), "../x").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resume_refuses_a_malformed_id() {
        assert!(relaunch_line(AgentId::Codex, "/w/n.md", "/", "x'; rm -rf ~", false, "").is_err());
        let r = relaunch_line(AgentId::Codex, "/w/n.md", "/", "01a0e9da-76d9", false, "").unwrap();
        assert_eq!(r.line, "cd '/' && codex resume '01a0e9da-76d9'");
        assert_eq!(r.session_id.as_deref(), Some("01a0e9da-76d9"));
        // A launch folder that is gone falls back to the notes folder, and says so: a new
        // Codex session records the folder it really started in.
        let gone = relaunch_line(AgentId::Codex, "/tmp/n.md", "/no/such/dir", "01a0e9da-76d9", false, "").unwrap();
        assert_eq!(gone.dir, canonical("/tmp"));
    }

    #[test]
    fn the_first_prompt_names_the_notes_file() {
        let p = first_prompt("try codex", "/w/FEAT/try-codex/notes.md");
        assert!(p.contains("/w/FEAT/try-codex/notes.md"));
        assert!(p.contains("\"try codex\""));
        // Asked for on 2026-09-30: "start a multi-model investigation with GPT" works in a
        // Codex or Copilot session too, which has none of the app's skills.
        assert!(p.contains("ao_ask.py invite --session '/w/FEAT/try-codex/notes.md' <gpt"), "{p}");
    }
}
