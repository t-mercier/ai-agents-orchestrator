#!/usr/bin/env python3
"""Tests for the ao_session_start hook. Run: python3 hooks/test_ao_session_start.py"""

import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ao_autosave as A  # noqa: E402
import ao_precompact as P  # noqa: E402
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


def at(stamp):
    return time.mktime(time.strptime(stamp, "%Y-%m-%d %H:%M"))


HISTORY = ("# n\n\n## Session history\n"
           "- 2026-09-09 13:00 (in progress) | session=s1 | real save\n")


class TestLastCheckpoint(unittest.TestCase):
    # The PreCompact hook writes its marker into notes.md just before SessionStart(compact)
    # runs, so the file always looks fresh then. The last real save decides.
    def test_the_precompact_marker_does_not_count_as_a_checkpoint(self):
        folder = tempfile.mkdtemp()
        notes = os.path.join(folder, "notes.md")
        with open(notes, "w") as f:
            f.write(HISTORY)
        P.run({"session_id": "s1", "trigger": "auto"}, {"s1": {"notes_path": notes}}, "2026-09-09 16:00")
        with open(notes) as f:
            content = f.read()
        self.assertIn(P.MARK, content)
        now = at("2026-09-09 16:00")
        checkpoint = S.last_checkpoint(content, os.path.getmtime(notes))
        self.assertEqual(checkpoint, at("2026-09-09 13:00"))
        out = S.context_for(notes, "compact", checkpoint, now)
        self.assertIn("just compacted", out)
        self.assertIn("180 minutes", out)

    def test_a_recent_real_save_before_the_marker_is_fresh(self):
        content = HISTORY.replace("13:00", "15:55") + P.checkpoint_line("s1", "", "2026-09-09 16:00", "auto") + "\n"
        checkpoint = S.last_checkpoint(content, at("2026-09-09 16:00"))
        self.assertNotIn("just compacted", S.context_for("/n.md", "compact", checkpoint, at("2026-09-09 16:00")))

    def test_no_history_line_falls_back_to_the_file_time(self):
        self.assertEqual(S.last_checkpoint("# n\n", 123.0), 123.0)
        self.assertEqual(S.last_checkpoint("# n\n\n## Session history\n", 123.0), 123.0)

    def test_the_marker_matches_the_precompact_hook(self):
        self.assertEqual(S.PRECOMPACT_MARK, P.MARK)


class TestTiers(unittest.TestCase):
    def test_the_save_text_names_the_stop_hook_tiers(self):
        self.assertIn("{}%".format(A.CONTEXT_TIERS[0]), S.SAVE)
        self.assertIn("{}%".format(A.BLOCKING_TIER), S.SAVE)
        self.assertNotIn("60%", S.SAVE)


if __name__ == "__main__":
    unittest.main()
