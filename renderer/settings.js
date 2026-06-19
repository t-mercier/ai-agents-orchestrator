// Settings modal: edits the shared config (roots, categories, Obsidian, Jira) and
// persists via window.api.setConfig. Rust re-validates and is the real guard; the
// client checks here are for fast, inline UX. Loaded after app.js so it can call
// window.reloadConfig (re-derives the config + re-renders) on a successful save.
;(function () {
  const modal = document.getElementById('settings-modal')
  if (!modal) return
  const form = document.getElementById('settings-form')
  const catList = document.getElementById('set-cat-list')
  const colList = document.getElementById('set-col-list')
  const errEl = document.getElementById('set-error')
  const $ = (id) => document.getElementById(id)

  // Mirror the Rust validators (config.rs): category names are short tokens,
  // colors are #rrggbb. The <input type="color"> already guarantees the latter.
  const NAME_RE = /^[A-Za-z0-9_-]{1,20}$/
  const COLOR_RE = /^#[0-9a-fA-F]{6}$/

  function showError(msg) { errEl.textContent = msg; errEl.hidden = false }
  function clearError() { errEl.hidden = true; errEl.textContent = '' }

  function addCatRow(cat = {}) {
    const row = document.createElement('div')
    row.className = 'settings-cat-row'
    row.innerHTML = `
      <input class="cat-name" type="text" maxlength="20" placeholder="NAME" spellcheck="false" autocomplete="off">
      <input class="cat-color" type="color">
      <select class="cat-scope">
        <option value="work">work</option>
        <option value="personal">personal</option>
      </select>
      <button type="button" class="icon-btn cat-remove" title="Remove category">✕</button>`
    row.querySelector('.cat-name').value = cat.name || ''
    row.querySelector('.cat-color').value = COLOR_RE.test(cat.color || '') ? cat.color : '#8fd9ff'
    row.querySelector('.cat-scope').value = cat.scope === 'personal' ? 'personal' : 'work'
    row.querySelector('.cat-remove').addEventListener('click', () => row.remove())
    catList.appendChild(row)
  }

  // Fill the form from the (already-loaded, derived) config. Paths come back
  // expanded to absolute — fine to show and round-trip (expand() passes them through).
  function populate() {
    const c = window.CSM_CONFIG || {}
    const obs = c.obsidian || {}
    $('set-work-root').value = c.workRoot || ''
    $('set-personal-root').value = c.personalRoot || ''
    $('set-obsidian-enabled').checked = !!obs.enabled
    $('set-work-vault').value = obs.workVaultPath || ''
    $('set-personal-vault').value = obs.personalVaultPath || ''
    $('set-terminal').value = c.terminalApp || ''
    $('set-jira').value = c.jiraBaseUrl || ''
    // Appearance reflects the current live state (localStorage), not the config.
    const theme = window.getTheme ? window.getTheme() : 'dark'
    document.querySelectorAll('.theme-toggle [data-theme-choice]').forEach(b =>
      b.classList.toggle('active', b.dataset.themeChoice === theme))
    if (window.getAccent) $('set-accent').value = window.getAccent()
    const density = window.getDensity ? window.getDensity() : 'detailed'
    document.querySelectorAll('[data-density-choice]').forEach(b =>
      b.classList.toggle('active', b.dataset.densityChoice === density))
    renderLooks()
    highlightActiveLook(window.getLook ? window.getLook().id : 'ardoise')
    const compact = window.getCompactChrome ? window.getCompactChrome() : false
    document.querySelectorAll('.compact-toggle [data-compact-choice]').forEach(b =>
      b.classList.toggle('active', (b.dataset.compactChoice === '1') === compact))
    renderKeys()
    catList.innerHTML = ''
    const cats = Array.isArray(c.categories) ? c.categories : []
    if (cats.length === 0) addCatRow()
    else cats.forEach(addCatRow)
    renderColRows()
    populateTerminalPrefs()
    clearError()
    showSettingsTab('general')   // always open on the first tab
  }

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

  // Tab nav: show the matching panel; one shared form so Save/Cancel span all tabs.
  function showSettingsTab(name) {
    modal.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t.dataset.settingsTab === name))
    modal.querySelectorAll('.settings-panel').forEach(p => p.classList.toggle('active', p.dataset.settingsPanel === name))
  }
  const settingsNav = modal.querySelector('.settings-nav')
  if (settingsNav) settingsNav.addEventListener('click', (e) => {
    const tab = e.target.closest('.settings-tab')
    if (tab) showSettingsTab(tab.dataset.settingsTab)
  })

  // ── Kanban columns editor (localStorage via CSMBoard; applies live) ──
  const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>'
  const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>'

  function renderColRows() {
    if (!colList || !window.CSMBoard) return
    const st = CSMBoard.load()
    colList.innerHTML = st.columns.map((c, i) => `
      <div class="settings-col-row ${c.hidden ? 'col-hidden' : ''}" data-col-id="${c.id}">
        <input class="col-color" type="color" value="${/^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : '#8a8a8e'}" title="Title color">
        <input class="col-name" type="text" value="${(c.name || '').replace(/"/g, '&quot;')}" maxlength="40" spellcheck="false">
        <button type="button" class="icon-btn col-hide" title="${c.hidden ? 'Show on board' : 'Hide from board'}">${c.hidden ? EYE_OFF : EYE}</button>
        <button type="button" class="icon-btn col-up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon-btn col-down" title="Move down" ${i === st.columns.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="icon-btn col-del" title="Remove (cards move to the first column)">✕</button>
      </div>`).join('')
  }
  function refreshBoardIfOpen() {
    if (window.viewMode === 'board' && window.renderBoard) window.renderBoard()
  }

  // Build a clean USER config (only editable fields) — never the derived
  // scanDirs/order/colorMap/home, which Rust regenerates on load.
  function collect() {
    const categories = [...catList.querySelectorAll('.settings-cat-row')].map(row => ({
      name: row.querySelector('.cat-name').value.trim(),
      color: row.querySelector('.cat-color').value,
      scope: row.querySelector('.cat-scope').value,
    }))
    return {
      version: 1,
      workRoot: $('set-work-root').value.trim(),
      personalRoot: $('set-personal-root').value.trim(),
      categories,
      obsidian: {
        enabled: $('set-obsidian-enabled').checked,
        workVaultPath: $('set-work-vault').value.trim(),
        personalVaultPath: $('set-personal-vault').value.trim(),
      },
      jiraBaseUrl: $('set-jira').value.trim(),
      terminalApp: $('set-terminal').value,
    }
  }

  function validate(cfg) {
    if (!cfg.workRoot) return 'Work root is required.'
    if (!cfg.personalRoot) return 'Personal root is required.'
    if (cfg.categories.length === 0) return 'Add at least one category.'
    const seen = new Set()
    for (const cat of cfg.categories) {
      if (!NAME_RE.test(cat.name)) {
        return `Invalid category "${cat.name || '(empty)'}" — up to 20 letters, digits, _ or -.`
      }
      // Rust doesn't reject duplicates, but they collide in the derived colorMap/
      // scanDirs (double chips, sessions listed twice) — block them here.
      if (seen.has(cat.name)) return `Duplicate category "${cat.name}".`
      seen.add(cat.name)
      if (!COLOR_RE.test(cat.color)) return `Invalid color for "${cat.name}".`
    }
    return null
  }

  // Several controls apply LIVE (localStorage / board state) so you can preview them:
  // theme, accent, card density, terminal appearance, and the Kanban columns. They
  // must commit only on Save — Cancel/Esc reverts the whole live set to the snapshot
  // taken when the modal opened. (Config-backed fields — roots, categories, Jira,
  // Obsidian, terminal app — are already Save-gated via collect()/setConfig, so they
  // revert on Cancel for free; no snapshot needed.)
  let liveSnapshot = null
  let settingsSaved = false
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))
  function snapshotLivePrefs() {
    return {
      theme: window.getTheme ? window.getTheme() : 'dark',
      accent: window.getAccent ? window.getAccent() : '#0a84ff',
      density: window.getDensity ? window.getDensity() : 'detailed',
      compact: window.getCompactChrome ? window.getCompactChrome() : false,
      keys: window.getKeys ? window.getKeys() : null,
      terminal: window.getTerminalPrefs ? clone(window.getTerminalPrefs()) : null,
      board: window.CSMBoard ? clone(window.CSMBoard.load()) : null,
      // The active look (accent + surface tint) applies live, so capture it to revert.
      look: window.getLook ? window.getLook() : null,
    }
  }
  function restoreLivePrefs(s) {
    if (!s) return
    if (window.applyTheme) window.applyTheme(s.theme)
    if (s.look && window.applyLook) window.applyLook(s.accent, s.look.tint, s.look.tintA, s.look.id)
    else if (window.applyAccent) window.applyAccent(s.accent)
    if (window.applyDensity) window.applyDensity(s.density)
    if (window.applyCompactChrome) window.applyCompactChrome(s.compact)
    if (s.keys && window.setKeys) window.setKeys(s.keys)
    if (s.terminal && window.setTerminalPrefs) window.setTerminalPrefs(s.terminal)
    if (s.board && window.CSMBoard) { window.CSMBoard.save(s.board); refreshBoardIfOpen() }
  }
  $('settings-btn').addEventListener('click', () => {
    liveSnapshot = snapshotLivePrefs()
    settingsSaved = false
    populate()
    modal.showModal()
  })
  modal.addEventListener('close', () => {
    if (!settingsSaved) restoreLivePrefs(liveSnapshot)
    settingsSaved = false
  })
  $('set-cancel').addEventListener('click', () => modal.close())
  $('set-add-cat').addEventListener('click', () => addCatRow())

  // Appearance — apply live + persist (localStorage), independent of Save/Cancel.
  document.querySelectorAll('.theme-toggle [data-theme-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.applyTheme) window.applyTheme(btn.dataset.themeChoice)
      document.querySelectorAll('.theme-toggle [data-theme-choice]').forEach(b =>
        b.classList.toggle('active', b === btn))
    })
  })
  $('set-accent').addEventListener('input', (e) => {
    // A hand-picked accent = the Custom look (drops the surface tint).
    if (window.applyLook) window.applyLook(e.target.value, '0,0,0', 0, 'custom')
    else if (window.applyAccent) window.applyAccent(e.target.value)
    highlightActiveLook('custom')
  })

  // ── Looks (Settings → Appearance) ──
  // A look = accent + a faint surface tint. Applies LIVE and reverts on Cancel via the
  // snapshot. Category chip colours are untouched (looks are ambiance, not a recolour).
  function renderLooks() {
    const grid = $('look-grid')
    if (!grid || !window.CSM_LOOKS) return
    const cards = window.CSM_LOOKS.map(L => {
      // Show the tint a bit stronger in the tiny card than the live wash, so it reads.
      const bg = L.tintA ? `rgba(${L.tint}, ${Math.min(0.16, L.tintA * 2.6)})` : 'rgba(var(--tint), 0.05)'
      return `<button type="button" class="look-card" data-look="${L.id}" title="${L.name}">
        <span class="look-swatch" style="background:${bg}"><i style="background:${L.accent}"></i></span>
        <span class="look-name">${L.name}</span>
      </button>`
    }).join('')
    const custom = `<button type="button" class="look-card look-custom" data-look="custom" title="Custom — pick your own accent">
      <span class="look-swatch look-swatch-custom"><i></i></span>
      <span class="look-name">Custom</span>
    </button>`
    grid.innerHTML = cards + custom
  }
  function highlightActiveLook(id) {
    const grid = $('look-grid')
    if (!grid) return
    grid.querySelectorAll('.look-card').forEach(b => b.classList.toggle('active', b.dataset.look === id))
  }
  function applyLookById(id) {
    if (id === 'custom') {
      // Keep the current accent, drop the tint, and open the picker to choose a colour.
      const acc = (window.getAccent ? window.getAccent() : '#0a84ff')
      if (window.applyLook) window.applyLook(acc, '0,0,0', 0, 'custom')
      highlightActiveLook('custom')
      const inp = $('set-accent'); if (inp) { inp.value = acc; inp.focus(); if (inp.showPicker) { try { inp.showPicker() } catch {} } }
      return
    }
    const L = (window.CSM_LOOKS || []).find(x => x.id === id)
    if (!L) return
    if (window.applyLook) window.applyLook(L.accent, L.tint, L.tintA, L.id)
    if ($('set-accent')) $('set-accent').value = L.accent
    highlightActiveLook(id)
  }
  const lookGrid = $('look-grid')
  if (lookGrid) lookGrid.addEventListener('click', (e) => {
    const c = e.target.closest('.look-card')
    if (c) applyLookById(c.dataset.look)
  })

  // Compact chrome — icons-only titlebar; segmented toggle, applies live (class on <html>).
  document.querySelectorAll('.compact-toggle [data-compact-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.applyCompactChrome) window.applyCompactChrome(btn.dataset.compactChoice === '1')
      document.querySelectorAll('.compact-toggle [data-compact-choice]').forEach(b =>
        b.classList.toggle('active', b === btn))
    })
  })

  // ── Shortcuts (remap single-key actions; localStorage, applies live) ──
  const escKey = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const keyLabel = (k) => k === ' ' ? 'Space' : (k.length === 1 ? k.toUpperCase() : k)
  function renderKeys() {
    const host = $('set-keys')
    if (!host || !window.KEY_ACTIONS || !window.getKeys) return
    const keys = window.getKeys()
    host.innerHTML = window.KEY_ACTIONS.map(a => `
      <div class="key-row">
        <span class="key-label">${escKey(a.label)}</span>
        <button type="button" class="key-cap" data-key-action="${a.id}">${escKey(keyLabel(keys[a.id] || '—'))}</button>
      </div>`).join('')
  }
  let capturingKey = null
  const keysHost = $('set-keys')
  if (keysHost) keysHost.addEventListener('click', (e) => {
    const btn = e.target.closest('.key-cap'); if (!btn) return
    keysHost.querySelectorAll('.key-cap.capturing').forEach(b => b.classList.remove('capturing'))
    btn.classList.add('capturing'); btn.textContent = '…'
    capturingKey = btn.dataset.keyAction
  })
  // Capture-phase: grab the next keypress while a button is armed (beats the global nav).
  document.addEventListener('keydown', (e) => {
    if (!capturingKey) return
    e.preventDefault(); e.stopPropagation()
    if (e.key === 'Escape') { capturingKey = null; renderKeys(); return }
    if (e.key.length === 1) { if (window.setKey) window.setKey(capturingKey, e.key); capturingKey = null; renderKeys() }
  }, true)
  if ($('set-keys-reset')) $('set-keys-reset').addEventListener('click', () => { if (window.resetKeys) window.resetKeys(); renderKeys() })

  // Card density — applies live via CSS (data-attr on <html>); no re-render needed.
  document.querySelectorAll('[data-density-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.applyDensity) window.applyDensity(btn.dataset.densityChoice)
      document.querySelectorAll('[data-density-choice]').forEach(b =>
        b.classList.toggle('active', b === btn))
    })
  })

  // Kanban columns — live edits (reorder / remove / add), persisted via CSMBoard.
  if (colList) {
    colList.addEventListener('click', (e) => {
      const row = e.target.closest('.settings-col-row'); if (!row) return
      const id = row.dataset.colId
      if (e.target.closest('.col-del')) CSMBoard.save(CSMBoard.removeColumn(CSMBoard.load(), id))
      else if (e.target.closest('.col-hide')) {
        const col = CSMBoard.load().columns.find(c => c.id === id)
        CSMBoard.save(CSMBoard.setColumnHidden(CSMBoard.load(), id, !(col && col.hidden)))
      }
      else if (e.target.closest('.col-up')) CSMBoard.save(CSMBoard.moveColumn(CSMBoard.load(), id, -1))
      else if (e.target.closest('.col-down')) CSMBoard.save(CSMBoard.moveColumn(CSMBoard.load(), id, 1))
      else return
      renderColRows(); refreshBoardIfOpen()
    })
    colList.addEventListener('change', (e) => {
      const row = e.target.closest('.settings-col-row'); if (!row) return
      const id = row.dataset.colId
      if (e.target.closest('.col-name')) CSMBoard.save(CSMBoard.renameColumn(CSMBoard.load(), id, e.target.value))
      else if (e.target.closest('.col-color')) CSMBoard.save(CSMBoard.setColumnColor(CSMBoard.load(), id, e.target.value))
      else return
      refreshBoardIfOpen()
    })
    $('set-add-col').addEventListener('click', () => {
      CSMBoard.save(CSMBoard.addColumn(CSMBoard.load(), 'New column')); renderColRows(); refreshBoardIfOpen()
    })
  }

  // Browse → native folder picker; fill the paired input. On cancel the picker
  // resolves null → leave the existing value untouched.
  modal.addEventListener('click', async (e) => {
    const btn = e.target.closest('.path-browse[data-browse]')
    if (!btn) return
    const target = document.getElementById(btn.dataset.browse)
    if (!target || !window.api.pickDirectory) return
    const picked = await window.api.pickDirectory()
    if (picked) target.value = picked
  })

  // Save: validate, persist (Rust re-validates), and ONLY close on success —
  // on failure keep the modal open with an inline error so edits aren't lost.
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    clearError()
    const cfg = collect()
    const err = validate(cfg)
    if (err) { showError(err); return }
    const res = await window.api.setConfig(cfg)
    if (!res || !res.ok) {
      showError('Could not save: ' + ((res && res.error) || 'unknown error'))
      return
    }
    settingsSaved = true   // keep the live density (don't revert on the close event)
    modal.close()
    if (window.reloadConfig) await window.reloadConfig()
  })
})()
