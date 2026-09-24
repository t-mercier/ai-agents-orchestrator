// scripts/ao-statusline.sh must run the user's own statusline, whatever its shape.
// Shipped: the app passes the whole user command as ONE argument, and the wrapper ran
// `bash "$1"`, so `npx ccstatusline@latest` or `bash ~/x.sh` looked for a file of that
// name and the statusline vanished from every app-launched session.
// HOME points at a scratch dir so the cache write never touches the real ~/.claude.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'ao-statusline.sh')
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-statusline-'))
fs.mkdirSync(path.join(home, '.claude'))

const run = (...args) =>
  spawnSync('bash', [SCRIPT, ...args], {
    input: '{"session_id":"s1"}',
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  })

test('a command string with arguments runs, and sees the statusline input', () => {
  const r = run('echo hello from user statusline; cat')
  expect(r.stdout).toBe('hello from user statusline\n{"session_id":"s1"}')
  expect(r.status).toBe(0)
})

test('an interpreter plus a script path runs', () => {
  const script = path.join(home, 'real.sh')
  fs.writeFileSync(script, 'echo from real.sh\n')
  const r = run(`bash ${script}`)
  expect(r.stdout).toBe('from real.sh\n')
})

test('a ~/ path runs, with the tilde expanded', () => {
  fs.writeFileSync(path.join(home, 't.sh'), '#!/bin/sh\necho from tilde\n', { mode: 0o755 })
  expect(run('~/t.sh').stdout).toBe('from tilde\n')
})

test('a bare executable path still runs', () => {
  const script = path.join(home, 'exec.sh')
  fs.writeFileSync(script, '#!/bin/sh\necho from exec.sh\n', { mode: 0o755 })
  expect(run(script).stdout).toBe('from exec.sh\n')
})

test('a script path that is not executable still runs', () => {
  const script = path.join(home, 'plain.sh')
  fs.writeFileSync(script, 'echo from plain.sh\n', { mode: 0o644 })
  expect(run(script).stdout).toBe('from plain.sh\n')
})

test('no argument prints nothing', () => {
  const r = run()
  expect(r.stdout).toBe('')
  expect(r.status).toBe(0)
})
