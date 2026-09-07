// First-run setup: the decisions, none of the DOM. UMD, pure, injected clock and
// filesystem predicate so every rule below is testable.
//
// The order the wizard imposes is not cosmetic. `import_session` refuses a category the
// config does not carry, and a fresh install ships a space pointing at `~/work` — a path
// that exists on almost no machine. Importing before the taxonomy is real would either
// fail or write someone's notes into a folder they never chose, so step 1 only *shows*
// what was found, step 2 makes the taxonomy, and step 3 is the single pass that writes.
(function (root, factory) {
  const F = (typeof module !== 'undefined' && module.exports)
    ? require('./formatters')
    : root.CSMFormatters
  const api = factory(F)
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMOnboarding = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F) {

  /// How many sessions arrive ticked. Each import is a headless agent run of its own, so
  /// a full tick of a long history is a minutes-long operation — the wizard offers a
  /// handful and lets the user add more deliberately.
  const PRESELECT = 3

  function basename(p) {
    if (!p) return ''
    const parts = String(p).replace(/\/+$/, '').split('/')
    return parts[parts.length - 1] || ''
  }

  /// A short, human name for a session: its own first prompt, which says what the work
  /// actually is. The cwd basename is only a fallback — a session started in ~/TomTom
  /// would otherwise be named "TomTom", which names the folder rather than the task.
  function suggestName(session) {
    const title = String((session && session.title) || '').trim()
    if (title) {
      const firstLine = title.split('\n')[0].trim()
      const clipped = firstLine.length > 60 ? firstLine.slice(0, 60).replace(/\s+\S*$/, '') : firstLine
      if (clipped) return clipped
    }
    return basename((session && session.cwd) || '')
  }

  /// The rows step 1 shows: newest first, each already carrying the name it would import
  /// under, so finishing the step costs no typing.
  function buildRows(sessions, now) {
    const list = Array.isArray(sessions) ? sessions : []
    return list
      .slice()
      .sort((a, b) => (b.mtime || 0) - (a.mtime || 0))
      .map((s) => ({
        sessionId: s.sessionId,
        title: s.title || '(untitled session)',
        cwd: s.cwd || '',
        mtime: s.mtime || 0,
        when: s.mtime ? F.formatTimestamp(new Date(s.mtime * 1000).toISOString(), now) : '',
        name: suggestName(s),
        // Each row carries where it lands. One target for the whole batch was the wrong
        // grain: sessions come from different repos, and filing them all under one category
        // is work the user then has to undo one card at a time.
        category: '',
        root: '',
      }))
  }

  function preselect(rows, n) {
    const take = typeof n === 'number' ? n : PRESELECT
    return (rows || []).slice(0, Math.max(0, take)).map((r) => r.sessionId)
  }

  /// The first category that belongs to a space which exists — the destination a row gets
  /// before the user touches anything. Without a default, every row would demand two
  /// choices before the step could be left, which is the taxonomy form all over again.
  function defaultTarget(cfg, exists) {
    const roots = (cfg && cfg.roots) || []
    const bad = new Set(unusableSpaces(roots, exists))
    const usable = roots.filter((r) => !bad.has(r.name)).map((r) => r.name)
    const cat = ((cfg && cfg.categories) || []).find((c) => usable.includes(c.root))
    return cat ? { category: cat.name, root: cat.root } : { category: '', root: '' }
  }

  /// Give every row a destination, keeping any the user already chose.
  function applyDefaultTargets(rows, cfg, exists) {
    const d = defaultTarget(cfg, exists)
    return (rows || []).map((r) => ({
      ...r,
      category: r.category || d.category,
      root: r.root || d.root,
    }))
  }

  /// Spaces whose path does not resolve. `exists` is injected because the renderer has to
  /// ask the backend, and a rule that can only be checked against a real disk is a rule
  /// that never gets tested.
  function unusableSpaces(roots, exists) {
    return (roots || [])
      .filter((r) => {
        const path = String((r && r.path) || '').trim()
        return !path || !exists(path)
      })
      .map((r) => (r && r.name) || '')
  }

  /// What step 2 must produce before step 3 may write anything.
  function setupIssues(cfg, exists) {
    const roots = (cfg && cfg.roots) || []
    const categories = (cfg && cfg.categories) || []
    const issues = []
    if (!roots.length) issues.push('Add at least one space — a folder your sessions live under.')
    const bad = unusableSpaces(roots, exists)
    if (roots.length && bad.length === roots.length) {
      issues.push(`No space points at a folder that exists (${bad.join(', ')}).`)
    } else if (bad.length) {
      issues.push(`These spaces point at a folder that does not exist: ${bad.join(', ')}.`)
    }
    const usable = new Set(
      roots.filter((r) => !bad.includes(r.name)).map((r) => r.name)
    )
    if (!categories.length) {
      issues.push('Add at least one category.')
    } else if (!categories.some((c) => usable.has(c.root))) {
      issues.push('No category belongs to a space that exists.')
    }
    return issues
  }

  /// The ordered jobs the last step runs, one at a time — each to its OWN destination.
  function importJobs(rows, selectedIds) {
    const picked = new Set(selectedIds || [])
    return (rows || [])
      .filter((r) => picked.has(r.sessionId))
      .map((r) => ({
        sessionId: r.sessionId,
        name: r.name,
        category: r.category || '',
        root: r.root || '',
        status: 'pending',
        error: '',
      }))
  }

  /// Rows that are ticked but have nowhere to go. `import_session_headless` refuses an
  /// unknown category, so catching it here turns a mid-run failure into a disabled button.
  function unroutable(rows, selectedIds) {
    const picked = new Set(selectedIds || [])
    return (rows || [])
      .filter((r) => picked.has(r.sessionId) && !r.category)
      .map((r) => r.name || r.sessionId)
  }

  /// The sequential runner. One job in flight at a time — N concurrent `claude --resume`
  /// runs would compete for the same machine and give no usable progress.
  function reduce(state, event) {
    const jobs = state.jobs.map((j) => ({ ...j }))
    if (event.type === 'start') {
      // Idempotent: a settle already starts the next job, so a second 'start' on a run
      // that is under way must not touch it — and must not report done just because
      // nothing is left PENDING while one is still in flight.
      const running = jobs.findIndex((j) => j.status === 'running')
      if (running !== -1) return { ...state, jobs, current: running, done: false }
      const i = jobs.findIndex((j) => j.status === 'pending')
      if (i === -1) return { ...state, jobs, current: -1, done: true }
      jobs[i].status = 'running'
      return { ...state, jobs, current: i, done: false }
    }
    if (event.type === 'ok' || event.type === 'fail') {
      const i = jobs.findIndex((j) => j.status === 'running')
      if (i === -1) return { ...state, jobs }
      jobs[i].status = event.type === 'ok' ? 'done' : 'failed'
      if (event.type === 'fail') jobs[i].error = event.error || 'import failed'
      // Settling one job STARTS the next: `current` must always point at a job whose
      // status is 'running', because that is what the next settle looks for. Leaving it
      // on a 'pending' job made the runner re-dispatch the same import for ever — the
      // reducer found nothing running, returned the state untouched, and the caller's
      // loop saw no progress to stop on.
      const next = jobs.findIndex((j) => j.status === 'pending')
      if (next !== -1) jobs[next].status = 'running'
      return { ...state, jobs, current: next, done: next === -1 }
    }
    return { ...state, jobs }
  }

  function progress(state) {
    const jobs = (state && state.jobs) || []
    const settled = jobs.filter((j) => j.status === 'done' || j.status === 'failed').length
    return {
      total: jobs.length,
      settled,
      imported: jobs.filter((j) => j.status === 'done').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
    }
  }

  return {
    PRESELECT, basename, suggestName, buildRows, preselect,
    unusableSpaces, setupIssues, defaultTarget, applyDefaultTargets,
    importJobs, unroutable, reduce, progress,
  }
})
