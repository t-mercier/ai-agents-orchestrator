#!/usr/bin/env python3
"""Tests for the ao_session_start hook. Run: python3 hooks/test_ao_session_start.py"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ao_session_start as S  # noqa: E402

NOW = 1_800_000_000.0


class TestContext(unittest.TestCase):
    def test_tracked_session_names_its_notes_and_both_habits(self):
        out = S.context_for("/w/FEAT/x/notes.md", "startup", NOW - 60, NOW)
        self.assertIn("/w/FEAT/x/notes.md", out)
        self.assertIn("/learn", out)
        self.assertIn("/save-session", out)
        self.assertNotIn("just compacted", out)

    def test_after_compaction_with_stale_notes_asks_for_the_save_first(self):
        out = S.context_for("/n.md", "compact", NOW - 40 * 60, NOW)
        self.assertIn("just compacted", out)
        self.assertIn("40 minutes", out)
        self.assertLess(out.index("run /save-session now"), out.index("Run /learn"))

    def test_after_compaction_with_fresh_notes_does_not(self):
        out = S.context_for("/n.md", "compact", NOW - 5 * 60, NOW)
        self.assertNotIn("just compacted", out)

    def test_untracked_session_gets_the_learn_habit_only_conditionally_the_save(self):
        out = S.context_for(None, "startup", None, NOW)
        self.assertIn("/learn", out)
        self.assertIn("If /start-session registers", out)
        self.assertNotIn("tracked by", out)


if __name__ == "__main__":
    unittest.main()
