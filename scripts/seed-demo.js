#!/usr/bin/env node
/*
 * Seed a self-contained DEMO sandbox under a throwaway $HOME so the app can be
 * shown (or recorded) with realistic, 100% synthetic data — zero real sessions,
 * zero leak, and without touching your real ~/.claude or ~/.config.
 *
 *   npm run demo         build + seed + launch the app with HOME=<sandbox>
 *   npm run demo:clean   kill the demo's helper processes + delete the sandbox
 *
 * How it works: the app finds its files via os.homedir() == $HOME. We point
 * $HOME at DEMO_HOME and fill that folder's .claude/.config/work tree. "Running"
 * sessions are real `sleep` processes (so the alive-pid check passes) tagged with
 * a status the dashboard renders as a live dot. See ADR-001 (read-only viewer).
 */
const fs = require('fs')
const path = require('path')
const cp = require('child_process')

const DEMO_HOME = process.env.DEMO_HOME || '/tmp/ai-agents-orchestrator-demo'
const WORKROOT = path.join(DEMO_HOME, 'work')
const CLAUDE = path.join(DEMO_HOME, '.claude')
const SESSIONS = path.join(CLAUDE, 'sessions')
const PROJECTS = path.join(CLAUDE, 'projects')
const PIDFILE = path.join(DEMO_HOME, '.demo-pids')

const mk = p => fs.mkdirSync(p, { recursive: true })
const cwdKey = cwd => cwd.replace(/\//g, '-')

function killOldHelpers() {
  try {
    for (const pid of fs.readFileSync(PIDFILE, 'utf8').split('\n').filter(Boolean)) {
      try { process.kill(Number(pid)) } catch { /* already gone */ }
    }
  } catch { /* no pidfile */ }
}

if (process.argv.includes('--clean')) {
  killOldHelpers()
  fs.rmSync(DEMO_HOME, { recursive: true, force: true })
  console.log(`✓ demo helpers killed + ${DEMO_HOME} removed`)
  process.exit(0)
}

// ---- fresh sandbox ----------------------------------------------------------
killOldHelpers()
fs.rmSync(DEMO_HOME, { recursive: true, force: true })
;[path.join(DEMO_HOME, '.config', 'ai-agents-orchestrator'), SESSIONS, PROJECTS, WORKROOT].forEach(mk)

// ---- demo config: work-scope only → everything stays under WORKROOT ---------
fs.writeFileSync(
  path.join(DEMO_HOME, '.config', 'ai-agents-orchestrator', 'config.json'),
  JSON.stringify({
    version: 1,
    workRoot: WORKROOT,
    categories: [
      { name: 'FEAT', color: '#7df0c0', scope: 'work' },
      { name: 'BUG', color: '#ff9eb1', scope: 'work' },
      { name: 'REVIEW', color: '#d9a86e', scope: 'work' },
      { name: 'CHORE', color: '#ffe17a', scope: 'work' },
      { name: 'TEST', color: '#cdd0d6', scope: 'work' },
    ],
    obsidian: { enabled: false, vaultPath: '' },
    jiraBaseUrl: 'https://issues.example.com/browse/',
  }, null, 2)
)

// ---- helpers to write a notes.md --------------------------------------------
const bullets = a => a.map(x => `- ${x}`).join('\n')
const numbered = a => a.join('\n')
function writeNotes(dir, s, history) {
  mk(dir)
  fs.writeFileSync(path.join(dir, 'notes.md'), `---
session_id: ${s.sid}
category: ${s.cat}
ticket: ${s.ticket || ''}
name: ${s.name}
branch: ${s.branch}
started_at: ${s.started}
---

# ${s.name}

## Goal
${s.goal}

## Branch
${s.branch}

## Decisions made
${bullets(s.decisions)}

## Files touched
${bullets(s.files)}

## Open questions
${bullets(s.open_q)}

## Next steps
${numbered(s.nexts)}

## Session history
${history}
`)
}

// ============================================================================
// CLOSED / ARCHIVED — fictional OSS project "Tasklytics" (markdown task CLI)
// ============================================================================
const HISTORICAL = [
  { cat:'FEAT', slug:'csv-export', sid:'f1a2b3c4-0001-4abc-8def-000000000001', ticket:'FEAT-142',
    name:'csv-export', branch:'feat/csv-export', started:'2026-05-28 09:00',
    goal:'Add a `--format csv` option to the `report` command so weekly summaries open in a spreadsheet.',
    decisions:['2026-05-28: Stream rows with a generator — never hold the full report in memory.',
               '2026-05-29: Quote fields with commas/newlines per RFC 4180.'],
    files:['src/report/csv.ts — CSV serializer','src/cli/report.ts — `--format` flag','tests/report/csv.test.ts — 9 cases'],
    open_q:['[x] RFC 4180 quoting','[ ] BOM for Excel? deferred'],
    nexts:['1. ~~Serializer~~','2. ~~CLI flag~~','3. Document in README'],
    hist:'- 2026-05-28 18:40 | session=f1a2b3c4-0001-4abc-8def-000000000001 | Shipped CSV export + tests, green' },
  { cat:'FEAT', slug:'dark-mode-toggle', sid:'f1a2b3c4-0002-4abc-8def-000000000002', ticket:'FEAT-150',
    name:'dark-mode-toggle', branch:'feat/dark-mode', started:'2026-06-02 10:00',
    goal:'User-facing dark mode toggle persisted to local prefs; respect the OS theme on first run.',
    decisions:['2026-06-02: prefers-color-scheme for the initial value, localStorage thereafter.'],
    files:['src/ui/theme.ts — theme store + toggle','src/ui/styles.css — dark tokens'],
    open_q:['[ ] High-contrast variant?'],
    nexts:['1. ~~Theme store~~','2. Persist toggle','3. QA on Windows'],
    hist:'- 2026-06-03 16:10 | session=f1a2b3c4-0002-4abc-8def-000000000002 | Toggle works; persistence WIP' },
  { cat:'REVIEW', slug:'pr-91-auth-middleware', sid:'f1a2b3c4-0004-4abc-8def-000000000004', ticket:'REVIEW-203',
    name:'pr-91-auth-middleware', branch:'review/pr-91', started:'2026-06-01 09:00',
    goal:'Review PR #91: extract inline auth checks into a reusable middleware.',
    decisions:['2026-06-01: Requested a guard for the empty-token case before approving.'],
    files:['(review only) src/server/middleware/auth.ts'],
    open_q:['[ ] Author addressing the empty-token guard'],
    nexts:['1. ~~First pass~~','2. Re-review after the guard lands'],
    hist:'- 2026-06-01 14:05 | session=f1a2b3c4-0004-4abc-8def-000000000004 | Reviewed; one change requested' },
  { cat:'CHORE', slug:'dep-bump-q2', sid:'f1a2b3c4-0005-4abc-8def-000000000005', ticket:'',
    name:'dep-bump-q2', branch:'chore/deps-q2', started:'2026-05-15 09:00',
    goal:'Quarterly dependency bump + lockfile audit; drop two unused packages.',
    decisions:['2026-05-15: Pin the test runner to a major to avoid surprise breakage.'],
    files:['package.json — 11 bumps','package-lock.json — regenerated'],
    open_q:['[x] Audit clean'],
    nexts:['1. ~~Bump~~','2. ~~Audit~~','3. Tag release'],
    hist:'- 2026-05-16 10:20 | session=f1a2b3c4-0005-4abc-8def-000000000005 | All green after bumps' },
  { cat:'BUG', slug:'timezone-offset', sid:'f1a2b3c4-0003-4abc-8def-000000000003', ticket:'BUG-87',
    name:'timezone-offset', branch:'fix/tz-offset', started:'2026-05-20 09:00',
    goal:'Weekly summary dates shift by one day west of UTC — group by local day, not UTC.',
    decisions:['2026-05-20: Root cause = toISOString() truncation. Switch to a local-day key.',
               '2026-05-21: Regression test pinned to America/Los_Angeles.'],
    files:['src/report/bucket.ts — local-day grouping','tests/report/tz.test.ts — regression'],
    open_q:['[x] Root cause confirmed','[x] Regression added'],
    nexts:['1. ~~Fix grouping~~','2. ~~Regression test~~','3. Backport to 1.x'],
    hist:'- 2026-05-22 11:00 | ARCHIVED — session=f1a2b3c4-0003-4abc-8def-000000000003 | Fixed + released in 2.1.1' },
  { cat:'TEST', slug:'e2e-checkout-flaky', sid:'f1a2b3c4-0006-4abc-8def-000000000006', ticket:'TEST-58',
    name:'e2e-checkout-flaky', branch:'test/e2e-checkout', started:'2026-05-10 09:00',
    goal:'Stabilize the flaky end-to-end checkout test — a race on the async cart total.',
    decisions:['2026-05-10: Replace fixed sleeps with an explicit wait-for-total assertion.'],
    files:['tests/e2e/checkout.spec.ts — deterministic waits'],
    open_q:['[x] Race identified','[ ] Watch CI for 1 week'],
    nexts:['1. ~~Deterministic waits~~','2. Monitor flake rate'],
    hist:'- 2026-05-12 13:30 | ARCHIVED — session=f1a2b3c4-0006-4abc-8def-000000000006 | Stabilized after a clean week' },
]
for (const s of HISTORICAL) writeNotes(path.join(WORKROOT, s.cat, s.slug), s, s.hist)

// ============================================================================
// RUNNING — real `sleep` processes so the alive-pid check passes; status drives
// the live dot (waiting pulses, busy, idle, shell=background/cyan).
// ============================================================================
const RUNNING = [
  { cat:'FEAT', slug:'streaming-parser', sid:'a0000001-1111-4aaa-9bbb-000000000011', ticket:'FEAT-160',
    name:'streaming-parser', branch:'feat/streaming-parser', status:'waiting',
    goal:'Stream-parse large NDJSON logs without buffering the whole file.',
    activity:'Implemented the streaming parser. Want me to add backpressure handling next?',
    prLink:'https://github.com/example/tasklytics/pull/204',
    nexts:['1. ~~Streaming parser~~','2. Backpressure','3. Bench vs the buffered path'] },
  { cat:'BUG', slug:'memory-leak-hunt', sid:'a0000002-2222-4aaa-9bbb-000000000012', ticket:'BUG-93',
    name:'memory-leak-hunt', branch:'fix/watch-rss-growth', status:'busy',
    goal:'Track down the RSS growth in the `watch` daemon over long runs.',
    activity:'Running the heap diff now — comparing snapshots at t=0 and t=10min.',
    prLink:null,
    nexts:['1. Heap-diff two snapshots','2. Find the retained set','3. Patch + soak test'] },
  { cat:'REVIEW', slug:'api-contract-review', sid:'a0000003-3333-4aaa-9bbb-000000000013', ticket:'REVIEW-211',
    name:'api-contract-review', branch:'review/api-v2', status:'idle',
    goal:'Review the v2 API contract changes for breaking nullable fields.',
    activity:'Left 3 comments on nullable fields; awaiting the author.',
    prLink:'https://github.com/example/tasklytics/pull/198',
    nexts:['1. ~~First pass~~','2. Re-check after author replies'] },
  { cat:'CHORE', slug:'ci-cache-speedup', sid:'a0000004-4444-4aaa-9bbb-000000000014', ticket:'',
    name:'ci-cache-speedup', branch:'chore/ci-cache', status:'shell',
    goal:'Speed up CI by caching the build layer between runs.',
    activity:null,
    prLink:null,
    nexts:['1. Add cache key on lockfile hash','2. Measure cold vs warm'] },
]

const activeSessions = {}
const pids = []
const now = Date.now()
for (let i = 0; i < RUNNING.length; i++) {
  const s = RUNNING[i]
  const cwd = path.join(WORKROOT, s.cat, s.slug)
  writeNotes(cwd, { ...s, started: '2026-06-05 09:00', decisions:['2026-06-05: kicked off — see Goal.'], files:['(in progress)'], open_q:['[ ] in progress'] },
             `- 2026-06-05 09:00 (in progress) | session=${s.sid} | started`)

  // a real long sleep → alive pid
  const child = cp.spawn('sleep', ['86400'], { detached: true, stdio: 'ignore' })
  child.unref()
  pids.push(child.pid)

  // sessions/<id>.json (shape per reader.readSessions)
  fs.writeFileSync(path.join(SESSIONS, `${s.sid}.json`), JSON.stringify({
    sessionId: s.sid, name: s.name, cwd, pid: child.pid, status: s.status,
    updatedAt: new Date(now - i * 9 * 60000).toISOString(),
  }, null, 2))

  // active-sessions.json entry → notes_path + category + ticket
  activeSessions[s.sid] = { notes_path: path.join(cwd, 'notes.md'), category: s.cat, ticket: s.ticket || null }

  // transcript jsonl → cwd (for resolveSessionCwd), gitBranch, prLink, last activity
  const proj = path.join(PROJECTS, cwdKey(cwd))
  mk(proj)
  const lines = [{ type: 'summary', cwd, gitBranch: s.branch, ...(s.prLink ? { prLink: s.prLink } : {}) }]
  if (s.activity) {
    lines.push({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: s.activity }] },
      timestamp: new Date(now - i * 9 * 60000).toISOString(),
      gitBranch: s.branch, ...(s.prLink ? { prLink: s.prLink } : {}),
    })
  }
  fs.writeFileSync(path.join(proj, `${s.sid}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
}

fs.writeFileSync(path.join(CLAUDE, 'active-sessions.json'), JSON.stringify(activeSessions, null, 2))
fs.writeFileSync(PIDFILE, pids.join('\n') + '\n')

console.log(`✓ Demo sandbox seeded at ${DEMO_HOME}`)
console.log(`  Running: ${RUNNING.length} (live dots: ${RUNNING.map(r => r.status).join(', ')})`)
console.log(`  Closed/Archived: ${HISTORICAL.length}`)
console.log(`  Helper PIDs: ${pids.join(', ')}  (auto-expire in 24h; 'npm run demo:clean' to remove now)`)
console.log(`\n  Launch:  HOME=${DEMO_HOME} npm start   (or: npm run demo)`)
