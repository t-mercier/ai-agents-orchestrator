// Settings: Terminal tab — external terminal app (config) + embedded terminal prefs (live).
;(function () {
  const modal = document.getElementById('settings-modal')
  if (!modal) return
  const $ = (id) => document.getElementById(id)

  // ── Terminal appearance (localStorage via terminal.js; applies live) ──
  function populateTerminalPrefs(cfg) {
    // Without this the select sat on its first option, and every Save reset the app.
    if ($('set-terminal')) $('set-terminal').value = ((cfg || window.CSM_CONFIG || {}).terminalApp) || ''
    if (!window.getTerminalPrefs) return
    const p = window.getTerminalPrefs()
    if ($('set-term-theme')) $('set-term-theme').value = p.theme
    if ($('set-term-font')) $('set-term-font').value = p.font
    if ($('set-term-size')) $('set-term-size').value = p.fontSize
    if ($('set-term-bg')) $('set-term-bg').value = p.bg
    if ($('set-term-fg')) $('set-term-fg').value = p.fg
  }
  function pushTerminalPrefs(e) {
    if (!window.setTerminalPrefs) return
    const size = parseInt($('set-term-size').value, 10)
    // A colour picked by hand only shows under Custom, so picking one switches to it.
    if (e && (e.target.id === 'set-term-bg' || e.target.id === 'set-term-fg')) $('set-term-theme').value = 'custom'
    window.setTerminalPrefs({
      theme: $('set-term-theme').value,
      font: $('set-term-font').value,
      fontSize: Math.max(9, Math.min(20, Number.isFinite(size) ? size : 13)),
      bg: $('set-term-bg').value,
      fg: $('set-term-fg').value,
    })
  }
  ;['set-term-theme', 'set-term-font', 'set-term-size', 'set-term-bg', 'set-term-fg'].forEach(id => {
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
