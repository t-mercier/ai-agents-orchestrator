#!/usr/bin/env python3
"""Tests for the ao_precompact hook. Run: python3 hooks/test_ao_precompact.py"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ao_precompact as P  # noqa: E402

NOTES = ("---\nsession_id: s1\n---\n\n# n\n\n## Next steps\n- [ ] x\n\n## Session history\n"
         "- 2026-09-01 10:00 (in progress) | session=s1 | first save\n")
LINE = P.checkpoint_line("s1", "/t/s1.jsonl", "2026-09-09 16:00", "auto")


class TestLine(unittest.TestCase):
    def test_has_the_shape_every_reader_expects(self):
        self.assertTrue(LINE.startswith("- 2026-09-09 16:00 (in progress) | session=s1 | transcript=/t/s1.jsonl | "))
        self.assertIn(P.MARK, LINE)

    def test_no_transcript_no_empty_field(self):
        self.assertNotIn("transcript=", P.checkpoint_line("s1", "", "w", "manual"))


class TestAppend(unittest.TestCase):
    def test_appends_at_the_end_of_the_history_section(self):
        out = P.append_checkpoint(NOTES, LINE, "s1")
        self.assertTrue(out.rstrip("\n").endswith(LINE))
        self.assertIn("first save\n" + LINE, out)

    def test_history_in_the_middle_of_the_file(self):
        notes = NOTES + "\n## How to run\nnpm start\n"
        out = P.append_checkpoint(notes, LINE, "s1")
        self.assertIn("first save\n" + LINE + "\n\n## How to run", out)

    def test_never_two_auto_checkpoints_in_a_row(self):
        once = P.append_checkpoint(NOTES, LINE, "s1")
        self.assertIsNone(P.append_checkpoint(once, LINE.replace("16:00", "16:30"), "s1"))

    def test_another_sessions_auto_checkpoint_does_not_block(self):
        other = NOTES + P.checkpoint_line("s2", "", "w", "auto") + "\n"
        self.assertIsNotNone(P.append_checkpoint(other, LINE, "s1"))

    def test_not_a_session_notes_file(self):
        self.assertIsNone(P.append_checkpoint("# just a readme\n", LINE, "s1"))

    def test_empty_history_section(self):
        out = P.append_checkpoint("## Session history\n", LINE, "s1")
        self.assertEqual(out, "## Session history\n" + LINE + "\n")


if __name__ == "__main__":
    unittest.main()
