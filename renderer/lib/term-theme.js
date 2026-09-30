// Embedded-terminal themes and fonts: the pure part terminal.js builds on. Four named themes
// in the app's violet/teal, from darkest to lightest, plus `auto` (night when the app is
// dark, day when it is light) and `custom` (the colours picked in Settings, on the night
// palette). UMD like the other lib/ models: window.CSMTermTheme in the renderer, require()
// in jest.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMTermTheme = api
})(typeof self !== 'undefined' ? self : this, function () {
  const THEMES = {
    night: {
      background: '#121319', foreground: '#d8dae3', cursor: '#a494ff', cursorAccent: '#121319',
      selectionBackground: 'rgba(164,148,255,0.28)',
      black: '#121319', red: '#ff8a8a', green: '#7fe0b0', yellow: '#f2c572',
      blue: '#8fb4ff', magenta: '#a494ff', cyan: '#5fd4c3', white: '#d8dae3',
      brightBlack: '#6e7383', brightRed: '#ffa3a3', brightGreen: '#9debc4', brightYellow: '#f7d692',
      brightBlue: '#abc6ff', brightMagenta: '#bdb1ff', brightCyan: '#82e0d2', brightWhite: '#ffffff',
    },
    dusk: {
      background: '#2a2d38', foreground: '#dcdee6', cursor: '#b3a6ff', cursorAccent: '#2a2d38',
      selectionBackground: 'rgba(179,166,255,0.28)',
      black: '#2a2d38', red: '#ff9b9b', green: '#8fe6bb', yellow: '#f5cd85',
      blue: '#9dbcff', magenta: '#b3a6ff', cyan: '#6fdccb', white: '#dcdee6',
      brightBlack: '#8a8fa0', brightRed: '#ffb3b3', brightGreen: '#a9eecb', brightYellow: '#f8dba4',
      brightBlue: '#b8ceff', brightMagenta: '#c8bfff', brightCyan: '#8fe5d7', brightWhite: '#ffffff',
    },
    mist: {
      background: '#e4e7ee', foreground: '#23262e', cursor: '#5b49cf', cursorAccent: '#e4e7ee',
      selectionBackground: 'rgba(91,73,207,0.20)',
      black: '#23262e', red: '#b83838', green: '#146b4a', yellow: '#94600a',
      blue: '#2f5fb8', magenta: '#5b49cf', cyan: '#0b7a6d', white: '#c3c8d4',
      brightBlack: '#717789', brightRed: '#cc4b4b', brightGreen: '#1d8a5f', brightYellow: '#a86a00',
      brightBlue: '#3d6fcc', brightMagenta: '#6a58dc', brightCyan: '#0d8a7b', brightWhite: '#f6f7f9',
    },
    day: {
      background: '#ffffff', foreground: '#262a33', cursor: '#6a58dc', cursorAccent: '#ffffff',
      selectionBackground: 'rgba(106,88,220,0.18)',
      black: '#262a33', red: '#c43d3d', green: '#187a55', yellow: '#a86a00',
      blue: '#3563c4', magenta: '#6a58dc', cyan: '#0d8a7b', white: '#d6d9e1',
      brightBlack: '#8a90a0', brightRed: '#d65252', brightGreen: '#1f9466', brightYellow: '#b87800',
      brightBlue: '#4474d6', brightMagenta: '#7a69e6', brightCyan: '#119c8b', brightWhite: '#f6f7f9',
    },
  }
  const NAMES = ['auto', 'night', 'dusk', 'mist', 'day', 'custom']

  const FONTS = {
    sourcecode: "'Source Code Pro', ui-monospace, monospace",
    fira: "'Fira Code', monospace",
    jetbrains: "'JetBrains Mono', monospace",
    sfmono: 'ui-monospace, monospace',   // resolves to real SF Mono on macOS
    menlo: 'Menlo, monospace',
    monaco: 'Monaco, monospace',
  }
  const DEFAULTS = { theme: 'auto', font: 'sourcecode', fontSize: 13, bg: '#121319', fg: '#d8dae3' }
  // What the colour pickers held before themes existed. Prefs still carrying them were never
  // customised, so they move to `auto`; any other colour was a choice and stays `custom`.
  const OLD_BG = '#1c1c1e', OLD_FG = '#d9d9d9'

  function fontFamily(key) { return FONTS[key] || FONTS.sourcecode }

  /** Stored prefs, completed and moved to themes. */
  function migrate(stored) {
    const s = stored || {}
    const p = { ...DEFAULTS, ...s }
    if (!s.theme) {
      const picked = (s.bg && s.bg.toLowerCase() !== OLD_BG) || (s.fg && s.fg.toLowerCase() !== OLD_FG)
      p.theme = picked ? 'custom' : 'auto'
    }
    if (!NAMES.includes(p.theme)) p.theme = 'auto'
    return p
  }

  /** The xterm theme for these prefs; `appIsDark` decides `auto`. */
  function resolve(prefs, appIsDark) {
    const p = prefs || {}
    if (p.theme === 'custom') return { ...THEMES.night, background: p.bg, foreground: p.fg, cursorAccent: p.bg }
    const name = THEMES[p.theme] ? p.theme : (appIsDark ? 'night' : 'day')
    return { ...THEMES[name] }
  }

  return { THEMES, NAMES, FONTS, DEFAULTS, fontFamily, migrate, resolve }
})
