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
        reason, _blocking, _ = A.decide(30, **self.fresh())
        self.assertIsNone(reason)

    def test_asks_once_at_the_first_tier(self):
        reason, blocking, state = A.decide(76, **self.fresh())
        self.assertIn("76%", reason)
        self.assertFalse(blocking, "the first tier advises, it does not hijack the turn")
        self.assertEqual(state["tiers"], [75])
        again, _b2, _ = A.decide(80, notes_mtime=NOW - MIN, transcript_mtime=NOW, state=state, now=NOW + 5 * MIN)
        self.assertIsNone(again, "75 was announced; 80 is the same tier")

    def test_the_top_tier_blocks(self):
        state = {"tiers": [75], "last": NOW - 10 * MIN}
        reason, blocking, state = A.decide(91, notes_mtime=NOW - MIN, transcript_mtime=NOW, state=state, now=NOW)
        self.assertIn("91%", reason)
        self.assertTrue(blocking, "a compaction is close; this one is worth the interruption")
        self.assertIn("Do NOT close", reason,
                      "a session was closed once because its agent ran out of context")
        self.assertEqual(state["tiers"], [75, 90])

    # A resume can land straight at 93 %: one reason, both tiers marked, no second nag.
    def test_jumping_past_both_tiers_is_one_reason(self):
        reason, blocking, state = A.decide(93, **self.fresh())
        self.assertIsNotNone(reason)
        self.assertTrue(blocking, "the highest tier reached decides, not the lowest")
        self.assertEqual(state["tiers"], [75, 90])

    # After a compaction the figure drops to ~25 %; the next climb to 75 % must ask again.
    def test_tiers_re_arm_below_the_lowest_tier(self):
        state = {"tiers": [75, 90], "last": NOW - 60 * MIN}
        reason, _blocking, state = A.decide(25, notes_mtime=NOW - MIN, transcript_mtime=NOW, state=state, now=NOW)
        self.assertIsNone(reason)
        self.assertEqual(state.get("tiers", []), [75, 90], "a quiet turn leaves the stored state alone")
        reason, _blocking, state = A.decide(25, notes_mtime=NOW - 45 * MIN, transcript_mtime=NOW, state=state, now=NOW)
        self.assertIsNotNone(reason, "the time rule still applies")
        self.assertEqual(state["tiers"], [], "and the stored tiers are cleared with it")
        reason, _b3, state = A.decide(76, notes_mtime=NOW - MIN, transcript_mtime=NOW, state={"tiers": [75, 90], "last": 0}, now=NOW)
        self.assertIsNone(reason, "76 with tiers still marked and no dip recorded: hovering, not climbing")
        reason, _b4, state = A.decide(76, notes_mtime=NOW - MIN, transcript_mtime=NOW, state={"tiers": [], "last": 0}, now=NOW)
        self.assertIn("76%", reason)

    def test_stale_notes_with_a_moving_transcript(self):
        reason, blocking, state = A.decide(20, notes_mtime=NOW - 45 * MIN, transcript_mtime=NOW - MIN, state={}, now=NOW)
        self.assertIn("45 min ago", reason)
        self.assertFalse(blocking, "the half-hourly nudge must never hijack a turn")
        self.assertEqual(state["last"], NOW)

    def test_stale_notes_but_nothing_happened_since(self):
        # Transcript older than notes: the last thing that happened was the save itself.
        reason, _blocking, _ = A.decide(20, notes_mtime=NOW - 45 * MIN, transcript_mtime=NOW - 50 * MIN, state={}, now=NOW)
        self.assertIsNone(reason)

    def test_time_rule_repeats_no_more_than_every_thirty_minutes(self):
        state = {"tiers": [], "last": NOW - 10 * MIN}
        reason, _blocking, _ = A.decide(20, notes_mtime=NOW - 90 * MIN, transcript_mtime=NOW, state=state, now=NOW)
        self.assertIsNone(reason)
        state = {"tiers": [], "last": NOW - 31 * MIN}
        reason, _blocking, _ = A.decide(20, notes_mtime=NOW - 90 * MIN, transcript_mtime=NOW, state=state, now=NOW)
        self.assertIsNotNone(reason)

    def test_no_context_figure_still_allows_the_time_rule(self):
        reason, _blocking, _ = A.decide(None, notes_mtime=NOW - 40 * MIN, transcript_mtime=NOW, state={}, now=NOW)
        self.assertIsNotNone(reason)

    def test_missing_mtimes_never_crash_or_ask(self):
        reason, _blocking, _ = A.decide(None, notes_mtime=None, transcript_mtime=None, state={}, now=NOW)
        self.assertIsNone(reason)


if __name__ == "__main__":
    unittest.main()
