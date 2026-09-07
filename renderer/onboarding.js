// First-run setup: the wizard's DOM and its three steps. Every decision lives in
// renderer/lib/onboarding-model.js, which is pure and tested; this file only renders it
// and calls the backend.
//
// The step order is load-bearing, not cosmetic. `import_session_headless` refuses a
// category the config does not carry, and the shipped seed points its "Work" space at
// `~/work` — a path that exists on almost no machine. So step 1 only *shows* what was
// found, step 2 makes the taxonomy real, and step 3 is the one pass that writes.
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
  let cfg = null              // working copy of the config; written when step 2 is left
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
      list.appendChild(row)
    }
    renderPicked()
  }

  function renderPicked() {
    const n = picked.size
    $('onb-picked').textContent = total
      ? `${n} of ${rows.length} shown selected — ${total} untracked session${total > 1 ? 's' : ''} in all.`
      : ''
    $('onb-next').disabled = step === 1 && n === 0 && rows.length > 0
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
    rows = O.buildRows(raw, Date.now())
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
    const present = new Map(roots.map((r, i) => [r.path || '', !!flags[i]]))
    const issues = O.setupIssues(cfg, (p) => !!present.get(p))
    const box = $('onb-issues')
    box.textContent = issues.join(' ')
    box.hidden = issues.length === 0
    if (step === 2) $('onb-next').disabled = issues.length > 0
  }

  // ── Step 3: the one write pass ──────────────────────────────────────────────────

  function populateTarget() {
    const roots = (cfg.roots || []).map((r) => r.name).filter(Boolean)
    const multi = roots.length > 1
    $('onb-space-field').hidden = !multi
    const spaceSel = $('onb-space')
    spaceSel.textContent = ''
    roots.forEach((n) => {
      const o = document.createElement('option')
      o.value = n
      o.textContent = n
      spaceSel.appendChild(o)
    })
    if (multi) spaceSel.value = roots[0]
    populateCategories()
  }

  function populateCategories() {
    const roots = (cfg.roots || []).map((r) => r.name).filter(Boolean)
    const space = roots.length > 1 ? $('onb-space').value : roots[0] || ''
    const sel = $('onb-category')
    sel.textContent = ''
    ;(cfg.categories || [])
      .filter((c) => !space || c.root === space)
      .forEach((c) => {
        const o = document.createElement('option')
        o.value = c.name
        o.textContent = c.name
        sel.appendChild(o)
      })
    const n = picked.size
    $('onb-target-hint').textContent = n
      ? `${n} session${n > 1 ? 's' : ''} will be imported here. Each one resumes briefly to write its own notes, so this takes a moment per session.`
      : 'Nothing selected — you can go back, or finish and start fresh sessions from the dashboard.'
    $('onb-next').textContent = n ? 'Import' : 'Finish'
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
    const roots = (cfg.roots || []).map((r) => r.name).filter(Boolean)
    const target = {
      category: $('onb-category').value,
      root: roots.length > 1 ? $('onb-space').value : roots[0] || '',
    }
    run = { jobs: O.importJobs(rows, [...picked], target), current: -1, done: false }
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
    ;['Your sessions', 'Spaces & categories', 'Import'].forEach((label, i) => {
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
    if (step === 1) renderPicked()
    if (step === 2) validate()
  }

  async function next() {
    if (step === 1) { step = 2; renderTaxonomy(); renderSteps(); return }
    if (step === 2) {
      // The taxonomy write — the only thing step 2 persists, and the import depends on it.
      const res = await window.api.setConfig({ ...(window.CSM_CONFIG || {}), roots: cfg.roots, categories: cfg.categories })
      if (!res || !res.ok) {
        const box = $('onb-issues')
        box.textContent = (res && res.error) || 'Could not save the spaces and categories.'
        box.hidden = false
        return
      }
      if (window.reloadConfig) await window.reloadConfig()
      step = 3
      renderSteps()
      populateTarget()
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
    if (!modal.open) modal.showModal()
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
