// Custom keyboard shortcuts: turn a keypress into a combo string ("Mod+Shift+N"), write it
// the way the platform does (⌘⇧N / Ctrl+Shift+N), and decide whether it may be recorded.
// UMD like the other lib/ models: window.CSMKeymap in the renderer, require() in jest.
// Pure, no DOM. "Mod" is ⌘ on a Mac and Ctrl elsewhere, so one stored combo works on both;
// on a Mac, Ctrl is a modifier of its own.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMKeymap = api
})(typeof self !== 'undefined' ? self : this, function () {
  const MODS = ['Mod', 'Ctrl', 'Alt', 'Shift']
  // Named keys, by KeyboardEvent.code. Letters and digits are read from the code as well,
  // because ⌥ and ⇧ change e.key ("˜" for ⌥N) while the physical key stays the same.
  const NAMED = {
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Enter: '↩', Space: 'Space', Backspace: '⌫',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  }
  const isFn = (k) => /^F([1-9]|1[0-9])$/.test(k)
  const isKey = (k) => /^[A-Z0-9]$/.test(k) || isFn(k) || k in NAMED

  // What the system or the app already does with these; recording one would steal it.
  const RESERVED = {
    'Mod+Q': 'quits the app', 'Mod+W': 'closes the window', 'Mod+H': 'hides the app', 'Mod+M': 'minimises the window',
    'Mod+C': 'copies', 'Mod+V': 'pastes', 'Mod+X': 'cuts', 'Mod+A': 'selects all', 'Mod+Z': 'undoes', 'Mod+Shift+Z': 'redoes',
    'Mod+Space': 'opens Spotlight', 'Mod+Tab': 'switches apps',
    'Mod+K': 'asks the assistant',
    'Mod+Alt+P': 'measures how smoothly the app scrolls',
  }

  function keyOf(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3)
    if (/^Digit[0-9]$/.test(code)) return code.slice(5)
    if (isFn(code) || code in NAMED) return code
    return null
  }

  /** The combo a keydown makes, or null while only modifiers are held (or the key has no name). */
  function fromEvent(e, isMac) {
    const key = keyOf(e.code || '')
    if (!key) return null
    const mods = []
    if (isMac ? e.metaKey : e.ctrlKey) mods.push('Mod')
    if (isMac && e.ctrlKey) mods.push('Ctrl')
    if (e.altKey) mods.push('Alt')
    if (e.shiftKey) mods.push('Shift')
    return [...mods, key].join('+')
  }

  /** { mods: [...], key } for a well-formed combo, else null. */
  function parse(combo) {
    if (typeof combo !== 'string' || !combo) return null
    const parts = combo.split('+')
    const key = parts.pop()
    if (!isKey(key)) return null
    let last = -1
    for (const m of parts) {
      const i = MODS.indexOf(m)
      if (i <= last) return null   // unknown, repeated or out of order
      last = i
    }
    return { mods: parts, key }
  }

  const MAC = { Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }
  const PC = { Mod: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' }
  function label(combo, isMac) {
    const p = parse(combo)
    if (!p) return ''
    const key = NAMED[p.key] || p.key
    return isMac ? p.mods.map(m => MAC[m]).join('') + key : [...p.mods.map(m => PC[m]), key].join('+')
  }

  /** May `combo` be recorded for `action`, given the current `map` of action → combo?
   *  { ok: true } | { ok: false, why } | { ok: false, taken: <other action> } */
  function check(combo, map, action) {
    const p = parse(combo)
    if (!p) return { ok: false, why: 'Not a shortcut' }
    const typed = !p.mods.some(m => m !== 'Shift')
    if (typed && !isFn(p.key)) return { ok: false, why: 'Add ⌘, Ctrl or ⌥ — a plain key would fire while you type' }
    if (RESERVED[combo]) return { ok: false, why: `Already used: it ${RESERVED[combo]}` }
    for (const [other, c] of Object.entries(map || {})) {
      if (other !== action && c === combo) return { ok: false, taken: other }
    }
    return { ok: true }
  }

  /** The recordable entries of a stored map; anything else is dropped. */
  function clean(map) {
    const out = {}
    if (!map || typeof map !== 'object') return out
    for (const [action, combo] of Object.entries(map)) {
      if (check(combo, {}, action).ok) out[action] = combo
    }
    return out
  }

  return { fromEvent, parse, label, check, clean }
})
