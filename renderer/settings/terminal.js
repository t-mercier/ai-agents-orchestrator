// Settings: Terminal tab — external terminal app (config) + embedded terminal prefs (live).
;(function () {
  const modal = document.getElementById('settings-modal')
  if (!modal) return
  const $ = (id) => document.getElementById(id)

  // ── Terminal appearance (localStorage via terminal.js; applies live) ──
  // The model select is built from window.CLAUDE_MODELS (app.js), the same list first-run
  // setup uses, so the two cannot drift. '' is not "no model": it means send no --model,
  // leaving the choice to the user's own ~/.claude/settings.json.
  function populateModel() {
    const sel = $('set-model')
    if (!sel || !window.CLAUDE_MODELS) return
    const current = (window.CSM_CONFIG || {}).claudeModel || ''
    sel.textContent = ''
    for (const [v, label] of window.CLAUDE_MODELS) {
      const o = document.createElement('option')
      o.value = v
      o.textContent = v === '' ? 'Follow my Claude Code setting' : label
      if (v === current) o.selected = true
      sel.appendChild(o)
    }
  }

  function populateTerminalPrefs() {
    populateModel()
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
    // Guard: an unpopulated select reports '' , which would silently reset a chosen model.
    const model = $('set-model')
    out.claudeModel = model && model.options.length ? model.value : ((window.CSM_CONFIG || {}).claudeModel || '')
  }

  // Register populate (for embedded prefs) and collect (for terminal app config).
  window.CSMSettings.register({
    populate: populateTerminalPrefs,
    collect: collectTerminal,
  })
})()
