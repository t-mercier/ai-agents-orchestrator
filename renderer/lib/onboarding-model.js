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
      }))
  }

  function preselect(rows, n) {
    const take = typeof n === 'number' ? n : PRESELECT
    return (rows || []).slice(0, Math.max(0, take)).map((r) => r.sessionId)
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

  /// The ordered jobs step 3 runs, one at a time.
  function importJobs(rows, selectedIds, target) {
    const picked = new Set(selectedIds || [])
    return (rows || [])
      .filter((r) => picked.has(r.sessionId))
      .map((r) => ({
        sessionId: r.sessionId,
        name: r.name,
        category: (target && target.category) || '',
        root: (target && target.root) || '',
        status: 'pending',
        error: '',
      }))
  }

  /// The sequential runner. One job in flight at a time — N concurrent `claude --resume`
  /// runs would compete for the same machine and give no usable progress.
  function reduce(state, event) {
    const jobs = state.jobs.map((j) => ({ ...j }))
    if (event.type === 'start') {
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
      const next = jobs.findIndex((j) => j.status === 'pending')
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
    unusableSpaces, setupIssues, importJobs, reduce, progress,
  }
})
