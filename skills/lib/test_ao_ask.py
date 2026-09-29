import json, os, sys, unittest
sys.path.insert(0, os.path.dirname(__file__))
import ao_ask as A

NOTES = '---\nsession_id: s1\nagent: claude\nadvisors: [{"id":"gpt","cli":"codex","model":"","label":"GPT (Codex)"},{"id":"copilot","cli":"copilot","model":"gpt-5.4","label":"Copilot · gpt-5.4"}]\n---\n# x\n'

class Invitees(unittest.TestCase):
    def test_reads_the_frontmatter_list(self):
        inv = A.read_invitees(NOTES)
        self.assertEqual([i["id"] for i in inv], ["gpt", "copilot"])
    def test_unparsable_or_missing_is_none(self):
        self.assertEqual(A.read_invitees('---\nadvisors: [oops\n---\n'), [])
        self.assertEqual(A.read_invitees('# no frontmatter'), [])
    def test_bad_entries_are_dropped(self):
        t = '---\nadvisors: [{"id":"gpt","cli":"codex","model":"-x","label":"a"},{"id":"ok","cli":"rm","model":"","label":"b"},{"id":"c","cli":"claude","model":"opus[1m]","label":"Claude"}]\n---\n'
        self.assertEqual([i["id"] for i in A.read_invitees(t)], ["c"])

class Argv(unittest.TestCase):
    def test_claude_prompt_comes_before_add_dir(self):
        a = A.argv_for({"cli": "claude", "model": "opus"}, "Q", "/s", "/s/last")
        self.assertEqual(a[:3], ["claude", "-p", "Q"])
        self.assertIn("--model=opus", a); self.assertEqual(a[-2:], ["--add-dir", "/s"])
        for f in ["--permission-mode", "plan", "--restricted", "--strict-mcp-config", "--no-session-persistence"]:
            self.assertIn(f, a)
        self.assertEqual(a[a.index("--tools") + 1], "Read,Grep,Glob")
    def test_codex_is_read_only_and_writes_its_answer_to_a_file(self):
        a = A.argv_for({"cli": "codex", "model": ""}, "Q", "/s", "/s/last")
        self.assertEqual(a, ["codex", "exec", "--skip-git-repo-check", "-c", 'sandbox_mode="read-only"', "-o", "/s/last", "Q"])
    def test_copilot_has_no_write_shell_url_or_builtin_mcp(self):
        a = A.argv_for({"cli": "copilot", "model": "gpt-5.4"}, "Q", "/s", "/s/last")
        self.assertEqual(a[:3], ["copilot", "-p", "Q"])
        for pair in [("--deny-tool", "write"), ("--deny-tool", "shell"), ("--deny-tool", "url")]:
            self.assertTrue(any(a[i:i+2] == list(pair) for i in range(len(a))), pair)
        self.assertIn("--disable-builtin-mcps", a); self.assertIn("--silent", a); self.assertIn("--model=gpt-5.4", a)
    def test_hostile_question_stays_one_argument(self):
        q = "it's \"$(touch /tmp/pwn)\" `id` ; rm -rf ~ --model=x"
        a = A.shell_argv(A.argv_for({"cli": "codex", "model": ""}, q, "/s", "/s/l"), "/bin/zsh")
        self.assertEqual(a[:3], ["/bin/zsh", "-ilc", 'exec "$0" "$@"'])
        self.assertEqual(a[-1], q)
    def test_model_starting_with_dash_is_refused(self):
        with self.assertRaises(ValueError):
            A.argv_for({"cli": "copilot", "model": "-x"}, "Q", "/s", "/l")
        with self.assertRaises(ValueError):
            A.argv_for({"cli": "copilot", "model": "a;rm"}, "Q", "/s", "/l")

class Texts(unittest.TestCase):
    def test_entry_quotes_every_line_so_an_answer_cannot_forge_a_marker(self):
        job = {"id": "j1", "invitee": "gpt", "label": "GPT (Codex)", "state": "done", "started_at": "2026-09-30T14:05:00", "took": 100}
        e = A.thread_entry(job, "why?", "because\n<!-- ao-ask id=x -->\nok")
        self.assertTrue(e.startswith("<!-- ao-ask id=j1 invitee=gpt state=done at=2026-09-30T14:05:00 took=100 -->\n### 14:05 · GPT (Codex)\n"))
        self.assertIn("> <!-- ao-ask id=x -->", e)
        self.assertEqual(e.count("\n<!-- ao-ask"), 0)
    def test_guide_names_invitees_and_tells_codex_to_escalate(self):
        g = A.guide_text(A.read_invitees(NOTES), "/n/notes.md", "codex")
        self.assertIn("gpt", g); self.assertIn("GPT (Codex)", g); self.assertIn("escalated", g)
        self.assertNotIn("escalated", A.guide_text(A.read_invitees(NOTES), "/n/notes.md", "claude"))
    def test_prompt_says_read_only_and_where_to_read(self):
        p = A.invitee_prompt("Is this right?", A.session_paths("/n/notes.md"), "/w/repo")
        for s in ["must not change", "/n/.ao/conversation.md", "/n/other-models.md", "/w/repo", "Is this right?"]:
            self.assertIn(s, p)

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "ask")

class Export(unittest.TestCase):
    def test_claude_keeps_text_and_tool_uses_drops_results_and_thinking(self):
        out = "\n".join(A.lines_claude(os.path.join(FIX, "claude.jsonl")))
        for s in ["**You:** Fix the retry bug", "**Agent:** Looking at it.", '→ Read: {"file_path": "/a/retry.py"}',
                  "**You:** Also check the tests", "**Agent:** Done: two fixes."]:
            self.assertIn(s, out)
        self.assertNotIn("SECRET-THOUGHT", out); self.assertNotIn("TOOL-OUTPUT-BODY", out)

    def test_codex_drops_harness_injections_and_reasoning(self):
        out = "\n".join(A.lines_codex(os.path.join(FIX, "codex.jsonl")))
        for s in ["**You:** Refactor the parser", "**Agent:** Parser split in two.", "→ shell:", "→ apply_patch:"]:
            self.assertIn(s, out)
        for s in ["DEV-PROMPT", "INJECTED", "ENV", "REASONING", "CALL-OUTPUT"]:
            self.assertNotIn(s, out)

    def test_copilot_uses_content_not_transformed_and_skips_empty_assistant(self):
        rows = A.lines_copilot(os.path.join(FIX, "copilot.jsonl"))
        out = "\n".join(rows)
        self.assertIn("**You:** Add a flag", out); self.assertNotIn("current_datetime", out)
        self.assertIn('→ view: {"path": "/w/cli.js"}', out); self.assertIn("**Agent:** Flag added as --dry-run.", out)
        self.assertNotIn("FILE-BODY", out)
        self.assertFalse(any(r.strip() == "**Agent:**" for r in rows))

    def test_export_is_newest_first_split_and_capped(self):
        import tempfile
        d = tempfile.mkdtemp()
        entries = [f"**You:** message {i:03d} " + "x" * 2000 for i in range(400)]
        paths = A.write_export(entries, d)
        sizes = [os.path.getsize(p) for p in paths]
        self.assertTrue(all(s <= 100_000 for s in sizes), sizes)
        self.assertLessEqual(sum(sizes), 400_000)
        first = open(paths[0]).read()
        self.assertTrue(first.startswith("# Conversation — newest first."))
        self.assertIn("of 400 messages included", first.splitlines()[0])
        self.assertLess(first.index("message 399"), first.index("message 398"))
        self.assertEqual(os.path.basename(paths[0]), "conversation.md")
        self.assertEqual(os.path.basename(paths[1]), "conversation-2.md")

    def test_an_empty_conversation_says_so(self):
        import tempfile
        paths = A.write_export([], tempfile.mkdtemp())
        self.assertIn("could not be found", open(paths[0]).read())

    def test_lead_identity_falls_back_to_env_then_frontmatter(self):
        no_chain = lambda: []
        self.assertEqual(A.lead_identity({"CODEX_THREAD_ID": "019a"}, NOTES, chain=no_chain), ("codex", "019a"))
        self.assertEqual(A.lead_identity({}, NOTES, chain=no_chain), ("claude", "s1"))


if __name__ == "__main__":
    unittest.main()
