"""Tests for ao_checkpoint_relay: advice the Stop hook stored reaches the model once."""
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ao_checkpoint_relay as R  # noqa: E402


class TestRelay(unittest.TestCase):
    def setUp(self):
        self.state_dir = tempfile.mkdtemp()
        self.state = os.path.join(self.state_dir, "s1.json")

    def run_hook(self, env_extra=None):
        out = io.StringIO()
        env = {k: v for k, v in os.environ.items() if k != "AO_HEADLESS"}
        env.update(env_extra or {})
        with mock.patch.object(R, "STATE_DIR", self.state_dir), \
                mock.patch.dict(os.environ, env, clear=True), \
                mock.patch.object(sys, "stdin", io.StringIO(json.dumps({"session_id": "s1", "prompt": "hi"}))), \
                contextlib.redirect_stdout(out):
            R.main()
        return json.loads(out.getvalue()) if out.getvalue().strip() else None

    def test_stored_advice_is_injected_once_and_cleared(self):
        json.dump({"tiers": [75], "pending": "Context is at 76%: run /save-session."}, open(self.state, "w"))
        out = self.run_hook()
        ctx = out["hookSpecificOutput"]["additionalContext"]
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "UserPromptSubmit")
        self.assertIn("Context is at 76%", ctx)
        self.assertEqual(json.load(open(self.state)), {"tiers": [75]}, "other state is kept")
        self.assertIsNone(self.run_hook(), "said once, not on every prompt")

    def test_nothing_stored_says_nothing(self):
        self.assertIsNone(self.run_hook())
        json.dump({"tiers": []}, open(self.state, "w"))
        self.assertIsNone(self.run_hook())

    def test_headless_runs_are_left_alone(self):
        json.dump({"pending": "x"}, open(self.state, "w"))
        self.assertIsNone(self.run_hook({"AO_HEADLESS": "1"}))


if __name__ == "__main__":
    unittest.main()
