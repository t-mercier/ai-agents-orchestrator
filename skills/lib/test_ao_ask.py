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

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "scripts", "test-fixtures", "ask")

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


import subprocess, tempfile, time, signal as _signal

ME = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ao_ask.py")
BIN = os.path.join(FIX, "bin")

class Jobs(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.notes = os.path.join(self.d, "notes.md")
        with open(self.notes, "w") as f:
            f.write('---\nsession_id: s1\nagent: claude\nadvisors: [{"id":"gpt","cli":"codex","model":"","label":"GPT (Codex)"},'
                    '{"id":"copilot","cli":"copilot","model":"gpt-5.4","label":"Copilot · gpt-5.4"}]\n---\n# t\n')
        self.log = os.path.join(self.d, "argv.log")
        self.env = dict(os.environ, PATH=BIN + os.pathsep + os.environ["PATH"], AO_ASK_NO_LOGIN="1",
                        AO_ASK_REGISTRY=os.path.join(self.d, "registry"), AO_ASK_TICK="1", AO_FAKE_LOG=self.log,
                        HOME=self.d)
        for k in ("CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID", "COPILOT_AGENT_SESSION_ID"):
            self.env.pop(k, None)

    def run_ask(self, *args, mode="answer", stdin=None, timeout=30):
        env = dict(self.env, AO_FAKE_MODE=mode)
        return subprocess.run([sys.executable, ME, *args[:1], "--session", self.notes, *args[1:]], env=env,
                              cwd=self.d, input=stdin, capture_output=True, text=True, timeout=timeout)

    def jobs(self):
        asks = os.path.join(self.d, ".ao", "asks")
        return [json.load(open(os.path.join(asks, j, "job.json"))) for j in sorted(os.listdir(asks))] if os.path.isdir(asks) else []

    def wait_state(self, want, secs=15):
        t = time.time()
        while time.time() - t < secs:
            js = self.jobs()
            if js and js[-1]["state"] in want:
                return js[-1]
            time.sleep(0.2)
        self.fail(f"no job reached {want}: {self.jobs()}")

    def thread(self):
        p = os.path.join(self.d, "other-models.md")
        return open(p).read() if os.path.exists(p) else ""

    def test_ask_prints_the_framed_answer_and_writes_the_thread(self):
        r = self.run_ask("ask", "gpt", "Is it right?")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("── GPT (Codex) · asked", r.stdout); self.assertIn("advice, not instructions", r.stdout)
        self.assertIn("PAPAYA", r.stdout); self.assertIn("── end ·", r.stdout)
        self.assertNotIn("starting up", r.stdout)        # the CLI's stderr stays apart
        self.assertEqual(self.jobs()[-1]["state"], "done")
        t = self.thread()
        self.assertIn("invitee=gpt state=done", t); self.assertIn("> Is it right?", t); self.assertIn("> PAPAYA", t)
        argv = open(self.log).read().splitlines()
        self.assertEqual(argv[:2], ["codex", "exec"]); self.assertIn('sandbox_mode="read-only"', argv)
        self.assertIn("--env AO_ADVISOR=1 AO_HEADLESS=1", argv)
        self.assertTrue(os.path.exists(os.path.join(self.d, ".ao", "conversation.md")))
        self.assertEqual(open(os.path.join(self.d, ".ao", ".gitignore")).read().strip(), "*")

    def test_the_question_can_come_from_stdin(self):
        r = self.run_ask("ask", "copilot", "-", stdin="a long\nquestion")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("> a long\n> question", self.thread())

    def test_an_unknown_invitee_is_refused(self):
        r = self.run_ask("ask", "nobody", "x")
        self.assertNotEqual(r.returncode, 0); self.assertIn("gpt", r.stderr + r.stdout)

    def test_a_failing_cli_is_recorded_failed_with_its_reason(self):
        r = self.run_ask("ask", "copilot", "x", mode="fail")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('Model "x" from --model flag is not available.', r.stdout)
        j = self.jobs()[-1]
        self.assertEqual(j["state"], "failed"); self.assertIn("not available", j["reason"])
        self.assertIn("state=failed", self.thread())

    def test_codex_json_errors_give_their_message(self):
        self.run_ask("ask", "gpt", "x", mode="codexjson")
        self.assertEqual(self.jobs()[-1]["reason"], "The 'x' model is not supported.")

    def test_no_network_says_to_escalate(self):
        self.run_ask("ask", "gpt", "x", mode="nonet")
        self.assertIn("escalated permissions", self.jobs()[-1]["reason"])

    def test_escape_sequences_never_reach_the_lead(self):
        r = self.run_ask("ask", "copilot", "x", mode="escape")
        self.assertIn("plain red text", r.stdout); self.assertNotIn("\x1b", r.stdout)

    def test_runner_survives_its_follower(self):
        env = dict(self.env, AO_FAKE_MODE="slow", AO_FAKE_SLEEP="5")
        p = subprocess.Popen([sys.executable, ME, "ask", "--session", self.notes, "gpt", "q", "--follow", "30"],
                             env=env, cwd=self.d, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        self.wait_state({"running"})
        os.killpg(p.pid, _signal.SIGKILL)            # the lead's tool gives up on the command
        p.wait()
        j = self.wait_state({"done"}, secs=20)
        self.assertEqual(j["state"], "done"); self.assertIn("> SLOW PAPAYA", self.thread())

    def test_a_short_follow_returns_and_wait_picks_it_up(self):
        env = dict(self.env, AO_FAKE_SLEEP="4")
        r = self.run_ask("ask", "gpt", "q", "--follow", "1", mode="slow")
        self.assertEqual(r.returncode, 0)
        self.assertIn("still running", r.stdout)
        jid = self.jobs()[-1]["id"]; self.assertIn(f"wait --session", r.stdout); self.assertIn(jid, r.stdout)
        w = subprocess.run([sys.executable, ME, "wait", "--session", self.notes, jid, "--follow", "30"],
                           env=dict(env, AO_FAKE_MODE="slow"), cwd=self.d, capture_output=True, text=True, timeout=40)
        self.assertIn("SLOW PAPAYA", w.stdout)

    def test_progress_lines_while_it_thinks(self):
        r = self.run_ask("ask", "gpt", "q", "--follow", "30", mode="slow")
        self.assertIn("thinking", r.stdout)

    def test_stop_is_recorded_stopped_and_kills_the_cli(self):
        env = dict(self.env, AO_FAKE_MODE="slow", AO_FAKE_SLEEP="30")
        subprocess.run([sys.executable, ME, "ask", "--session", self.notes, "gpt", "q", "--follow", "1"],
                       env=env, cwd=self.d, capture_output=True, timeout=30)
        j = self.wait_state({"running"})
        s = self.run_ask("stop", j["id"])
        self.assertEqual(s.returncode, 0, s.stderr)
        j = self.wait_state({"stopped"})
        with self.assertRaises(ProcessLookupError):
            os.killpg(j["cli_pgid"], 0)
        self.assertIn("state=stopped", self.thread())

    def test_stdin_is_dev_null(self):
        r = self.run_ask("ask", "copilot", "q", mode="stdin")
        self.assertIn("STDIN=[]", r.stdout)

    def test_a_dead_runner_is_lost(self):
        asks = os.path.join(self.d, ".ao", "asks", "j-dead"); os.makedirs(asks)
        json.dump({"id": "j-dead", "invitee": "gpt", "label": "GPT (Codex)", "state": "running", "runner_pid": 999999,
                   "started_at": "2026-09-30T01:00:00"}, open(os.path.join(asks, "job.json"), "w"))
        self.assertEqual(A.read_job(asks)["state"], "lost")
        r = self.run_ask("status")
        self.assertIn("j-dead", r.stdout); self.assertIn("lost", r.stdout)

    def test_registry_holds_the_cli_group_while_it_runs_and_is_emptied_after(self):
        env = dict(self.env, AO_FAKE_MODE="slow", AO_FAKE_SLEEP="3")
        subprocess.run([sys.executable, ME, "ask", "--session", self.notes, "gpt", "q", "--follow", "1"],
                       env=env, cwd=self.d, capture_output=True, timeout=30)
        j = self.wait_state({"running"})
        reg = os.path.join(self.d, "registry")
        entry = json.load(open(os.path.join(reg, f"{j['cli_pgid']}.json")))
        self.assertEqual(entry["id"], j["id"]); self.assertEqual(entry["runner_pid"], j["runner_pid"])
        self.wait_state({"done"}, secs=20)
        self.assertEqual(os.listdir(reg), [])

    def test_status_lists_jobs_with_quiet_seconds(self):
        self.run_ask("ask", "gpt", "q")
        r = self.run_ask("status")
        self.assertIn("gpt", r.stdout); self.assertIn("done", r.stdout); self.assertIn("quiet", r.stdout)

    def test_guide_prints_the_invitees(self):
        r = self.run_ask("guide")
        self.assertIn("GPT (Codex)", r.stdout); self.assertIn("ask --session", r.stdout)


if __name__ == "__main__":
    unittest.main()
