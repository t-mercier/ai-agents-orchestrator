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

  // The main agent and the models of Codex and Copilot (config keys; Save-gated). Agents
  // this machine does not have stay listed, marked, so a saved choice is never hidden.
  function populateAgents(cfg) {
    const c = cfg || window.CSM_CONFIG || {}
    if ($('set-main-agent')) $('set-main-agent').value = c.mainAgent || 'claude'
    if ($('set-codex-model')) $('set-codex-model').value = c.codexModel || ''
    if ($('set-copilot-model')) $('set-copilot-model').value = c.copilotModel || ''
    if (!window.knownAgents || !$('set-main-agent')) return
    window.knownAgents().then(list => {
      if (!Array.isArray(list)) return
      const usable = new Set(list.filter(a => a.found && a.supported).map(a => a.agent))
      for (const o of $('set-main-agent').options) {
        const base = { claude: 'Claude Code', codex: 'Codex', copilot: 'Copilot' }[o.value]
        o.textContent = usable.has(o.value) || o.value === 'claude' ? base : `${base} (not installed)`
      }
    })
  }

  function populateTerminalPrefs(cfg) {
    populateModel()
    populateAgents(cfg)
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
    // Guard: an unpopulated select reports '' , which would silently reset a chosen model.
    const model = $('set-model')
    out.claudeModel = model && model.options.length ? model.value : ((window.CSM_CONFIG || {}).claudeModel || '')
    out.mainAgent = $('set-main-agent') ? $('set-main-agent').value : ((window.CSM_CONFIG || {}).mainAgent || 'claude')
    out.codexModel = $('set-codex-model') ? $('set-codex-model').value.trim() : ((window.CSM_CONFIG || {}).codexModel || '')
    out.copilotModel = $('set-copilot-model') ? $('set-copilot-model').value.trim() : ((window.CSM_CONFIG || {}).copilotModel || '')
  }

  // The backend refuses these too; saying it here keeps the other edits in the modal.
  function validateAgents(out) {
    const ok = window.CSMOtherModels ? window.CSMOtherModels.validModel : (m => /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,63}$/.test(m))
    for (const [name, m] of [['Codex', out.codexModel], ['Copilot', out.copilotModel]]) {
      if (m && !ok(m)) return `${name} model: "${m}" is not a model name (letters, digits and . _ : / [ ] -, starting with a letter or digit).`
    }
    return ''
  }

  // Register populate (for embedded prefs) and collect (for terminal app config).
  window.CSMSettings.register({
    populate: populateTerminalPrefs,
    collect: collectTerminal,
    validate: validateAgents,
  })
})()
