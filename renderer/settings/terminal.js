// Settings: Terminal tab — external terminal app (config) + embedded terminal prefs (live).
;(function () {
  const modal = document.getElementById('settings-modal')
  if (!modal) return
  const $ = (id) => document.getElementById(id)

  // ── Terminal appearance (localStorage via terminal.js; applies live) ──
  function populateTerminalPrefs() {
    if (!window.getTerminalPrefs) return
    const p = window.getTerminalPrefs()
    if ($('set-term-font')) $('set-term-font').value = p.font
    if ($('set-term-size')) $('set-term-size').value = p.fontSize
    if ($('set-term-bg')) $('set-term-bg').value = p.bg
    if ($('set-term-fg')) $('set-term-fg').value = p.fg
  }
  function pushTerminalPrefs() {
    if (!window.setTerminalPrefs) return
    const size = parseInt($('set-term-size').value, 10)
    window.setTerminalPrefs({
      font: $('set-term-font').value,
      fontSize: Math.max(9, Math.min(20, Number.isFinite(size) ? size : 12)),
      bg: $('set-term-bg').value,
      fg: $('set-term-fg').value,
    })
  }
  ;['set-term-font', 'set-term-size', 'set-term-bg', 'set-term-fg'].forEach(id => {
    const el = $(id)
    if (el) el.addEventListener('change', pushTerminalPrefs)
  })

  // Collect terminal app (config field).
  function collectTerminal(out) {
    out.terminalApp = $('set-terminal').value
  }

  // Register populate (for embedded prefs) and collect (for terminal app config).
  window.CSMSettings.register({
    populate: populateTerminalPrefs,
    collect: collectTerminal,
  })
})()
