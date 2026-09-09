// Sync all: the decisions, none of the DOM or the network. UMD, pure.
//
// Per-session Sync is two calls — an agent pass over one notes.md (`/sync-refs`, slow,
// minutes at worst), then `gh pr view` for each of its PRs. With ten open sessions that is
// ten clicks and ten waits. "Sync all" is the same two calls, arranged so the wait is paid
// once: every known PR state first, in ONE gh batch (seconds — the list is visibly fresher
// before any agent has started), then the agents one session at a time, then one more gh
// batch for the PRs the agents discovered. Sequential on purpose: one headless `claude -p`
// at a time is predictable on the rate limit and on the machine; N in parallel is neither.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMSyncAll = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function linksOf(s, listKey, primaryKey) {
    const list = Array.isArray(s[listKey]) ? s[listKey].filter(Boolean) : []
    if (list.length) return list
    return s[primaryKey] ? [s[primaryKey]] : []
  }
  const prsOf = (s) => linksOf(s, 'prLinks', 'prLink')
  const ticketsOf = (s) => linksOf(s, 'tickets', 'ticket').filter((t) => /[a-z0-9]/i.test(t))

  /// Which sessions Sync all visits: the same rule as the per-card button (a ticket OR a
  /// PR — with a ticket alone there is still a status to refresh), minus anything without a
  /// notes.md (nothing to realign) and minus duplicates by notes path (an active and a
  /// stale entry can be the same session seen twice).
  function plan(sessions) {
    const seen = new Set()
    const out = []
    for (const s of sessions || []) {
      if (!s || !s.notesPath || seen.has(s.notesPath)) continue
      if (!prsOf(s).length && !ticketsOf(s).length) continue
      seen.add(s.notesPath)
      out.push({ notesPath: s.notesPath, cwd: s.cwd || '', name: s.name || '', prs: prsOf(s) })
    }
    return out
  }

  /// Every PR URL across the plan, once each, in plan order — the first gh batch.
  function knownPrs(targets) {
    const seen = new Set()
    const out = []
    for (const t of targets) for (const u of t.prs) if (!seen.has(u)) { seen.add(u); out.push(u) }
    return out
  }

  /// URLs the agents surfaced that the first batch did not already cover.
  function newPrs(before, discovered) {
    const had = new Set(before)
    const seen = new Set()
    const out = []
    for (const u of discovered || []) if (u && !had.has(u) && !seen.has(u)) { seen.add(u); out.push(u) }
    return out
  }

  function start(targets) {
    return { phase: 'states', total: targets.length, done: 0, current: null, failed: [], discovered: [] }
  }

  /// One step. Events: states-done · agent-start {name} · agent-done {name, prs} ·
  /// agent-failed {name, error} · restates-done · fatal {error}. A fatal event is the one
  /// error that is NOT per session — gh missing or logged out, from the first batch — and it
  /// ends the run before any agent starts: it is one thing to fix, not N failures to read.
  function reduce(state, ev) {
    switch (ev.type) {
      case 'states-done': return { ...state, phase: 'refs' }
      case 'agent-start': return { ...state, current: ev.name || '' }
      case 'agent-done': return {
        ...state, current: null, done: state.done + 1,
        discovered: state.discovered.concat((ev.prs || []).filter(Boolean)),
      }
      case 'agent-failed': return {
        ...state, current: null, done: state.done + 1,
        failed: state.failed.concat([{ name: ev.name || '', error: ev.error || 'unknown error' }]),
      }
      case 'restates-done': return { ...state, phase: 'done' }
      case 'fatal': return { ...state, phase: 'fatal', current: null, error: ev.error || 'unknown error' }
      default: return state
    }
  }

  /// The one line the banner shows for a state. Progress names the session under way, so
  /// a two-minute agent pass on one session reads as work, not as a hang.
  function line(state) {
    if (state.phase === 'states') return `Syncing ${state.total} session${state.total === 1 ? '' : 's'} — refreshing pull-request states…`
    if (state.phase === 'refs') {
      // Every agent has returned; the second gh batch is what is running now.
      if (!state.current && state.done >= state.total) return 'Refreshing the states of the pull requests the agents found…'
      const who = state.current ? ` — ${state.current}` : ''
      return `Syncing ${Math.min(state.done + 1, state.total)} / ${state.total}${who}…`
    }
    if (state.phase === 'fatal') return `Could not sync: ${state.error}`
    const ok = state.done - state.failed.length
    let out = `Synced ${ok} of ${state.total} session${state.total === 1 ? '' : 's'}.`
    if (state.failed.length) {
      out += ` ${state.failed.length} failed: ` + state.failed.map((f) => `${f.name || 'unnamed'} (${f.error})`).join('; ') + '.'
    }
    return out
  }

  return { plan, knownPrs, newPrs, start, reduce, line }
})
