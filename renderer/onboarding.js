// First-run setup: the wizard's DOM and its three steps. Every decision lives in
// renderer/lib/onboarding-model.js, which is pure and tested; this file only renders it
// and calls the backend.
//
// The step order is load-bearing, not cosmetic. `import_session_headless` refuses a
// category the config does not carry, and the shipped seed points its "Work" space at
// `~/work` — a path that exists on almost no machine. So the taxonomy is built first, the
// sessions are then filed INTO it one by one, and only the last step writes.
//
// Each row carries its own space and category. One target for the whole batch was the
// wrong grain: sessions come from different repos, and filing them all under one category
// is work the user has to undo a card at a time afterwards.
;(function () {
  const $ = (id) => document.getElementById(id)
  const modal = $('onb-modal')
  if (!modal) return

  const O = window.CSMOnboarding
  const PAGE = 20

  let step = 1
  let raw = []               // the pages as the backend returned them
  let rows = []              // raw, sorted + named by the model
  let picked = new Set()
  let offset = 0
  let total = 0
  let cfg = null              // working copy of the config; written when step 1 is left
  let spacePresent = new Map() // space path -> does it resolve (filled by validate())
  let run = null              // { jobs, current, done } once step 3 starts
  let running = false

  // ── Step 1: what is on the machine ───────────────────────────────────────────────

  function renderSessions() {
    const list = $('onb-sessions')
    list.textContent = ''
    if (!rows.length) {
      const empty = document.createElement('div')
      empty.className = 'onb-empty'
      empty.textContent = 'No untracked sessions found — nothing to import.'
      list.appendChild(empty)
    }
    for (const r of rows) {
      const row = document.createElement('label')
      row.className = 'onb-row'
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = picked.has(r.sessionId)
      box.addEventListener('change', () => {
        if (box.checked) picked.add(r.sessionId)
        else picked.delete(r.sessionId)
        renderPicked()
      })
      const text = document.createElement('div')
      text.className = 'onb-row-text'
      const title = document.createElement('span')
      title.className = 'onb-row-title'
      title.textContent = r.title
      const meta = document.createElement('span')
      meta.className = 'onb-row-meta'
      meta.textContent = [r.cwd, r.when].filter(Boolean).join(' · ')
      text.appendChild(title)
      text.appendChild(meta)
      row.appendChild(box)
      row.appendChild(text)
      row.appendChild(targetPickers(r))
      list.appendChild(row)
    }
    renderPicked()
  }

  /// The space + category selects for one row. Wrapped in a <span> that swallows the
  /// click, because the row is a <label> and a click anywhere in it would otherwise toggle
  /// the checkbox — choosing a category would untick the session you were routing.
  function targetPickers(r) {
    const wrap = document.createElement('span')
    wrap.className = 'onb-row-target'
    wrap.addEventListener('click', (e) => e.preventDefault())
    const roots = (cfg.roots || []).map((x) => x.name).filter(Boolean)
    const spaceSel = document.createElement('select')
    spaceSel.title = 'Space'
    roots.forEach((n) => spaceSel.appendChild(opt(n)))
    spaceSel.value = r.root || roots[0] || ''
    const catSel = document.createElement('select')
    catSel.title = 'Category'
    const fillCats = () => {
      catSel.textContent = ''
      const cats = (cfg.categories || []).filter((c) => c.root === spaceSel.value)
      cats.forEach((c) => catSel.appendChild(opt(c.name)))
      if (!cats.some((c) => c.name === r.category)) r.category = (cats[0] || {}).name || ''
      catSel.value = r.category || ''
    }
    fillCats()
    spaceSel.addEventListener('change', () => {
      r.root = spaceSel.value
      // A category belongs to one space, so moving the space invalidates the choice —
      // re-fill and fall back to that space's first category rather than keep a pairing
      // the backend would refuse.
      r.category = ''
      fillCats()
      renderPicked()
    })
    catSel.addEventListener('change', () => { r.category = catSel.value; renderPicked() })
    if (roots.length > 1) wrap.appendChild(spaceSel)
    wrap.appendChild(catSel)
    return wrap
  }

  function opt(v) {
    const o = document.createElement('option')
    o.value = v
    o.textContent = v
    return o
  }

  function renderPicked() {
    const n = picked.size
    $('onb-picked').textContent = total
      ? `${n} of ${rows.length} shown selected — ${total} untracked session${total > 1 ? 's' : ''} in all.`
      : ''
    const stuck = O.unroutable(rows, [...picked])
    const box = $('onb-unroutable')
    box.textContent = stuck.length
      ? `Nowhere to file: ${stuck.join(', ')}. Go back and add a category under a space that exists.`
      : ''
    box.hidden = stuck.length === 0
    // Nothing ticked is a valid answer (finish with a clean slate); a ticked row with no
    // destination is not — the backend would refuse it halfway through the run.
    if (step === 2) $('onb-next').disabled = stuck.length > 0
  }

  async function loadPage() {
    const res = await window.api.discoverSessionsPage(PAGE, offset)
    if (!res || !res.ok) {
      $('onb-sessions').textContent = ''
      const err = document.createElement('div')
      err.className = 'onb-empty'
      err.textContent = `Could not scan recent sessions: ${res && res.error ? res.error : 'unknown error'}`
      $('onb-sessions').appendChild(err)
      return
    }
    const page = res.sessions || []
    total = res.total || 0
    offset += page.length
    // Built from the accumulated RAW pages, never from already-built rows: buildRows
    // fills a display title, and feeding that back in would make "(untitled session)"
    // the imported name instead of the cwd basename.
    raw = raw.concat(page)
    // Keep any destination the user already chose for a row that is already on screen.
    const chosen = new Map(rows.map((r) => [r.sessionId, { category: r.category, root: r.root }]))
    rows = O.buildRows(raw, Date.now()).map((r) => ({ ...r, ...(chosen.get(r.sessionId) || {}) }))
    rows = O.applyDefaultTargets(rows, cfg, (p) => spacePresent.get(p) !== false)
    if (offset <= PAGE) picked = new Set(O.preselect(rows))
    $('onb-more').hidden = rows.length >= total
    renderSessions()
  }

  // ── Step 2: spaces, categories, colours ─────────────────────────────────────────

  function renderTaxonomy() {
    const spaces = $('onb-spaces')
    spaces.textContent = ''
    ;(cfg.roots || []).forEach((r, i) => {
      const row = document.createElement('div')
      row.className = 'onb-edit-row'
      const name = document.createElement('input')
      name.type = 'text'
      name.value = r.name || ''
      name.placeholder = 'name — e.g. Work'
      name.maxLength = 30
      name.addEventListener('input', () => { cfg.roots[i].name = name.value; validate() })
      const path = document.createElement('input')
      path.type = 'text'
      path.className = 'onb-grow'
      path.value = r.path || ''
      path.placeholder = 'folder — e.g. ~/work'
      path.addEventListener('input', () => { cfg.roots[i].path = path.value; validate() })
      const browse = document.createElement('button')
      browse.type = 'button'
      browse.className = 'modal-btn'
      browse.textContent = 'Browse…'
      browse.addEventListener('click', async () => {
        const dir = window.api.pickDirectory ? await window.api.pickDirectory() : null
        if (!dir) return
        cfg.roots[i].path = dir
        path.value = dir
        validate()
      })
      row.appendChild(name)
      row.appendChild(path)
      row.appendChild(browse)
      row.appendChild(removeBtn(() => { cfg.roots.splice(i, 1); renderTaxonomy() }, (cfg.roots || []).length > 1))
      spaces.appendChild(row)
    })

    const cats = $('onb-cats')
    cats.textContent = ''
    ;(cfg.categories || []).forEach((c, i) => {
      const row = document.createElement('div')
      row.className = 'onb-edit-row'
      const name = document.createElement('input')
      name.type = 'text'
      name.className = 'onb-grow'
      name.value = c.name || ''
      name.placeholder = 'name — e.g. FEAT'
      name.maxLength = 20
      // The backend uppercases and allows only [A-Za-z0-9_-]; do it here so the field
      // shows what will actually be stored rather than failing on save.
      name.addEventListener('input', () => {
        name.value = name.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '')
        cfg.categories[i].name = name.value
        validate()
      })
      const colour = document.createElement('input')
      colour.type = 'color'
      colour.className = 'onb-colour'
      colour.value = /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : window.CSM_COLORS.newCategory
      colour.addEventListener('input', () => { cfg.categories[i].color = colour.value })
      const space = document.createElement('select')
      ;(cfg.roots || []).forEach((r) => {
        const opt = document.createElement('option')
        opt.value = r.name || ''
        opt.textContent = r.name || ''
        space.appendChild(opt)
      })
      space.value = c.root || ((cfg.roots || [])[0] || {}).name || ''
      cfg.categories[i].root = space.value
      space.addEventListener('change', () => { cfg.categories[i].root = space.value; validate() })
      row.appendChild(colour)
      row.appendChild(name)
      row.appendChild(space)
      row.appendChild(removeBtn(() => { cfg.categories.splice(i, 1); renderTaxonomy() }, (cfg.categories || []).length > 1))
      cats.appendChild(row)
    })
    validate()
  }

  function removeBtn(onClick, enabled) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'onb-remove'
    b.textContent = '✕'
    b.title = 'Remove'
    b.disabled = !enabled
    b.addEventListener('click', onClick)
    return b
  }

  // Asks the backend which space folders are really there, then runs the model's rules.
  // A space that points nowhere is the most likely thing wrong on a fresh install, and
  // finding out at import time — after the taxonomy is already written — is too late.
  async function validate() {
    const roots = cfg.roots || []
    const flags = await window.api.pathsExist(roots.map((r) => r.path || ''))
    spacePresent = new Map(roots.map((r, i) => [r.path || '', !!flags[i]]))
    const issues = O.setupIssues(cfg, (p) => !!spacePresent.get(p))
    const box = $('onb-issues')
    box.textContent = issues.join(' ')
    box.hidden = issues.length === 0
    if (step === 1) $('onb-next').disabled = issues.length > 0
  }

  // ── Step 3: the one write pass ──────────────────────────────────────────────────

  /// The last step's line: how many, and where they are going. Names the destinations
  /// rather than a count, since the whole point of the previous step is that they differ.
  function summariseTargets() {
    const jobs = O.importJobs(rows, [...picked])
    const n = jobs.length
    if (!n) {
      $('onb-target-hint').textContent = 'Nothing selected — finish, and start fresh sessions from the dashboard.'
      $('onb-next').textContent = 'Finish'
      return
    }
    const counts = new Map()
    for (const j of jobs) {
      const key = j.root ? `${j.root} / ${j.category}` : j.category
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    const where = [...counts].map(([k, c]) => `${c} → ${k}`).join(', ')
    $('onb-target-hint').textContent =
      `${n} session${n > 1 ? 's' : ''}: ${where}. Each one resumes briefly to write its own notes, so this takes a moment per session.`
    $('onb-next').textContent = 'Import'
  }

  function renderJobs() {
    const list = $('onb-jobs')
    list.textContent = ''
    if (!run) return
    const MARK = { pending: '·', running: '…', done: '✓', failed: '✕' }
    for (const j of run.jobs) {
      const row = document.createElement('div')
      row.className = `onb-job onb-job-${j.status}`
      const mark = document.createElement('span')
      mark.className = 'onb-job-mark'
      mark.textContent = MARK[j.status] || '·'
      const name = document.createElement('span')
      name.className = 'onb-job-name'
      name.textContent = j.name || j.sessionId
      row.appendChild(mark)
      row.appendChild(name)
      if (j.error) {
        const err = document.createElement('span')
        err.className = 'onb-job-error'
        err.textContent = j.error
        row.appendChild(err)
      }
      list.appendChild(row)
    }
    const p = O.progress(run)
    $('onb-progress').textContent = p.total
      ? `${p.settled} of ${p.total} done${p.failed ? ` — ${p.failed} failed` : ''}.`
      : ''
  }

  async function startImport() {
    run = { jobs: O.importJobs(rows, [...picked]), current: -1, done: false }
    running = true
    $('onb-next').disabled = true
    $('onb-back').disabled = true
    $('onb-skip').hidden = true
    run = O.reduce(run, { type: 'start' })
    renderJobs()
    while (!run.done && run.current >= 0) {
      const job = run.jobs[run.current]
      const res = await window.api.importSessionHeadless(job.sessionId, job.category, job.name, job.root)
      run = O.reduce(run, res && res.ok ? { type: 'ok' } : { type: 'fail', error: (res && res.error) || 'import failed' })
      renderJobs()
    }
    running = false
    $('onb-back').disabled = false
    $('onb-next').disabled = false
    $('onb-next').textContent = 'Finish'
    const p = O.progress(run)
    // Say what actually happened. A partial run is the honest outcome to report — the
    // failed rows keep their reason on screen, and the successful ones are already in.
    $('onb-progress').textContent = p.failed
      ? `${p.imported} imported, ${p.failed} failed. The ones that failed were left untouched — you can re-run setup from Settings.`
      : `${p.imported} session${p.imported > 1 ? 's' : ''} imported. They're in the dashboard now.`
  }

  // ── Navigation ──────────────────────────────────────────────────────────────────

  function renderSteps() {
    const bar = $('onb-steps')
    bar.textContent = ''
    ;['Spaces & categories', 'Your sessions', 'Import'].forEach((label, i) => {
      const n = i + 1
      const el = document.createElement('span')
      el.className = `onb-pip ${n === step ? 'current' : n < step ? 'past' : ''}`
      el.textContent = `${n}. ${label}`
      bar.appendChild(el)
    })
    for (const n of [1, 2, 3]) $(`onb-step-${n}`).hidden = n !== step
    $('onb-back').hidden = step === 1
    $('onb-skip').hidden = step === 3
    $('onb-next').textContent = step === 3 ? 'Import' : 'Next'
    if (step === 1) validate()
    if (step === 2) renderPicked()
  }

  async function next() {
    if (step === 1) {
      // The taxonomy write — the only thing this step persists, and every import depends
      // on it: the backend refuses a category the config does not carry.
      const res = await window.api.setConfig({ ...(window.CSM_CONFIG || {}), roots: cfg.roots, categories: cfg.categories })
      if (!res || !res.ok) {
        const box = $('onb-issues')
        box.textContent = (res && res.error) || 'Could not save the spaces and categories.'
        box.hidden = false
        return
      }
      if (window.reloadConfig) await window.reloadConfig()
      step = 2
      // Re-file the rows against the taxonomy that now exists — a category the user just
      // renamed or removed must not stay as a row's destination.
      rows = O.applyDefaultTargets(
        rows.map((r) => {
          const ok = (cfg.categories || []).some((c) => c.name === r.category && c.root === r.root)
          return ok ? r : { ...r, category: '', root: '' }
        }),
        cfg, (p) => spacePresent.get(p) !== false,
      )
      renderSteps()
      renderSessions()
      return
    }
    if (step === 2) {
      step = 3
      renderSteps()
      summariseTargets()
      renderJobs()
      return
    }
    // Step 3: the first press imports, the second closes.
    if (!run) { await startImport(); return }
    await done()
  }

  async function done() {
    await window.api.finishOnboarding()
    modal.close()
    if (window.fetchAndRender) window.fetchAndRender(false)
  }

  $('onb-next').addEventListener('click', () => { if (!running) next() })
  $('onb-back').addEventListener('click', () => {
    if (running || step === 1) return
    step -= 1
    renderSteps()
  })
  // Skipping still counts as answered: Settings is the way back, so re-opening this
  // unasked at every launch would just be nagging someone who already said no.
  $('onb-skip').addEventListener('click', () => { if (!running) done() })
  // Escape must not leave the wizard half-applied without recording an answer, and it
  // must never abandon a run mid-import.
  modal.addEventListener('cancel', (e) => {
    e.preventDefault()
    if (!running) done()
  })

  window.openOnboarding = async function openOnboarding() {
    step = 1
    raw = []
    rows = []
    picked = new Set()
    offset = 0
    total = 0
    run = null
    running = false
    // A working copy: nothing the user types in step 2 touches the live config until the
    // step is left, so backing out of the wizard changes nothing.
    const live = window.CSM_CONFIG || {}
    cfg = {
      roots: JSON.parse(JSON.stringify(live.roots || [])),
      categories: JSON.parse(JSON.stringify(live.categories || [])),
    }
    if (!cfg.roots.length) cfg.roots = [{ name: 'Work', path: '' }]
    if (!cfg.categories.length) cfg.categories = [{ name: 'FEAT', color: window.CSM_COLORS.newCategory, root: cfg.roots[0].name }]
    $('onb-next').disabled = false
    $('onb-back').disabled = false
    renderSteps()
    renderTaxonomy()
    if (!modal.open) modal.showModal()
    // The scan runs while the user is still on the taxonomy step, so step 2 is already
    // filled when they get there.
    await loadPage()
  }

  $('onb-more').addEventListener('click', () => loadPage())

  // Offered once, at launch, and only to an install with nothing in it — see
  // config::onboarding_needed. Everyone else gets it from Settings or not at all.
  window.maybeOpenOnboarding = async function maybeOpenOnboarding() {
    if (!window.api || !window.api.needsOnboarding) return
    if (await window.api.needsOnboarding()) window.openOnboarding()
  }
})()
