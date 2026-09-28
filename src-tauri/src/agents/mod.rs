//! The three agent CLIs a session can run in — Claude Code, Codex and Copilot — and the one
//! place that knows how each is launched. See
//! docs/superpowers/specs/2026-09-28-multi-agent-parity-design.md.

use crate::pty::shell_quote;

pub(crate) mod codex;
pub(crate) mod copilot;

/// What a transcript says about its session, whichever agent wrote it.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct Fold {
    pub busy: bool,
    pub last_activity: Option<String>,
    pub last_activity_at: Option<String>,
    pub cwd: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AgentId {
    Claude,
    Codex,
    Copilot,
}

impl AgentId {
    /// A session with no recorded agent is a Claude Code session: every session the app
    /// managed before Codex and Copilot existed has no `agent` field. Any other value is
    /// refused, so a typo never launches Claude Code on another tool's session id.
    pub(crate) fn parse(raw: Option<&str>) -> Result<Self, String> {
        match raw.map(str::trim) {
            None | Some("") | Some("claude") => Ok(Self::Claude),
            Some("codex") => Ok(Self::Codex),
            Some("copilot") => Ok(Self::Copilot),
            Some(other) => Err(format!("unknown agent: {other}")),
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Copilot => "copilot",
        }
    }

    pub(crate) fn binary(self) -> &'static str {
        self.as_str()
    }

    /// How a skill is invoked in a prompt: Codex names skills with `$`, the others with `/`.
    pub(crate) fn skill_invocation(self, name: &str, args: &str) -> String {
        let sigil = if self == Self::Codex { '$' } else { '/' };
        let args = args.trim();
        if args.is_empty() {
            format!("{sigil}{name}")
        } else {
            format!("{sigil}{name} {args}")
        }
    }

    fn model_flag(self, model: &str) -> String {
        let m = model.trim();
        if m.is_empty() {
            return String::new();
        }
        let flag = if self == Self::Codex { "-m" } else { "--model" };
        format!(" {flag} {}", shell_quote(m))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mode {
    /// A terminal the user types into.
    Interactive,
    /// A one-shot run with nobody to answer a prompt (wrap, sync, run-skill, import).
    Headless,
}

/// What one launch needs. `claude_settings` is Claude Code's ` --settings '<file>'`
/// argument, empty for the other two: neither has a per-launch settings flag.
pub(crate) struct Launch<'a> {
    pub resume: Option<&'a str>,
    pub prompt: Option<&'a str>,
    pub model: &'a str,
    pub mode: Mode,
    pub claude_settings: &'a str,
    /// Directories a headless Codex run may write besides its working directory. Its
    /// workspace-write sandbox otherwise confines writes to the working directory, and a
    /// skill also writes the app's registry and the knowledge notes.
    pub writable_roots: &'a [String],
}

/// The agent's command line, without the leading `cd`. Every value is shell-quoted; the
/// caller validates session ids before they get here.
pub(crate) fn command(agent: AgentId, l: &Launch) -> String {
    let resume = l.resume.filter(|id| !id.is_empty());
    let prompt = l.prompt.filter(|p| !p.is_empty()).map(shell_quote);
    let headless = l.mode == Mode::Headless;
    let mut s = String::new();
    if headless {
        s.push_str("AO_HEADLESS=1 ");
    }
    match agent {
        AgentId::Claude => {
            s.push_str("claude");
            if let Some(id) = resume {
                s.push_str(&format!(" --resume {}", shell_quote(id)));
            }
            s.push_str(&agent.model_flag(l.model));
            s.push_str(if headless { " --permission-mode acceptEdits" } else { " --permission-mode auto" });
            s.push_str(l.claude_settings);
            if let Some(p) = prompt {
                s.push_str(if headless { " -p " } else { " " });
                s.push_str(&p);
            }
        }
        AgentId::Codex => {
            s.push_str(if headless { "codex exec" } else { "codex" });
            if resume.is_some() {
                s.push_str(" resume");
            }
            if headless {
                s.push_str(" --skip-git-repo-check -c sandbox_mode=\"workspace-write\"");
                s.push_str(" -c sandbox_workspace_write.network_access=true");
                if !l.writable_roots.is_empty() {
                    let roots: Vec<String> = l.writable_roots.iter().map(|r| format!("{r:?}")).collect();
                    s.push_str(&format!(" -c {}", shell_quote(&format!("sandbox_workspace_write.writable_roots=[{}]", roots.join(",")))));
                }
            }
            s.push_str(&agent.model_flag(l.model));
            if let Some(id) = resume {
                s.push_str(&format!(" {}", shell_quote(id)));
            }
            if let Some(p) = prompt {
                s.push(' ');
                s.push_str(&p);
            }
        }
        AgentId::Copilot => {
            s.push_str("copilot");
            if let Some(id) = resume {
                s.push_str(&format!(" --resume={}", shell_quote(id)));
            }
            s.push_str(&agent.model_flag(l.model));
            match (prompt, headless) {
                (Some(p), true) => s.push_str(&format!(" -p {p} --allow-all-tools")),
                (Some(p), false) => s.push_str(&format!(" -i {p}")),
                (None, _) => {}
            }
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn launch<'a>(resume: Option<&'a str>, prompt: Option<&'a str>, model: &'a str, mode: Mode) -> Launch<'a> {
        Launch { resume, prompt, model, mode, claude_settings: " --settings '/cfg/launch-settings.json'", writable_roots: &[] }
    }

    #[test]
    fn a_session_without_an_agent_is_claude() {
        assert_eq!(AgentId::parse(None), Ok(AgentId::Claude));
        assert_eq!(AgentId::parse(Some("")), Ok(AgentId::Claude));
        assert_eq!(AgentId::parse(Some("claude")), Ok(AgentId::Claude));
        assert_eq!(AgentId::parse(Some(" codex ")), Ok(AgentId::Codex));
        assert_eq!(AgentId::parse(Some("copilot")), Ok(AgentId::Copilot));
    }

    // `agent: codx` must not launch `claude --resume <a codex id>`.
    #[test]
    fn an_unknown_agent_is_refused_not_launched_as_claude() {
        assert!(AgentId::parse(Some("codx")).is_err());
        assert!(AgentId::parse(Some("gemini")).is_err());
    }

    #[test]
    fn codex_names_skills_with_a_dollar() {
        assert_eq!(AgentId::Codex.skill_invocation("close-session", ""), "$close-session");
        assert_eq!(AgentId::Claude.skill_invocation("start-session", "FEAT x"), "/start-session FEAT x");
        assert_eq!(AgentId::Copilot.skill_invocation("wrap-session", " /n.md id "), "/wrap-session /n.md id");
    }

    // The Claude lines are byte-for-byte what open_in_terminal, pty_spawn, start_session,
    // wrap_session and import built before this module, so moving a call site here cannot
    // change a Claude launch.
    #[test]
    fn claude_lines_are_unchanged() {
        assert_eq!(
            command(AgentId::Claude, &launch(Some("c4c77b93-6510"), None, "opus[1m]", Mode::Interactive)),
            "claude --resume 'c4c77b93-6510' --model 'opus[1m]' --permission-mode auto --settings '/cfg/launch-settings.json'"
        );
        assert_eq!(
            command(AgentId::Claude, &launch(None, Some("/start-session FEAT x"), "", Mode::Interactive)),
            "claude --permission-mode auto --settings '/cfg/launch-settings.json' '/start-session FEAT x'"
        );
        let mut h = launch(Some("c4c77b93"), Some("/wrap-session /n.md c4c77b93"), "", Mode::Headless);
        h.claude_settings = "";
        assert_eq!(
            command(AgentId::Claude, &h),
            "AO_HEADLESS=1 claude --resume 'c4c77b93' --permission-mode acceptEdits -p '/wrap-session /n.md c4c77b93'"
        );
    }

    #[test]
    fn codex_lines() {
        assert_eq!(
            command(AgentId::Codex, &launch(Some("01a0e9de"), None, "gpt-6", Mode::Interactive)),
            "codex resume -m 'gpt-6' '01a0e9de'"
        );
        assert_eq!(
            command(AgentId::Codex, &launch(None, Some("$start-session FEAT x"), "", Mode::Interactive)),
            "codex '$start-session FEAT x'"
        );
        let roots = vec!["/Users/dev/.claude".to_string()];
        let mut h = launch(Some("01a0e9de"), Some("$wrap-session /n.md 01a0e9de"), "", Mode::Headless);
        h.writable_roots = &roots;
        assert_eq!(
            command(AgentId::Codex, &h),
            "AO_HEADLESS=1 codex exec resume --skip-git-repo-check -c sandbox_mode=\"workspace-write\" \
             -c sandbox_workspace_write.network_access=true \
             -c 'sandbox_workspace_write.writable_roots=[\"/Users/dev/.claude\"]' '01a0e9de' '$wrap-session /n.md 01a0e9de'"
        );
    }

    #[test]
    fn copilot_lines() {
        assert_eq!(
            command(AgentId::Copilot, &launch(Some("4fa67fb9"), None, "", Mode::Interactive)),
            "copilot --resume='4fa67fb9'"
        );
        assert_eq!(
            command(AgentId::Copilot, &launch(None, Some("/start-session FEAT x"), "gpt-5", Mode::Interactive)),
            "copilot --model 'gpt-5' -i '/start-session FEAT x'"
        );
        assert_eq!(
            command(AgentId::Copilot, &launch(Some("4fa67fb9"), Some("/sync-refs /n.md"), "", Mode::Headless)),
            "AO_HEADLESS=1 copilot --resume='4fa67fb9' -p '/sync-refs /n.md' --allow-all-tools"
        );
    }

    #[test]
    fn a_hostile_prompt_or_id_stays_one_quoted_word() {
        let line = command(AgentId::Codex, &launch(Some("x'; rm -rf ~; '"), Some("a'$(id)'"), "", Mode::Interactive));
        assert_eq!(line, "codex resume 'x'\\''; rm -rf ~; '\\''' 'a'\\''$(id)'\\'''");
    }
}
