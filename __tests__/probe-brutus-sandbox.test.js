// scripts/probe-brutus-sandbox.sh, run against a stand-in `claude` that records its
// arguments and fails the way a logged-out install does. The probe's verdicts are
// meaningless here; what is checked is that the probe itself runs correctly.
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'probe-brutus-sandbox.sh')
const AGENTS = '{"brutus":{"description":"probe","tools":["Read","Glob","Grep","Write","Edit"],"prompt":"Your name is Brutus."}}'

function probe(bash, extraShims = {}) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-probe-'))
  const log = path.join(bin, 'args.log')
  const shims = {
    // One argument per line, then fail like a claude that is not logged in.
    claude: `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> '${log}'; done\ncat >/dev/null\necho 'Not logged in' >&2\nexit 1\n`,
    ...extraShims,
  }
  for (const [n, body] of Object.entries(shims)) fs.writeFileSync(path.join(bin, n), body, { mode: 0o755 })
  const r = spawnSync(bash, [SCRIPT], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8', timeout: 60_000 })
  const args = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n') : []
  fs.rmSync(bin, { recursive: true, force: true })
  return { out: r.stdout + r.stderr, args }
}

// Shipped: `${SANDBOX_ARGS[*]@Q}` is a silent no-op in macOS's /bin/bash 3.2, so eval
// stripped the quotes and --agents reached claude split into words.
const bashes = ['/bin/bash', 'bash'].filter((b) => spawnSync(b, ['-c', 'true']).status === 0)
test.each(bashes)('under %s, --agents reaches claude as one intact argument', (bash) => {
  const { args } = probe(bash)
  expect(args.length).toBeGreaterThan(0)
  expect(args).toContain(AGENTS)
})

// Shipped: stderr went to /dev/null, so a run that failed printed FAIL with no reason.
test('a failed claude run shows why', () => {
  const { out } = probe('bash')
  expect(out).toMatch(/FAIL[^\n]*\n[\s\S]*Not logged in/)
})

// Shipped: "a notes file cannot make it write elsewhere" passed when nothing had run.
test('the no-write-elsewhere check fails when claude did not run', () => {
  const { out } = probe('bash')
  expect(out).toMatch(/FAIL a notes file cannot make it write elsewhere/)
})

// Shipped: without shasum (a Linux box) the script aborted under set -e.
test('the probe runs to the end without shasum', () => {
  const { out } = probe('bash', { shasum: '#!/bin/sh\nexit 127\n', sha1sum: '#!/bin/sh\nexit 127\n' })
  expect(out).toMatch(/zero MCP tools/)
})
