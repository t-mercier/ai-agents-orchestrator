#!/usr/bin/env python3
"""Tests for the notes_steps_guard hook. Run: python3 hooks/test_notes_steps_guard.py"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import notes_steps_guard as g  # noqa: E402


def notes(steps, after="## Session history\n- 2026-10-16 | x | y\n"):
    return f"---\nstatus: active\n---\n# t\n\n## Next steps\n\n{steps}\n{after}"


class TestProblems(unittest.TestCase):
    def check(self, text, tool="Edit", name="notes.md", new="- [ ] the step just written"):
        d = tempfile.mkdtemp()
        p = os.path.join(d, name)
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)
        return g.check({"tool_name": tool, "tool_input": {"file_path": p, "new_string": new}})

    def test_a_short_queue_says_nothing(self):
        self.assertIsNone(self.check(notes("- [ ] Ship the fix\n- [ ] 👤 Take the capture on the phone\n")))

    def test_more_than_seven_open_steps(self):
        out = self.check(notes("".join(f"- [ ] step {i}\n" for i in range(8))))
        self.assertEqual(out["decision"], "block")
        self.assertIn("8 open steps", out["reason"])

    def test_a_step_over_100_characters_is_quoted(self):
        out = self.check(notes("- [ ] " + "x" * 101 + "\n"))
        self.assertIn("101 characters", out["reason"])
        self.assertIn("x" * g.SHOWN + "…", out["reason"])

    def test_only_the_first_five_long_steps_are_quoted(self):
        out = self.check(notes("".join(f"- [ ] {i}" + "x" * 120 + "\n" for i in range(7))))
        self.assertEqual(out["reason"].count("characters, over 100"), g.QUOTED)
        self.assertIn("and 2 more step(s)", out["reason"])

    def test_exactly_100_characters_is_fine(self):
        self.assertIsNone(self.check(notes("- [ ] " + "x" * 100 + "\n")))

    def test_a_step_that_runs_on_and_ticked_steps(self):
        out = self.check(notes("- [ ] Do it\n  because of a long story\n- [x] done already\n"))
        self.assertIn("indented line", out["reason"])
        self.assertIn("1 ticked step", out["reason"])

    def test_only_the_next_steps_section_counts(self):
        long_decision = "## Decisions made\n- " + "y" * 400 + "\n## Session history\n- x | y\n"
        self.assertIsNone(self.check(notes("- [ ] Ship\n", after=long_decision)))

    def test_an_edit_that_does_not_touch_the_steps_is_not_blamed_for_them(self):
        bad = notes("- [ ] " + "x" * 200 + "\n")
        self.assertIsNone(self.check(bad, new="- 2026-10-16 (in progress) | session=x | saved"))
        self.assertIsNotNone(self.check(bad, tool="Write", new=None))
        d = tempfile.mkdtemp(); p = os.path.join(d, "notes.md")
        open(p, "w").write(bad)
        multi = {"tool_name": "MultiEdit", "tool_input": {"file_path": p, "edits": [{"new_string": "x"}, {"new_string": "## Next steps\n"}]}}
        self.assertIsNotNone(g.check(multi))

    def test_a_notes_md_that_is_not_a_session_s_is_ignored(self):
        self.assertIsNone(self.check("# Meeting notes\n\n## Next steps\n- [ ] " + "x" * 200 + "\n"))

    def test_the_heading_may_differ_in_case_or_carry_a_suffix(self):
        text = notes("- [ ] " + "x" * 200 + "\n").replace("## Next steps", "## Next Steps (priority)")
        self.assertIsNotNone(self.check(text))

    def test_other_files_tools_and_missing_sections_are_ignored(self):
        bad = notes("- [ ] " + "x" * 200 + "\n")
        self.assertIsNone(self.check(bad, name="README.md"))
        self.assertIsNone(self.check(bad, tool="Read"))
        self.assertIsNone(self.check("# no sections here\n"))
        self.assertIsNone(g.check({"tool_name": "Edit", "tool_input": {"file_path": "/nope/notes.md"}}))


if __name__ == "__main__":
    unittest.main()
