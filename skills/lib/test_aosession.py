import json
import os
import tempfile
import unittest

import aosession

# Nearest ancestor first, as `ps` walks them: (pid, comm).
CODEX_NATIVE = "/opt/homebrew/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex"
COPILOT_NATIVE = "/Users/dev/.npm/_npx/5474/node_modules/@github/copilot-darwin-arm64/copilot"


class NearestAgent(unittest.TestCase):
    def test_the_nearest_cli_wins_over_one_further_up(self):
        chain = [(10, "/bin/zsh"), (9, COPILOT_NATIVE), (8, "node"), (7, "/Users/dev/.local/share/claude/versions/2.1.284")]
        self.assertEqual(aosession.nearest_agent(chain, {}), ("copilot", 9))

    def test_codex_is_found_by_its_native_binary(self):
        self.assertEqual(aosession.nearest_agent([(5, "/bin/bash"), (4, CODEX_NATIVE)], {}), ("codex", 4))

    def test_claude_is_found_by_name_or_version_path(self):
        self.assertEqual(aosession.nearest_agent([(3, "claude")], {}), ("claude", 3))
        self.assertEqual(aosession.nearest_agent([(3, "/Users/dev/.local/share/claude/versions/2.1.284")], {}), ("claude", 3))

    def test_a_bare_node_counts_as_claude_only_under_claude_code(self):
        self.assertEqual(aosession.nearest_agent([(3, "node")], {"CLAUDECODE": "1"}), ("claude", 3))
        self.assertEqual(aosession.nearest_agent([(3, "node")], {}), (None, None))


class Current(unittest.TestCase):
    def test_each_agent_reads_only_its_own_variable(self):
        # The probe case: Copilot launched from inside Claude Code inherits a
        # CLAUDE_CODE_SESSION_ID that belongs to neither session.
        env = {"CLAUDE_CODE_SESSION_ID": "034a5675-93aa", "COPILOT_AGENT_SESSION_ID": "51f099d6-93aa", "CLAUDECODE": "1"}
        chain = [(9, COPILOT_NATIVE), (7, "claude")]
        self.assertEqual(aosession.current(env, chain, lambda pid: None), ("copilot", "51f099d6-93aa", 9))

    def test_codex_reads_its_thread_id(self):
        env = {"CODEX_THREAD_ID": "01a0e9de", "CODEX_SESSION_ID": "01a0e9de"}
        self.assertEqual(aosession.current(env, [(4, CODEX_NATIVE)], lambda pid: None), ("codex", "01a0e9de", 4))

    def test_claude_without_the_variable_falls_back_to_its_pidfile(self):
        pidfiles = {3: "c4c77b93"}
        self.assertEqual(aosession.current({}, [(3, "claude")], pidfiles.get), ("claude", "c4c77b93", 3))

    def test_claude_trusts_its_pidfile_over_the_variable(self):
        # Every managed session today is keyed by the pidfile's id; whether the variable
        # follows `--resume` and `/clear` has not been checked, so it must not win.
        pidfiles = {3: "c4c77b93"}
        env = {"CLAUDE_CODE_SESSION_ID": "0badbeef", "CLAUDECODE": "1"}
        self.assertEqual(aosession.current(env, [(3, "claude")], pidfiles.get), ("claude", "c4c77b93", 3))

    def test_no_known_cli_falls_back_to_any_claude_pidfile_in_the_chain(self):
        pidfiles = {7: "c4c77b93"}
        self.assertEqual(aosession.current({}, [(9, "/bin/zsh"), (7, "weird-wrapper")], pidfiles.get), ("claude", "c4c77b93", 7))

    def test_nothing_found_is_empty_not_a_guess(self):
        self.assertEqual(aosession.current({}, [(9, "/bin/zsh")], lambda pid: None), (None, "", None))


class Register(unittest.TestCase):
    def test_register_writes_one_state_file_per_pid_atomically(self):
        with tempfile.TemporaryDirectory() as d:
            path = aosession.register(d, agent="codex", pid=4, session_id="01a0e9de", cwd="/w/x",
                                      notes_path="/w/x/notes.md", name="FEAT | x")
            self.assertEqual(os.path.basename(path), "4.json")
            data = json.load(open(path))
            self.assertEqual({k: data[k] for k in ("v", "agent", "pid", "session_id", "cwd", "notes_path", "name")},
                             {"v": 1, "agent": "codex", "pid": 4, "session_id": "01a0e9de", "cwd": "/w/x",
                              "notes_path": "/w/x/notes.md", "name": "FEAT | x"})
            self.assertIn("started_at", data)
            self.assertEqual([f for f in os.listdir(d) if f.endswith(".tmp")], [])

    def test_register_refuses_an_unknown_agent(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                aosession.register(d, agent="gemini", pid=4, session_id="s", cwd="/", notes_path="", name="")


if __name__ == "__main__":
    unittest.main()
