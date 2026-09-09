#!/usr/bin/env python3
"""Tests for the ao_skill_guard hook. Run: python3 hooks/test_ao_skill_guard.py"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ao_skill_guard as G  # noqa: E402

APP = {"save-session", "start-session", "route"}
owned = lambda n: n in APP  # noqa: E731


def edit(path, tool="Edit"):
    key = "notebook_path" if tool == "NotebookEdit" else "file_path"
    return {"tool_name": tool, "tool_input": {key: path}}


class TestGuard(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()

    def p(self, *parts):
        return os.path.join(self.root, *parts)

    def test_denies_a_write_inside_an_app_skill(self):
        for tool in G.TOOLS:
            reason = G.decide(edit(self.p("save-session", "SKILL.md"), tool), self.root, owned)
            self.assertIn("/save-session", reason, tool)
            self.assertIn("NEW skill", reason)

    def test_allows_the_users_own_skills(self):
        self.assertIsNone(G.decide(edit(self.p("route-perso", "SKILL.md")), self.root, owned))
        self.assertIsNone(G.decide(edit(self.p("save-session-mine", "SKILL.md")), self.root, owned))

    def test_allows_everything_outside_the_skills_folder(self):
        self.assertIsNone(G.decide(edit("/tmp/repo/skills/save-session/SKILL.md"), self.root, owned))
        self.assertIsNone(G.decide(edit(os.path.join(os.path.dirname(self.root), "elsewhere.md")), self.root, owned))

    # A sibling folder whose name merely starts with the root must not match.
    def test_prefix_of_the_root_is_not_inside_it(self):
        self.assertIsNone(G.decide(edit(self.root + "-other/save-session/SKILL.md"), self.root, owned))

    def test_app_internals_are_covered_too(self):
        for sub in (".ao-base/route/SKILL.md", "lib/aoconfig.py", ".ao-install-manifest.json"):
            self.assertIsNotNone(G.decide(edit(self.p(*sub.split("/"))), self.root, owned), sub)

    def test_read_tools_are_ignored(self):
        self.assertIsNone(G.decide({"tool_name": "Read", "tool_input": {"file_path": self.p("save-session", "SKILL.md")}}, self.root, owned))
        self.assertIsNone(G.decide({"tool_name": "Bash", "tool_input": {"command": "cat x"}}, self.root, owned))

    def test_tilde_paths_resolve(self):
        home = os.path.expanduser("~")
        if not self.root.startswith(home):
            self.skipTest("temp dir not under HOME")
        rel = "~" + self.root[len(home):]
        self.assertIsNotNone(G.decide(edit(rel + "/route/SKILL.md"), self.root, owned))

    def test_junk_payload_is_quiet(self):
        self.assertIsNone(G.decide({}, self.root, owned))
        self.assertIsNone(G.decide({"tool_name": "Edit", "tool_input": {}}, self.root, owned))


if __name__ == "__main__":
    unittest.main()
