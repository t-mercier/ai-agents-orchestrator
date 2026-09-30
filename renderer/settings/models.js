// Settings: Models tab — the main agent (＋New starts on it) and the model each agent runs
// on. Claude Code's list is the app's own (CLAUDE_MODELS, app.js: the CLI cannot list its
// models); Codex's and Copilot's come from the CLIs themselves (agent_catalog), with
// "Other…" for a name typed by hand. All config keys, Save-gated.
;(function () {
  const modal = document.getElementById('settings-modal')
  if (!modal) return
  const $ = (id) => document.getElementById(id)
  const NAMES = { claude: 'Claude Code', codex: 'Codex', copilot: 'Copilot' }
  const SIGN_IN = { claude: 'claude', codex: 'codex login', copilot: 'copilot login' }
  const OTHER = '__other'
  const cfgNow = () => window.CSM_CONFIG || {}
  let catalog = null   // asked once per app run, like the agent probe

  function populateClaude() {
    const sel = $('set-model')
    if (!sel || !window.CLAUDE_MODELS) return
    const current = cfgNow().claudeModel || ''
    sel.textContent = ''
    const known = window.CLAUDE_MODELS.some(([v]) => v === current)
    for (const [v, label] of window.CLAUDE_MODELS) {
      const o = document.createElement('option')
      o.value = v
      o.textContent = v === '' ? 'Follow my Claude Code setting' : label
      sel.appendChild(o)
    }
    // A model set by hand in config.json stays offered, so a Save cannot drop it.
    if (!known) {
      const o = document.createElement('option')
      o.value = current
      o.textContent = current
      sel.appendChild(o)
    }
    sel.value = current
  }

  // The pick list of one agent: its default, the models its CLI lists, then Other….
  function fillPick(agent, models) {
    const pick = $(`set-${agent}-model-pick`), typed = $(`set-${agent}-model`)
    if (!pick || !typed) return
    const current = (cfgNow()[`${agent}Model`] || '').trim()
    pick.textContent = ''
    const add = (value, label) => {
      const o = document.createElement('option')
      o.value = value
      o.textContent = label
      pick.appendChild(o)
    }
    add('', `${NAMES[agent]}'s default`)
    for (const m of models) add(m.id, m.label && m.label !== m.id ? `${m.label} (${m.id})` : m.id)
    add(OTHER, 'Other…')
    const listed = current === '' || models.some(m => m.id === current)
    pick.value = listed ? current : OTHER
    typed.value = current
    showTyped(agent)
  }

  function showTyped(agent) {
    const pick = $(`set-${agent}-model-pick`), typed = $(`set-${agent}-model`)
    const row = typed && typed.closest('.model-typed')
    if (!pick || !row) return
    row.hidden = pick.value !== OTHER
    if (pick.value !== OTHER) typed.value = pick.value
  }

  function statusLine(agent, found, info) {
    const el = $(`set-${agent}-status`)
    if (!el) return
    if (!found) { el.textContent = 'Not installed on this machine.'; return }
    if (info && info.signedIn === false) {
      el.innerHTML = `Not signed in. Sign in with <code>${SIGN_IN[agent]}</code> in a terminal.`
      return
    }
    const n = info && Array.isArray(info.models) ? info.models.length : 0
    const signed = info && info.signedIn === true ? 'Signed in' : 'Installed'
    el.textContent = agent === 'claude' ? `${signed}.` : n ? `${signed} · ${n} models, as ${NAMES[agent]} lists them.` : `${signed}.`
  }

  function markMainAgent(usable, cat) {
    const sel = $('set-main-agent')
    if (!sel) return
    for (const o of sel.options) {
      const a = o.value
      const signedOut = cat && cat[a] && cat[a].signedIn === false
      o.textContent = a !== 'claude' && !usable.has(a) ? `${NAMES[a]} (not installed)`
        : signedOut ? `${NAMES[a]} (not signed in)` : NAMES[a]
    }
  }

  function populateModels(cfg) {
    const c = cfg || cfgNow()
    populateClaude()
    if ($('set-main-agent')) $('set-main-agent').value = c.mainAgent || 'claude'
    for (const a of ['codex', 'copilot']) fillPick(a, [])
    const agents = window.knownAgents ? window.knownAgents() : Promise.resolve([])
    const cat = catalog ? Promise.resolve(catalog)
      : (window.api.agentCatalog ? window.api.agentCatalog() : Promise.resolve(null)).then(r => {
        if (r && !r.error) catalog = r
        return r && !r.error ? r : null
      })
    Promise.all([agents, cat]).then(([list, info]) => {
      const usable = new Set((Array.isArray(list) ? list : []).filter(x => x.found && x.supported).map(x => x.agent))
      markMainAgent(usable, info)
      for (const a of ['claude', 'codex', 'copilot']) statusLine(a, a === 'claude' || usable.has(a), info && info[a])
      for (const a of ['codex', 'copilot']) fillPick(a, (info && info[a] && info[a].models) || [])
    })
  }

  for (const a of ['codex', 'copilot']) {
    const pick = $(`set-${a}-model-pick`)
    if (pick) pick.addEventListener('change', () => showTyped(a))
  }

  function collectModels(out) {
    const c = cfgNow()
    // Guard: an unpopulated select reports '', which would silently reset a chosen model.
    const model = $('set-model')
    out.claudeModel = model && model.options.length ? model.value : (c.claudeModel || '')
    out.mainAgent = $('set-main-agent') ? $('set-main-agent').value : (c.mainAgent || 'claude')
    for (const a of ['codex', 'copilot']) {
      const typed = $(`set-${a}-model`)
      out[`${a}Model`] = typed ? typed.value.trim() : (c[`${a}Model`] || '')
    }
  }

  // The backend refuses these too; saying it here keeps the other edits in the modal.
  function validateModels(out) {
    const ok = window.CSMOtherModels ? window.CSMOtherModels.validModel : (m => /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,63}$/.test(m))
    for (const a of ['codex', 'copilot']) {
      const m = out[`${a}Model`]
      if (m && !ok(m)) return `${NAMES[a]} model: "${m}" is not a model name (letters, digits and . _ : / [ ] -, starting with a letter or digit).`
    }
    return ''
  }

  window.CSMSettings.register({
    populate: populateModels,
    collect: collectModels,
    validate: validateModels,
  })
})()
