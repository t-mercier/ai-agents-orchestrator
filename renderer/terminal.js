/* global XtermBundle */
const { Terminal, FitAddon, WebLinksAddon } = XtermBundle

const terminals = new Map()  // sessionId → { term, fitAddon, div }
let activeTerminalSession = null
let terminalVisible = false

const XTERM_THEME = {
  background:    '#1c1c1e',
  foreground:    'rgba(255,255,255,0.85)',
  cursor:        '#0a84ff',
  cursorAccent:  '#1c1c1e',
  selectionBackground: 'rgba(10,132,255,0.25)',
  black:         '#1c1c1e',  red:     '#ff453a',
  green:         '#30d158',  yellow:  '#ffd60a',
  blue:          '#0a84ff',  magenta: '#bf5af2',
  cyan:          '#5ac8fa',  white:   'rgba(255,255,255,0.85)',
  brightBlack:   '#636366',  brightRed:     '#ff6961',
  brightGreen:   '#34c759',  brightYellow:  '#ffd426',
  brightBlue:    '#409cff',  brightMagenta: '#da8fff',
  brightCyan:    '#70d7ff',  brightWhite:   '#ffffff',
}

// ── Embedded-terminal appearance prefs (Settings → Terminal tab) ──
// Live, client-side (localStorage 'csm.terminal'), like theme/accent — folds into
// the durable prefs file (#18) later. Applied to new terminals at creation and to
// every open terminal on change.
const TERMINAL_FONTS = {
  fira:      "'Fira Code', monospace",
  jetbrains: "'JetBrains Mono', monospace",
  sfmono:    'ui-monospace, monospace',   // resolves to real SF Mono on macOS
  menlo:     'Menlo, monospace',
  monaco:    'Monaco, monospace',
}
const TERM_DEFAULTS = { font: 'fira', fontSize: 12, bg: '#1c1c1e', fg: '#d9d9d9' }
function fontFamilyFor(key) { return TERMINAL_FONTS[key] || TERMINAL_FONTS.fira }
function getTerminalPrefs() {
  let p = {}
  try { p = JSON.parse(localStorage.getItem('csm.terminal') || '{}') } catch (_) {}
  return { ...TERM_DEFAULTS, ...p }
}
function termTheme(prefs) {
  return { ...XTERM_THEME, background: prefs.bg, foreground: prefs.fg }
}
// Apply current prefs to every open terminal (font/size change → refit + resize pty).
function applyTerminalPrefs() {
  const prefs = getTerminalPrefs()
  const ff = fontFamilyFor(prefs.font)
  terminals.forEach((entry, sid) => {
    entry.term.options.fontFamily = ff
    entry.term.options.fontSize = prefs.fontSize
    entry.term.options.theme = termTheme(prefs)
    if (entry.opened) {
      try {
        entry.fitAddon.fit()
        window.api.ptyResize(sid, entry.term.cols, entry.term.rows)
      } catch (_) { /* terminal not measurable right now */ }
    }
  })
}
function setTerminalPrefs(partial) {
  const next = { ...getTerminalPrefs(), ...partial }
  try { localStorage.setItem('csm.terminal', JSON.stringify(next)) } catch (_) {}
  applyTerminalPrefs()
}
window.getTerminalPrefs = getTerminalPrefs
window.setTerminalPrefs = setTerminalPrefs
window.applyTerminalPrefs = applyTerminalPrefs

// Wire incoming pty data to the right xterm instance
window.api.onPtyData((sessionId, data) => {
  const entry = terminals.get(sessionId)
  if (entry) entry.term.write(data)
})

// When the pty dies (claude/shell exited, or killed by last-window-close),
// dispose this window's xterm so it can't leak (ADR-010). If the terminal is
// currently visible, keep the pane and show a banner — it disposes on close.
window.api.onPtyExit((sessionId) => {
  const entry = terminals.get(sessionId)
  if (!entry) return
  if (activeTerminalSession === sessionId && terminalVisible) {
    entry.term.write('\r\n\x1b[2m[session ended — close to dismiss]\x1b[0m\r\n')
  } else {
    entry.term.dispose()
    entry.div.remove()
    terminals.delete(sessionId)
  }
})

function ensureTerminal(sessionId, restartSlug = '', command = '') {
  if (terminals.has(sessionId)) return terminals.get(sessionId)

  const container = document.getElementById('detail-terminal-pane')
  const div = document.createElement('div')
  div.className = 'terminal-session-div'
  div.dataset.terminalFor = sessionId
  div.style.display = 'none'
  container.appendChild(div)

  const prefs = getTerminalPrefs()
  const term = new Terminal({
    theme: termTheme(prefs),
    fontFamily: fontFamilyFor(prefs.font),
    fontSize: prefs.fontSize,
    lineHeight: 1.0,   // default spacing — 1.15 looked off
    cursorBlink: true,
    allowTransparency: false,
    scrollback: 5000,
  })
  const fitAddon = new FitAddon()
  // Route terminal link clicks to the system default browser (not an Electron window)
  const webLinksAddon = new WebLinksAddon((event, uri) => {
    window.api.openExternal(uri)
  })
  term.loadAddon(fitAddon)
  term.loadAddon(webLinksAddon)
  // NB: term.open() is deferred to showTerminal, once the div is visible.
  // Opening while the div is display:none makes xterm measure a 0×0 char cell,
  // so FitAddon.fit() bails out (proposeDimensions returns undefined for a
  // zero cell width) and the terminal is stuck at its 80×24 default.

  // Shift+Enter → insert a newline instead of submitting. Two parts:
  //  1) e.preventDefault(): returning false alone made xterm skip ITS handling but it
  //     didn't preventDefault, so the browser still fired the Enter → a \r leaked through
  //     and submitted (every injected sequence submitted because of this leak, even ones
  //     with no \r). preventDefault on keydown kills that (and the keypress it spawns).
  //  2) Send a bracketed paste of a literal LF — Claude inserts pasted newlines verbatim
  //     (its multiline-paste behaviour), so this is a real line break, not a submit.
  //     (NB: term.paste('\n') can't be used — it normalises \n → \r in its paste prep.)
  term.attachCustomKeyEventHandler(e => {
    if (e.type === 'keydown' && e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      window.api.ptyInput(sessionId, '\x1b[200~\n\x1b[201~')
      return false
    }
    return true
  })

  term.onData(data => {
    window.api.ptyInput(sessionId, data)
  })

  // Scroll fix: WKWebView + the canvas renderer intermittently stop honouring the
  // viewport's native wheel-scroll until a drag-selection forces a render (the "stuck
  // scroll" bug). Own the wheel deterministically via xterm's scrollLines API — capture
  // phase + stopPropagation so xterm's own (flaky-here) handler can't also fire/double it.
  // Accumulate sub-line pixel deltas so trackpads still feel smooth.
  let wheelAcc = 0
  div.addEventListener('wheel', (e) => {
    const el = term.element
    if (!el) return                                   // not opened yet
    const cell = term.rows > 0 ? el.clientHeight / term.rows : 17   // exact px per row
    wheelAcc += (e.deltaMode === 1 ? e.deltaY * cell : e.deltaY)    // lines vs pixels
    const lines = Math.trunc(wheelAcc / cell)
    if (lines) { term.scrollLines(lines); wheelAcc -= lines * cell }
    e.preventDefault()
    e.stopPropagation()
  }, { passive: false, capture: true })

  const entry = { term, fitAddon, div, rendererAddon: null, spawned: false, opened: false, restartSlug, command }
  terminals.set(sessionId, entry)
  return entry  // term.open + pty spawn happen in showTerminal, once the div is visible
}

function showTerminal(sessionId, cwd, restartSlug = '', command = '') {
  document.querySelectorAll('.terminal-session-div').forEach(el => {
    el.style.display = 'none'
  })
  const entry = ensureTerminal(sessionId, restartSlug, command)
  entry.div.style.display = 'flex'
  const fitSpawn = () => {
    if (!entry.opened) {
      // First reveal: open now that the div is laid out + visible, so xterm
      // measures a real char-cell size and fit() can compute the right columns.
      entry.term.open(entry.div)
      entry.opened = true
      // Renderer: xterm's default DOM renderer. The CanvasAddon renders crisper glyphs
      // (integer-pixel cell metrics), but it PAUSES in WKWebView — it stops repainting
      // until a redraw is forced (e.g. a drag-selection). That broke wheel-scroll (the
      // position moved but the frozen canvas didn't show it) AND link hover/⌘-click (the
      // link underline never repainted, so no link was "active" to open). The DOM renderer
      // repaints on every change, so scroll + links work. (WebGL was even flakier here.)
    }
    entry.fitAddon.fit()
    if (!entry.spawned) {
      // Spawn at the measured size so the first render fills the width. A non-empty
      // restartSlug makes the pty run `/restart <slug>` instead of `--resume`.
      window.api.ptySpawn(sessionId, cwd, entry.term.cols, entry.term.rows, entry.restartSlug, entry.command)
      entry.spawned = true
    } else {
      window.api.ptyResize(sessionId, entry.term.cols, entry.term.rows)
    }
    entry.term.focus()
  }
  // Wait for fonts (char-cell width must be measured with the real monospace
  // font, else fit() under-counts columns) + a frame for layout to settle.
  const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()
  fontsReady.then(() => requestAnimationFrame(fitSpawn))
  activeTerminalSession = sessionId
}

function openTerminalPane(sessionId, cwd, restartSlug = '', command = '') {
  const infoPane = document.getElementById('detail-info-pane')
  const termPane = document.getElementById('detail-terminal-pane')
  infoPane.style.display = 'none'
  termPane.style.display = 'flex'
  terminalVisible = true
  showTerminal(sessionId, cwd, restartSlug, command)
  // Resuming makes the session live → let app.js remember it (so the panel
  // survives the Closed→Running migration) and flip the view to Running.
  if (window.onTerminalOpened) window.onTerminalOpened(sessionId)
}

// Stop SHOWING the terminal without killing it — the xterm + Rust pty stay alive
// in the terminals Map so the session keeps running in the background and can be
// re-revealed later. This is what switching sessions / toggling ⌨ off does, so
// multiple embedded terminals can run in parallel.
function hideTerminalPane() {
  const infoPane = document.getElementById('detail-info-pane')
  const termPane  = document.getElementById('detail-terminal-pane')
  termPane.style.display = 'none'
  infoPane.style.display = ''
  terminalVisible = false
  activeTerminalSession = null
}

// Deliberately END the active session: kill its pty and dispose its xterm. Wired
// only to the explicit "End session ✕" button — every other path (switch, ⌨
// toggle-off, drawer close) merely hides, so closing a view never kills claude.
function closeTerminalPane() {
  const sid = activeTerminalSession
  try {
    if (sid) {
      // Kill the pty FIRST — ending the session is the whole point, and it must not
      // be skipped if xterm teardown below throws (renderer-addon disposal can hiccup
      // in WKWebView). Otherwise claude keeps running and the pane stays stuck.
      try { window.api.ptyKill(sid) } catch (e) { console.error('ptyKill failed:', e) }
      const entry = terminals.get(sid)
      if (entry) {
        try { entry.term.dispose() } catch (e) { console.error('xterm dispose failed:', e) }
        entry.div.remove()
        terminals.delete(sid)
      }
    }
  } finally {
    // Always restore the view + clear state, even if teardown threw above.
    hideTerminalPane()
    if (window.onTerminalClosed) window.onTerminalClosed()
  }
}

// Is there a live (alive, possibly-backgrounded) terminal for this session?
function hasLiveTerminal(sessionId) {
  return terminals.has(sessionId)
}

function toggleEmbeddedTerminal(sessionId, cwd, restartSlug = '') {
  if (terminalVisible && activeTerminalSession === sessionId) {
    hideTerminalPane()   // background it (pty stays alive); "End session ✕" kills
  } else {
    openTerminalPane(sessionId, cwd, restartSlug)
  }
}

function fitActiveTerminal() {
  if (!terminalVisible || !activeTerminalSession) return
  const entry = terminals.get(activeTerminalSession)
  if (!entry) return
  entry.fitAddon.fit()
  window.api.ptyResize(activeTerminalSession, entry.term.cols, entry.term.rows)
}

window.addEventListener('resize', fitActiveTerminal)

// Fit whenever the terminal pane actually changes size — fixes the terminal
// rendering at ~3/4 size on open (layout not settled when we fit in rAF).
const termPaneEl = document.getElementById('detail-terminal-pane')
if (termPaneEl && 'ResizeObserver' in window) {
  new ResizeObserver(() => fitActiveTerminal()).observe(termPaneEl)
}

window.toggleEmbeddedTerminal = toggleEmbeddedTerminal
window.openTerminalPane = openTerminalPane
window.hideTerminalPane = hideTerminalPane
window.closeTerminalPane = closeTerminalPane
window.hasLiveTerminal = hasLiveTerminal
window.fitActiveTerminal = fitActiveTerminal
window.getTerminalVisible = () => terminalVisible
