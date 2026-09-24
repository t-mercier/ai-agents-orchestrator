// scripts/check-no-secrets.sh must fail the build when a tracked file holds a secret.
// Shipped: it printed "No committed secrets" whatever was committed, because xargs exits
// 123 as soon as one file does not match and the `if` then discarded the matches; the
// private-key pattern starts with `-`, so grep read it as an option and never scanned.
// Each case runs the script inside a scratch git repo. The fake tokens are assembled at
// runtime so this file does not trip the scan itself.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'check-no-secrets.sh')
const FAKE_GH = 'gh' + 'p_' + 'abcdefghijklmnopqrstuvwxyz0123456789'
const FAKE_KEY = '-----BEGIN ' + 'RSA PRIVATE KEY-----'

function scratchRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-secrets-'))
  fs.mkdirSync(path.join(dir, 'scripts'))
  fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'check-no-secrets.sh'))
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), body)
  }
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  git('init', '-q')
  git('add', '-A')
  return dir
}

function run(dir) {
  return spawnSync('bash', [path.join(dir, 'scripts', 'check-no-secrets.sh')], { encoding: 'utf8' })
}

const clean = { 'a.txt': 'nothing here\n', 'b.js': 'const token = process.env.GITHUB_TOKEN\n' }

test('a clean repo passes', () => {
  const r = run(scratchRepo(clean))
  expect(r.stdout).toMatch(/No committed secrets detected/)
  expect(r.status).toBe(0)
})

test('a planted GitHub token fails the scan and names the file', () => {
  const r = run(scratchRepo({ ...clean, 'leak.txt': `token=${FAKE_GH}\n` }))
  expect(r.status).toBe(1)
  expect(r.stdout).toMatch(/leak\.txt:1:/)
})

test('a planted private-key block fails the scan', () => {
  const r = run(scratchRepo({ ...clean, 'key.pem.txt': `${FAKE_KEY}\nabc\n` }))
  expect(r.status).toBe(1)
  expect(r.stdout).toMatch(/key\.pem\.txt:1:/)
})

test('the secaudit test fixtures are excluded, and only them', () => {
  const r = run(scratchRepo({ ...clean, 'src-tauri/src/secaudit.rs': `// ${FAKE_GH}\n` }))
  expect(r.status).toBe(0)
  const r2 = run(scratchRepo({ ...clean, 'src-tauri/src/other.rs': `// ${FAKE_GH}\n` }))
  expect(r2.status).toBe(1)
})
