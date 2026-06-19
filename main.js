const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require('electron')
const path = require('path')
const os = require('os')
const { execFile } = require('child_process')
const reader = require('./data/reader')
const ptyManager = require('./data/pty-manager')

// Run a shell command in a new iTerm2 tab. The command is delivered to osascript
// as an `on run argv` argument — never interpolated into the script body — so
// there is no AppleScript or shell injection (ADR-005). Callers must shell-quote
// any interpolated values within `cmd`.
function runInItermTab(cmd) {
  execFile('osascript', [
    '-e', 'on run argv',
    '-e', 'set cmd to item 1 of argv',
    '-e', 'tell application "iTerm2"',
    '-e', 'activate',
    '-e', 'if (count of windows) = 0 then create window with default profile',
    '-e', 'set newTab to (create tab with default profile in current window)',
    '-e', 'tell current session of newTab to write text cmd',
    '-e', 'end tell',
    '-e', 'end run',
    cmd,
  ], err => { if (err) console.error('iTerm open failed:', err.message) })
}

let mainWindow
const detachedWindows = new Map()  // session key → BrowserWindow

// PTY ownership refcount (pure bookkeeping in data/pty-owners.js): the pty is
// killed when the LAST window displaying it goes away (ADR-002).
const { createPtyOwners } = require('./data/pty-owners')
const ptyOwners = createPtyOwners()
function releaseWindow(wcId) {
  for (const sessionId of ptyOwners.releaseWindow(wcId)) ptyManager.kill(sessionId)
}

function broadcast(channel, ...args) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args)
  }
}

// Route window.open / target=_blank / terminal links to the system browser
function denyAndOpenExternal(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url)
      if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.toString())
    } catch { /* ignore */ }
    return { action: 'deny' }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  denyAndOpenExternal(mainWindow.webContents)
  const wcId = mainWindow.webContents.id
  mainWindow.on('closed', () => releaseWindow(wcId))
}

nativeTheme.themeSource = 'dark'

// When a pty exits on its own (claude quits / shell exits), clear ownership and
// tell every window so the matching xterm can be disposed (ADR-010).
ptyManager.onExit((sessionId) => {
  ptyOwners.drop(sessionId)
  broadcast('pty-exit', sessionId)
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => ptyManager.killAll())

// ── Session data ──

const config = require('./data/config')
ipcMain.handle('get-config', () => config.load())
ipcMain.handle('set-config', (_, cfg) => config.save(cfg))

ipcMain.handle('get-sessions', () => reader.getAllSessionData())

ipcMain.handle('get-historical-sessions', (_, status) => {
  const activeSessions = reader.readActiveSessions()
  const running = reader.getRunningSessions()
  const runningIds = new Set(running.map(s => s.sessionId))
  // notes paths of currently ALIVE sessions only — handles restart with a new session_id
  // while still letting dead-but-/closed sessions (kept in active-sessions.json) appear in Closed
  const activeNotePaths = new Set(
    running.map(s => activeSessions[s.sessionId]?.notes_path).filter(Boolean)
  )
  return reader.getHistoricalSessions(status, { runningIds, activeNotePaths })
})

// ── Shell / external ──

ipcMain.handle('open-external', (_, url) => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
    shell.openExternal(parsed.toString())
  } catch { /* malformed URL */ }
})

ipcMain.handle('open-path', (_, p) => {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return
  shell.openPath(p)  // opens a directory in Finder (or the file with its default app)
})

ipcMain.handle('open-in-iterm', (_, { cwd, sessionId }) => {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return
  // Resolve the real working dir (closed sessions have no cwd from the renderer)
  const dir = (cwd && path.isAbsolute(cwd)) ? cwd : reader.resolveSessionCwd(sessionId)
  // Build the shell command; cd first so `claude --resume` finds the transcript.
  // sessionId is regex-validated; dir is POSIX single-quoted → shell-safe.
  const cmd = dir
    ? `cd ${ptyManager.shellQuote(dir)} && claude --resume ${sessionId} --model '${ptyManager.CLAUDE_MODEL}'`
    : `claude --resume ${sessionId} --model '${ptyManager.CLAUDE_MODEL}'`
  runInItermTab(cmd)
})

// Start a NEW session by launching `claude` + the /start skill in a new iTerm
// tab. The app writes NOTHING itself — Claude Code's /start skill creates the
// workspace, registers active-sessions.json, etc. (ADR-001 read-only preserved;
// ADR-012 app-as-launcher). All inputs validated before building the command.
const KNOWN_CATEGORIES = ['FEAT', 'BUG', 'REVIEW', 'CHORE', 'TEST', 'CPM', 'PERSO', 'AI-SYSTEM']
ipcMain.handle('start-session', (_, { category, name, ticket } = {}) => {
  if (!KNOWN_CATEGORIES.includes(category)) return { ok: false, error: 'invalid category' }
  const safeName = String(name || '').trim().replace(/[^A-Za-z0-9 _-]/g, '').slice(0, 60).trim()
  if (!safeName) return { ok: false, error: 'name required' }
  const t = String(ticket || '').trim()
  // Accept any project-key ticket (e.g. ABC-123, PROJ-4567); kept only if it matches.
  const safeTicket = /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(t) ? t.toUpperCase() : ''
  // /start parses: <CATEGORY> [<TICKET>] <name>
  const prompt = `/start ${[category, safeTicket, safeName].filter(Boolean).join(' ')}`
  const cmd = `cd ${ptyManager.shellQuote(os.homedir())} && claude --model '${ptyManager.CLAUDE_MODEL}' ${ptyManager.shellQuote(prompt)}`
  runInItermTab(cmd)
  return { ok: true }
})

// Reopen/restore a closed or archived session: launch `claude` + the /restart
// skill, which reloads the session's notes into a fresh session and re-registers
// it in active-sessions.json (un-archiving it). Launcher only — no app writes.
ipcMain.handle('restore-session', (_, { slug, sessionId } = {}) => {
  if (typeof slug !== 'string' || !/^[A-Za-z0-9._-]+$/.test(slug)) return { ok: false, error: 'invalid slug' }
  // Validate sessionId at the boundary (ADR-005) before it reaches the filesystem
  // lookup — reject anything that isn't a clean id rather than relying on the
  // downstream check. Empty/absent is allowed (cwd just falls back to home).
  if (sessionId && !VALID_SESSION_ID.test(sessionId)) return { ok: false, error: 'invalid sessionId' }
  // cd to the session's real working dir (so /restart can check out its branch),
  // resolved from the transcript; falls back to home.
  const dir = (sessionId && reader.resolveSessionCwd(sessionId)) || os.homedir()
  const prompt = `/restart ${slug}`
  const cmd = `cd ${ptyManager.shellQuote(dir)} && claude --model '${ptyManager.CLAUDE_MODEL}' ${ptyManager.shellQuote(prompt)}`
  runInItermTab(cmd)
  return { ok: true }
})

// ── PTY ──

const VALID_SESSION_ID = /^[A-Za-z0-9_-]+$/

ipcMain.handle('pty-spawn', (event, { sessionId, cwd }) => {
  if (!VALID_SESSION_ID.test(sessionId)) return
  ptyOwners.add(sessionId, event.sender.id)   // this window now displays the terminal
  if (ptyManager.has(sessionId)) return       // already running (shared with another window)
  // Resolve the real working dir (closed sessions have no cwd from the renderer)
  const dir = (cwd && path.isAbsolute(cwd)) ? cwd : reader.resolveSessionCwd(sessionId)
  const proc = ptyManager.spawn(sessionId, dir)
  // Broadcast to every window — each holds its own xterm and ignores data for
  // sessions it lacks. (map cleanup + pty-exit are handled by ptyManager.onExit)
  proc.onData(data => broadcast('pty-data', sessionId, data))
})

ipcMain.handle('pty-input', (_, { sessionId, data }) => {
  if (!VALID_SESSION_ID.test(sessionId)) return
  ptyManager.write(sessionId, data)
})

ipcMain.handle('pty-resize', (_, { sessionId, cols, rows }) => {
  if (!VALID_SESSION_ID.test(sessionId)) return
  ptyManager.resize(sessionId, cols, rows)
})

ipcMain.handle('pty-kill', (event, sessionId) => {
  if (!VALID_SESSION_ID.test(sessionId)) return
  // This window is done with the terminal; kill the pty only if no other window
  // still displays it.
  if (ptyOwners.release(sessionId, event.sender.id)) ptyManager.kill(sessionId)
})

// Toggle the calling window's always-on-top ("pin"). No user-controlled input
// beyond a boolean; acts only on the sender's own window. Returns the new state.
ipcMain.handle('set-always-on-top', (event, flag) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return false
  win.setAlwaysOnTop(!!flag)
  return win.isAlwaysOnTop()
})

// ── Detach a session into its own window ──

ipcMain.handle('detach-session', (_, key) => {
  if (typeof key !== 'string' || !key) return
  const existing = detachedWindows.get(key)
  if (existing && !existing.isDestroyed()) { existing.focus(); return }

  const win = new BrowserWindow({
    width: 560,
    height: 720,
    frame: false,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    transparent: true,
    // Normal window — not pinned above other apps (a pin toggle can come later).
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.loadFile(path.join(__dirname, 'renderer', 'detail.html'), { query: { key } })
  denyAndOpenExternal(win.webContents)
  detachedWindows.set(key, win)
  const wcId = win.webContents.id
  win.on('closed', () => {
    detachedWindows.delete(key)
    releaseWindow(wcId)   // kill this window's ptys if no other window shares them
  })
})
