const os = require('os')
const path = require('path')

const procs = new Map()        // sessionId → pty process
let exitListener = null         // optional cb(sessionId) fired when a pty exits
const VALID_SESSION_ID = /^[A-Za-z0-9_-]+$/
const RESUME_DELAY_MS = 250
// Bare model token (shell quotes are added at each call site). Single source of truth.
const CLAUDE_MODEL = 'opus[1m]'

// node-pty is a native module; inject a fake in tests via _setPtyLib so the
// lifecycle logic is unit-testable without rebuilding the binary.
let ptyLib = null
function getPtyLib() {
  if (!ptyLib) ptyLib = require('node-pty')
  return ptyLib
}

// POSIX-safe single-quote: wrap in '...', escaping any embedded ' as '\''
function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'"
}

const ENV = {
  ...process.env,
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
  // Ensure common binary paths are present (Electron may launch without a full login-shell PATH)
  PATH: ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || ''].filter(Boolean).join(':'),
}

// Register a single listener invoked (after map cleanup) whenever any pty exits.
function onExit(cb) { exitListener = cb }

function spawn(sessionId, cwd) {
  if (!VALID_SESSION_ID.test(sessionId)) throw new Error('pty-manager: invalid sessionId')
  const startDir = (cwd && path.isAbsolute(cwd)) ? cwd : os.homedir()
  const shell = process.env.SHELL || '/bin/zsh'
  const proc = getPtyLib().spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: startDir,
    env: ENV,
  })
  procs.set(sessionId, proc)

  // Lifecycle: when the shell/claude exits, drop the map entry (prevents the
  // listener + handle leak that previously accumulated orphaned entries) and
  // notify the app so any window showing this terminal can update.
  proc.onExit(() => {
    if (procs.get(sessionId) === proc) procs.delete(sessionId)
    if (exitListener) { try { exitListener(sessionId) } catch { /* ignore */ } }
  })

  // Explicit cd guarantees the right project dir so `claude --resume` finds the
  // transcript. sessionId is regex-validated; startDir is shell-quoted — no injection.
  setTimeout(() => {
    if (procs.get(sessionId) === proc) {
      proc.write(`cd ${shellQuote(startDir)} && claude --resume ${sessionId} --model '${CLAUDE_MODEL}'\r`)
    }
  }, RESUME_DELAY_MS)

  return proc
}

const has = (id) => procs.has(id)
const write = (id, data) => procs.get(id)?.write(data)
const resize = (id, cols, rows) => procs.get(id)?.resize(cols, rows)
const count = () => procs.size

function kill(id) {
  const proc = procs.get(id)
  if (proc) {
    try { proc.kill() } catch { /* already gone */ }
    procs.delete(id)
  }
}

function killAll() {
  for (const id of [...procs.keys()]) kill(id)
}

module.exports = {
  spawn, has, write, resize, kill, killAll, count, onExit, shellQuote, CLAUDE_MODEL,
  // test-only seam
  _setPtyLib: (lib) => { ptyLib = lib },
  _reset: () => { procs.clear(); exitListener = null },
}
