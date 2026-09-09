#!/usr/bin/env python3
"""Tests for the ao_autosave hook. Run: python3 hooks/test_ao_autosave.py"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ao_autosave as A  # noqa: E402

NOW = 1_800_000_000.0
MIN = 60


class TestContext(unittest.TestCase):
    def test_reads_the_real_percentage(self):
        cache = {"sessions": {"s1": {"contextPct": 63}}}
        self.assertEqual(A.context_pct(cache, "s1"), 63)

    def test_unknown_session_or_junk_is_none(self):
        self.assertIsNone(A.context_pct({"sessions": {}}, "s1"))
        self.assertIsNone(A.context_pct({"sessions": {"s1": {"contextPct": "n/a"}}}, "s1"))
        self.assertIsNone(A.context_pct(None, "s1"))


class TestDecide(unittest.TestCase):
    def fresh(self):
        # notes saved a minute ago, transcript just moved: nothing is stale.
        return dict(notes_mtime=NOW - MIN, transcript_mtime=NOW, state={}, now=NOW)

    def test_quiet_when_context_low_and_notes_fresh(self):
        reason, _ = A.decide(30, **self.fresh())
        self.assertIsNone(reason)

    def test_asks_once_at_sixty(self):
        reason, state = A.decide(61, **self.fresh())
        self.assertIn("61%", reason)
        self.assertEqual(state["tiers"], [60])
        again, _ = A.decide(65, notes_mtime=NOW - MIN, transcript_mtime=NOW, state=state, now=NOW + 5 * MIN)
        self.assertIsNone(again, "60 was announced; 65 is the same tier")

    def test_asks_again_at_eighty(self):
        state = {"tiers": [60], "last": NOW - 10 * MIN}
        reason, state = A.decide(82, notes_mtime=NOW - MIN, transcript_mtime=NOW, state=state, now=NOW)
        self.assertIn("82%", reason)
        self.assertEqual(state["tiers"], [60, 80])

    # A resume can land straight at 85 %: one reason, both tiers marked, no second nag.
    def test_jumping_past_both_tiers_is_one_reason(self):
        reason, state = A.decide(85, **self.fresh())
        self.assertIsNotNone(reason)
        self.assertEqual(state["tiers"], [60, 80])

    def test_stale_notes_with_a_moving_transcript(self):
        reason, state = A.decide(20, notes_mtime=NOW - 45 * MIN, transcript_mtime=NOW - MIN, state={}, now=NOW)
        self.assertIn("45 min ago", reason)
        self.assertEqual(state["last"], NOW)

    def test_stale_notes_but_nothing_happened_since(self):
        # Transcript older than notes: the last thing that happened was the save itself.
        reason, _ = A.decide(20, notes_mtime=NOW - 45 * MIN, transcript_mtime=NOW - 50 * MIN, state={}, now=NOW)
        self.assertIsNone(reason)

    def test_time_rule_repeats_no_more_than_every_thirty_minutes(self):
        state = {"tiers": [], "last": NOW - 10 * MIN}
        reason, _ = A.decide(20, notes_mtime=NOW - 90 * MIN, transcript_mtime=NOW, state=state, now=NOW)
        self.assertIsNone(reason)
        state = {"tiers": [], "last": NOW - 31 * MIN}
        reason, _ = A.decide(20, notes_mtime=NOW - 90 * MIN, transcript_mtime=NOW, state=state, now=NOW)
        self.assertIsNotNone(reason)

    def test_no_context_figure_still_allows_the_time_rule(self):
        reason, _ = A.decide(None, notes_mtime=NOW - 40 * MIN, transcript_mtime=NOW, state={}, now=NOW)
        self.assertIsNotNone(reason)

    def test_missing_mtimes_never_crash_or_ask(self):
        reason, _ = A.decide(None, notes_mtime=None, transcript_mtime=None, state={}, now=NOW)
        self.assertIsNone(reason)


if __name__ == "__main__":
    unittest.main()
