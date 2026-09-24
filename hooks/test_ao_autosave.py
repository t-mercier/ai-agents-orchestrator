#!/usr/bin/env python3
"""Tests for the ao_autosave hook. Run: python3 hooks/test_ao_autosave.py"""

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

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
        # The reset is part of the state, not only of this call: a quiet turn that keeps
        # [75, 90] stored would let the second climb pass both tiers in silence.
        self.assertEqual(state["tiers"], [], "the dip below the lowest tier re-arms the stored tiers")
        reason, _blocking, state = A.decide(25, notes_mtime=NOW - 45 * MIN, transcript_mtime=NOW, state=state, now=NOW)
        self.assertIsNotNone(reason, "the time rule still applies")
        self.assertEqual(state["tiers"], [], "and the stored tiers are cleared with it")
        reason, _b3, state = A.decide(76, notes_mtime=NOW - MIN, transcript_mtime=NOW, state={"tiers": [75, 90], "last": 0}, now=NOW)
        # Context only shrinks through a compaction or a clear, so 76 under a marked 90 is a
        # new climb whose dip went unseen, not a hover: it re-arms and advises.
        self.assertIn("76%", reason, "a figure under an announced tier is a new climb")
        reason, _b4, state = A.decide(76, notes_mtime=NOW - MIN, transcript_mtime=NOW, state={"tiers": [], "last": 0}, now=NOW)
        self.assertIn("76%", reason)

    def test_hovering_under_the_top_tier_stays_quiet(self):
        reason, _b, _ = A.decide(80, notes_mtime=NOW - MIN, transcript_mtime=NOW, state={"tiers": [75], "last": 0}, now=NOW)
        self.assertIsNone(reason)

    # Replays a compaction through decide(), carrying the state the way main() stores it.
    def test_the_second_climb_asks_again_at_both_tiers(self):
        state, seen = {}, []
        for step, context in enumerate([76, 91, 25, 30, 50, 76, 91]):
            reason, blocking, state = A.decide(context, notes_mtime=NOW - MIN, transcript_mtime=NOW,
                                               state=state, now=NOW + step)
            seen.append((context, bool(reason), blocking))
        self.assertEqual(seen, [(76, True, False), (91, True, True), (25, False, False), (30, False, False),
                                (50, False, False), (76, True, False), (91, True, True)])

    def test_a_quiet_turn_with_nothing_to_reset_returns_the_state_untouched(self):
        state = {"tiers": [], "last": NOW - MIN}
        _r, _b, new = A.decide(30, notes_mtime=NOW - MIN, transcript_mtime=NOW, state=state, now=NOW)
        self.assertIs(new, state)

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


class TestMain(unittest.TestCase):
    """main() must store the re-armed tiers even on a turn it stays silent on."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.notes = os.path.join(self.dir, "notes.md")
        open(self.notes, "w").write("# n\n")
        self.registry = os.path.join(self.dir, "active-sessions.json")
        json.dump({"s1": {"notes_path": self.notes}}, open(self.registry, "w"))
        self.cache = os.path.join(self.dir, "cache.json")
        self.state_dir = os.path.join(self.dir, "state")

    def turn(self, context):
        json.dump({"sessions": {"s1": {"contextPct": context}}}, open(self.cache, "w"))
        out = io.StringIO()
        env = {k: v for k, v in os.environ.items() if k != "AO_HEADLESS"}
        with mock.patch.object(A, "ACTIVE_SESSIONS", self.registry), \
                mock.patch.object(A, "CACHE", self.cache), \
                mock.patch.object(A, "STATE_DIR", self.state_dir), \
                mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(sys, "stdin", io.StringIO(json.dumps({"session_id": "s1"}))), \
                contextlib.redirect_stdout(out):
            A.main()
        return json.loads(out.getvalue()) if out.getvalue().strip() else None

    def stored(self):
        with open(os.path.join(self.state_dir, "s1.json")) as f:
            return json.load(f)

    def test_the_dip_is_persisted_and_the_second_climb_blocks_again(self):
        self.assertIn("systemMessage", self.turn(76))
        self.assertEqual(self.turn(91)["decision"], "block")
        self.assertIsNone(self.turn(25))
        self.assertEqual(self.stored()["tiers"], [], "the silent turn stored the reset")
        self.assertIsNone(self.turn(50))
        self.assertIn("systemMessage", self.turn(76))
        self.assertEqual(self.turn(91)["decision"], "block")

    def test_advice_is_kept_for_the_model_to_read_on_the_next_prompt(self):
        # A Stop hook's systemMessage is shown to the user only. The advice is also stored,
        # so ao_checkpoint_relay can hand it to the model with the next prompt.
        self.assertIn("systemMessage", self.turn(76))
        self.assertIn("/save-session", self.stored().get("pending", ""))
        # A block reaches the model on its own: nothing to relay.
        self.turn(91)
        self.assertNotIn("pending", self.stored())


if __name__ == "__main__":
    unittest.main()
