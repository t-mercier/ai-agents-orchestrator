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
  const spaceList = document.getElementById('set-space-list')
  const errEl = document.getElementById('set-error')
  const $ = (id) => document.getElementById(id)

  // Mirror the Rust validators (config.rs): category names are short tokens,
  // colors are #rrggbb. The <input type="color"> already guarantees the latter.
  const NAME_RE = /^[A-Za-z0-9_-]{1,20}$/
  const COLOR_RE = /^#[0-9a-fA-F]{6}$/
  const escAttr = (s) => String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/</g, '&lt;')

  function showError(msg) { errEl.textContent = msg; errEl.hidden = false }
  function clearError() { errEl.hidden = true; errEl.textContent = '' }

  // ── Spaces editor: each row = {name, path}. Renaming a space (the name changed from
  // its original) retags the categories under it on save; the path re-points scanning.
  let spaceRowSeq = 0
  function addSpaceRow(space = {}) {
    const id = `set-space-path-${spaceRowSeq++}`
    const item = document.createElement('div')
    item.className = 'settings-space-item'
    item.dataset.orig = space.name || ''   // original name → detect rename for category retag
    // Line 1: name + Browse + remove. Line 2: the selected path (set via Browse only,
    // read-only — the path input doubles as the display + the value collect() reads).
    item.innerHTML = `
      <div class="settings-space-row">
        <input class="space-name" type="text" placeholder="Name" value="${escAttr(space.name)}" spellcheck="false" autocomplete="off">
        <button type="button" class="modal-btn path-browse" data-browse="${id}">Browse…</button>
        <button type="button" class="icon-btn space-remove" title="Remove this space (its folders on disk are left untouched)">✕</button>
      </div>
      <input class="space-path" id="${id}" type="text" placeholder="No folder selected — click Browse" value="${escAttr(space.path)}" readonly spellcheck="false" autocomplete="off" title="${escAttr(space.path)}">`
    item.querySelector('.space-remove').addEventListener('click', () => item.remove())
    spaceList.appendChild(item)
  }
  function renderSpaceRows() {
    if (!spaceList) return
    spaceList.innerHTML = ''
    const roots = (window.CSM_CONFIG && Array.isArray(window.CSM_CONFIG.roots)) ? window.CSM_CONFIG.roots : []
    if (!roots.length) addSpaceRow()
    else roots.forEach(addSpaceRow)
  }

  // Name + scope are READ-ONLY labels: they mirror a real folder on disk
  // (<root>/<NAME>), so editing them here would drift from reality (the app never
  // moves folders). Renaming goes through the /rename-category skill, which moves the
  // folder + retags everything. Only the colour (a pure display preference) is editable.
  function addCatRow(cat = {}) {
    const name = cat.name || ''
    const scope = cat.scope === 'personal' ? 'personal' : 'work'
    // The named root the category lives under (its identity is (root, name), so the
    // same name can exist under several roots). Falls back to the legacy scope mapping.
    const root = cat.root || (scope === 'personal' ? 'Perso' : 'Work')
    const row = document.createElement('div')
    row.className = 'settings-cat-row'
    row.dataset.name = name
    row.dataset.scope = scope
    row.dataset.root = root
    row.innerHTML = `
      <input class="cat-color" type="color">
      <span class="cat-name-label"></span>
      <span class="cat-scope-label"></span>
      <button type="button" class="icon-btn cat-remove" title="Remove from the dashboard (the folder on disk is left untouched)">✕</button>`
    row.querySelector('.cat-color').value = COLOR_RE.test(cat.color || '') ? cat.color : '#8fd9ff'
    row.querySelector('.cat-name-label').textContent = name || '(unnamed)'
    row.querySelector('.cat-scope-label').textContent = root   // show which root, not work/personal
    row.querySelector('.cat-remove').addEventListener('click', () => row.remove())
    catList.appendChild(row)
  }

  // Fill the form from the (already-loaded, derived) config. Paths come back
  // expanded to absolute — fine to show and round-trip (expand() passes them through).
  function populate() {
    const c = window.CSM_CONFIG || {}
    const obs = c.obsidian || {}
    renderSpaceRows()
    $('set-obsidian-enabled').checked = !!obs.enabled
    $('set-work-vault').value = obs.workVaultPath || ''
    $('set-personal-vault').value = obs.personalVaultPath || ''
    $('set-terminal').value = c.terminalApp || ''
    $('set-ticket').value = c.ticketBaseUrl || ''
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
    renderCatSeed()
    renderColRows()
    renderBoardSeed()
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
    const visible = st.columns.filter(c => !c.hidden)
    colList.innerHTML = st.columns.map((c, i) => {
      // Show the EFFECTIVE colour (manual override, else scheme-derived) so the pastilles
      // preview the scheme live; index matches the board's visible-column order.
      const eff = CSMBoard.colorForColumn(st, c, Math.max(0, visible.indexOf(c)), visible.length)
      const val = /^#[0-9a-fA-F]{6}$/.test(eff) ? eff : '#8a8a8e'
      return `
      <div class="settings-col-row ${c.hidden ? 'col-hidden' : ''}" data-col-id="${c.id}">
        <input class="col-color" type="color" value="${val}" title="Column colour (overrides the scheme)">
        <input class="col-name" type="text" value="${(c.name || '').replace(/"/g, '&quot;')}" maxlength="40" spellcheck="false">
        <button type="button" class="icon-btn col-hide" title="${c.hidden ? 'Show on board' : 'Hide from board'}">${c.hidden ? EYE_OFF : EYE}</button>
        <button type="button" class="icon-btn col-up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon-btn col-down" title="Move down" ${i === st.columns.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="icon-btn col-del" title="Remove (cards move to the first column)">✕</button>
      </div>`
    }).join('')
  }
  function refreshBoardIfOpen() {
    if (window.viewMode === 'board' && window.renderBoard) window.renderBoard()
  }

  // ── Category colours: the SAME seed + scheme system as the board. Picking a seed
  // fills every category's colour input (generated via CSMBoard.paletteColor); the hex
  // persists in config on save. Seed/scheme remembered in localStorage. "None" = manual.
  const getCatSeed = () => { try { return localStorage.getItem('csm.catSeed') || '' } catch { return '' } }
  const getCatScheme = () => { try { return localStorage.getItem('csm.catScheme') || 'spectrum' } catch { return 'spectrum' } }
  function renderCatSeed() {
    const grid = $('set-cat-seed')
    if (!grid || !window.CSM_LOOKS || !window.CSMBoard) return
    const seed = getCatSeed().toLowerCase()
    const matchesLook = window.CSM_LOOKS.some(L => L.accent.toLowerCase() === seed)
    const card = (val, name, swatch) =>
      `<button type="button" class="look-card" data-cat-seed="${val}" title="${name}">${swatch}<span class="look-name">${name}</span></button>`
    const looks = window.CSM_LOOKS.map(L => card(L.accent, L.name, `<span class="look-swatch" style="background:${L.accent}"></span>`)).join('')
    const none = card('', 'None', '<span class="look-swatch" style="background:rgba(var(--tint),0.05)"></span>')
    const cv = (seed && !matchesLook) ? getCatSeed() : '#7E93B8'
    const custom = `<label class="look-card look-custom" data-cat-seed="custom" title="Custom seed">
      <span class="look-swatch look-swatch-custom"><i></i></span><span class="look-name">Custom</span>
      <input type="color" class="cat-seed-custom-input" value="${cv}">
    </label>`
    grid.innerHTML = none + looks + custom
    grid.querySelectorAll('.look-card').forEach(b => {
      const v = b.dataset.catSeed
      const active = v === '' ? !seed : v === 'custom' ? (!!seed && !matchesLook) : v.toLowerCase() === seed
      b.classList.toggle('active', active)
    })
    const scheme = getCatScheme()
    document.querySelectorAll('.cat-scheme-toggle [data-cat-scheme]').forEach(b => b.classList.toggle('active', b.dataset.catScheme === scheme))
  }
  // Fill each category row's colour input from the seed+scheme (in row order). "None"
  // seed → leave the existing manual colours untouched.
  function regenerateCatColors() {
    const seed = getCatSeed()
    if (!seed) return
    const scheme = getCatScheme()
    const inputs = [...catList.querySelectorAll('.settings-cat-row .cat-color')]
    inputs.forEach((input, i) => {
      const hex = window.CSMBoard.paletteColor(seed, scheme, i, inputs.length)
      if (hex) input.value = hex
    })
  }
  function applyCatSeed(seed) {
    try { localStorage.setItem('csm.catSeed', seed || '') } catch { /* ignore */ }
    renderCatSeed(); regenerateCatColors()
  }
  {
    const grid = $('set-cat-seed')
    if (grid) {
      grid.addEventListener('click', (e) => {
        const b = e.target.closest('.look-card[data-cat-seed]')
        if (b && b.dataset.catSeed !== 'custom') applyCatSeed(b.dataset.catSeed)
      })
      grid.addEventListener('input', (e) => {
        if (e.target.classList.contains('cat-seed-custom-input')) applyCatSeed(e.target.value)
      })
    }
    document.querySelectorAll('.cat-scheme-toggle [data-cat-scheme]').forEach(btn => btn.addEventListener('click', () => {
      try { localStorage.setItem('csm.catScheme', btn.dataset.catScheme) } catch { /* ignore */ }
      renderCatSeed(); regenerateCatColors()
    }))
  }

  // ── Board column colours: a seed (reuses the Look swatches) + a scheme ──
  function renderBoardSeed() {
    const grid = $('set-board-seed')
    if (!grid || !window.CSM_LOOKS || !window.CSMBoard) return
    const st = CSMBoard.load()
    const seed = (st.colorSeed || '').toLowerCase()
    const matchesLook = window.CSM_LOOKS.some(L => L.accent.toLowerCase() === seed)
    const card = (val, name, swatch) =>
      `<button type="button" class="look-card" data-seed="${val}" title="${name}">${swatch}<span class="look-name">${name}</span></button>`
    const looks = window.CSM_LOOKS.map(L => card(L.accent, L.name, `<span class="look-swatch" style="background:${L.accent}"></span>`)).join('')
    const none = card('', 'None', '<span class="look-swatch" style="background:rgba(var(--tint),0.05)"></span>')
    // Custom = a label wrapping a real colour input, so the native picker pops AT the card.
    const cv = (seed && !matchesLook) ? st.colorSeed : '#7E93B8'
    const custom = `<label class="look-card look-custom" data-seed="custom" title="Custom seed">
      <span class="look-swatch look-swatch-custom"><i></i></span><span class="look-name">Custom</span>
      <input type="color" class="seed-custom-input" value="${cv}">
    </label>`
    grid.innerHTML = none + looks + custom
    grid.querySelectorAll('.look-card').forEach(b => {
      const v = b.dataset.seed
      const active = v === '' ? !seed : v === 'custom' ? (!!seed && !matchesLook) : v.toLowerCase() === seed
      b.classList.toggle('active', active)
    })
    const scheme = st.colorScheme || 'spectrum'
    document.querySelectorAll('.scheme-toggle [data-scheme]').forEach(b => b.classList.toggle('active', b.dataset.scheme === scheme))
  }
  function applyBoardSeed(seed) {
    const cur = CSMBoard.load()
    let st = CSMBoard.setColorScheme(cur, seed, cur.colorScheme)
    // Picking a seed colour re-applies the scheme to ALL columns (clears prior manual
    // colours); you can then re-override individual columns. (None keeps manual colours.)
    if (seed) st = CSMBoard.clearColumnColors(st)
    CSMBoard.save(st)
    renderBoardSeed(); renderColRows(); refreshBoardIfOpen()
  }
  const seedGrid = $('set-board-seed')
  if (seedGrid) {
    // Preset/None → apply directly. Custom = the embedded <input type=color> handles itself.
    seedGrid.addEventListener('click', (e) => {
      const b = e.target.closest('.look-card'); if (!b || b.dataset.seed === 'custom') return
      applyBoardSeed(b.dataset.seed)
    })
    seedGrid.addEventListener('input', (e) => {
      if (e.target.classList.contains('seed-custom-input')) applyBoardSeed(e.target.value)
    })
  }
  document.querySelectorAll('.scheme-toggle [data-scheme]').forEach(btn => btn.addEventListener('click', () => {
    const st = CSMBoard.load()
    CSMBoard.save(CSMBoard.setColorScheme(st, st.colorSeed, btn.dataset.scheme))
    renderBoardSeed(); renderColRows(); refreshBoardIfOpen()
  }))

  // Build a clean USER config (only editable fields) — never the derived
  // scanDirs/order/colorMap/home, which Rust regenerates on load.
  function collect() {
    // Spaces (roots) from the editor. A row whose name changed from its original is a
    // rename → remember old→new so the categories under it follow.
    const rename = {}
    const roots = []
    for (const item of spaceList.querySelectorAll('.settings-space-item')) {
      const name = item.querySelector('.space-name').value.trim()
      const path = item.querySelector('.space-path').value.trim()
      if (!name) continue
      if (item.dataset.orig && item.dataset.orig !== name) rename[item.dataset.orig] = name
      roots.push({ name, path })
    }

    // Categories are folder-mirrored: only colour is editable here. PRESERVE every
    // other field from the loaded config — crucially the v2 `root` (and legacy
    // `scope`). Identity is (root, name) — the same name can live under two roots —
    // so preserve per pair, not per name. A renamed space retags the category's root.
    const prevCats = (window.CSM_CONFIG && Array.isArray(window.CSM_CONFIG.categories))
      ? window.CSM_CONFIG.categories : []
    const rootOf = (c) => c.root || (c.scope === 'personal' ? 'Perso' : 'Work')
    const byKey = new Map(prevCats.map(c => [`${rootOf(c)}\0${c.name}`, c]))
    const categories = [...catList.querySelectorAll('.settings-cat-row')].map(row => {
      const oldRoot = row.dataset.root || (row.dataset.scope === 'personal' ? 'Perso' : 'Work')
      const prev = byKey.get(`${oldRoot}\0${row.dataset.name}`) || {}
      return {
        name: row.dataset.name,
        color: row.querySelector('.cat-color').value,
        root: rename[oldRoot] || oldRoot,              // follow a space rename
        scope: prev.scope || row.dataset.scope,        // legacy — kept for back-compat / vault
      }
    })

    // Legacy workRoot/personalRoot, kept for back-compat (derive prefers `roots`):
    // map them from the like-named spaces, else the first/second.
    const byName = (re) => roots.find(r => re.test(r.name))
    const workSpace = byName(/^work$/i) || roots[0]
    const persoSpace = byName(/^(perso|personal|personnel)$/i) || roots[1] || roots[0]
    return {
      version: 1,
      roots,
      workRoot: workSpace ? workSpace.path : '',
      personalRoot: persoSpace ? persoSpace.path : '',
      categories,
      obsidian: {
        enabled: $('set-obsidian-enabled').checked,
        workVaultPath: $('set-work-vault').value.trim(),
        personalVaultPath: $('set-personal-vault').value.trim(),
      },
      ticketBaseUrl: $('set-ticket').value.trim(),
      terminalApp: $('set-terminal').value,
    }
  }

  function validate(cfg) {
    const roots = cfg.roots || []
    if (!roots.length) return 'Add at least one space.'
    const spaceNames = new Set()
    for (const r of roots) {
      if (!r.name || r.name.length > 30) return `Invalid space name "${r.name || '(empty)'}".`
      if (!r.path) return `Space "${r.name}" needs a path.`
      if (spaceNames.has(r.name)) return `Duplicate space "${r.name}".`
      spaceNames.add(r.name)
    }
    if (cfg.categories.length === 0) return 'Add at least one category.'
    const seen = new Set()
    for (const cat of cfg.categories) {
      if (!NAME_RE.test(cat.name)) {
        return `Invalid category "${cat.name || '(empty)'}" — up to 20 letters, digits, _ or -.`
      }
      // A category's space must still exist (e.g. you removed it without moving the cat).
      if (cat.root && !spaceNames.has(cat.root)) {
        return `Category "${cat.name}" is in space "${cat.root}" which isn't in your spaces — re-add that space (or remove the category) first.`
      }
      // Dedup on (root, name): the same name under two spaces is legitimate — only the
      // SAME pair twice is a real dup.
      const dkey = `${cat.root || cat.scope || ''}\0${cat.name}`
      if (seen.has(dkey)) return `Duplicate category "${cat.name}" under the same space.`
      seen.add(dkey)
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

  // Categories are added by picking EXISTING folder(s) — the app never creates or
  // renames folders (that stays in your hands / the /rename-category skill). Each
  // chosen folder must sit directly under workRoot/personalRoot (a category maps to
  // <root>/<NAME>); we derive name=basename + scope=which root. Multi-select adds
  // several at once; anything outside a root, invalid, or already present is skipped
  // with a summary.
  if ($('set-add-space')) $('set-add-space').addEventListener('click', () => addSpaceRow())

  $('set-add-cat-folder').addEventListener('click', async () => {
    if (!window.api.pickDirectories) return
    const picked = await window.api.pickDirectories()
    if (!picked || !picked.length) return
    clearError()
    const c = window.CSM_CONFIG || {}
    // The named root a picked folder's PARENT dir maps to: a v2 roots entry whose path
    // matches, else the legacy workRoot/personalRoot → Work/Perso.
    const rootForParent = (parent) => {
      const roots = Array.isArray(c.roots) ? c.roots : []
      const hit = roots.find(r => r.path === parent)
      if (hit) return hit.name
      if (parent === c.workRoot) return 'Work'
      if (parent === c.personalRoot) return 'Perso'
      return null
    }
    // Identity is (root, name) — so the SAME category name can be added under a second
    // root (e.g. AI-SYSTEM under both Work and Perso). Dedup on the pair, not the name.
    const key = (root, name) => `${root}\0${(name || '').toLowerCase()}`
    const have = new Set([...catList.querySelectorAll('.settings-cat-row')]
      .map(r => key(r.dataset.root, r.dataset.name)))
    let added = 0
    const skipped = []
    for (const path of picked) {
      const parts = path.replace(/\/+$/, '').split('/')
      const base = parts.pop() || ''
      const parent = parts.join('/')
      const root = rootForParent(parent)
      if (!root) { skipped.push(`${base} (not under a root)`); continue }
      if (!NAME_RE.test(base)) { skipped.push(`${base} (invalid name)`); continue }
      if (have.has(key(root, base))) { skipped.push(`${base} (already in ${root})`); continue }
      have.add(key(root, base))
      const scope = root === 'Perso' ? 'personal' : 'work'   // legacy, drives vault choice
      addCatRow({ name: base, scope, root, color: '#8fd9ff' })
      added += 1
    }
    if (skipped.length) {
      const roots = (Array.isArray(c.roots) ? c.roots.map(r => r.path) : [c.workRoot, c.personalRoot]).filter(Boolean)
      showError(`Added ${added}. Skipped: ${skipped.join(', ')}. Pick folders directly inside one of your roots: ${roots.join(', ') || '—'}.`)
    }
  })

  // ── Backup: export / import all UI settings (manual, file the user keeps) ──
  function allCsmKeys() {
    const out = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.indexOf('csm.') === 0) out[k] = localStorage.getItem(k)
    }
    return out
  }
  if ($('set-export')) $('set-export').addEventListener('click', async () => {
    if (!window.api || !window.api.exportSettings) return
    const res = await window.api.exportSettings(JSON.stringify(allCsmKeys(), null, 2))
    if (res && res.ok === false && window.confirmAction) {
      window.confirmAction({ title: 'Export failed', body: res.error || 'unknown error', confirmLabel: 'OK' })
    } else if (res && res.saved && window.confirmAction) {
      window.confirmAction({ title: 'Settings exported', body: 'Your settings were saved. Import this file after a reinstall.', confirmLabel: 'OK' })
    }
  })
  if ($('set-import')) $('set-import').addEventListener('click', async () => {
    if (!window.api || !window.api.importSettings) return
    const res = await window.api.importSettings()
    if (!res || !res.ok) { if (res && window.confirmAction) window.confirmAction({ title: 'Import failed', body: res.error || 'unknown error', confirmLabel: 'OK' }); return }
    if (!res.content) return   // cancelled
    let parsed
    try { parsed = JSON.parse(res.content) } catch { return }
    if (!parsed || typeof parsed !== 'object') return
    const go = window.confirmAction
      ? await window.confirmAction({ title: 'Import settings', body: 'Replace your current settings (board, looks, shortcuts…) with the imported ones? The window reloads.', confirmLabel: 'Import' }).then(c => c === 'confirm')
      : true
    if (!go) return
    Object.keys(parsed).forEach(k => { if (k.indexOf('csm.') === 0 && typeof parsed[k] === 'string') localStorage.setItem(k, parsed[k]) })
    window.location.reload()
  })

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
