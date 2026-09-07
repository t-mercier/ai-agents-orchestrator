const O = require('../renderer/lib/onboarding-model')

const NOW = Date.parse('2026-09-07T12:00:00Z')
const secsAgo = (d) => Math.floor((NOW - d * 86400000) / 1000)
const s = (id, over) => ({ sessionId: id, mtime: secsAgo(1), ...over })

describe('basename', () => {
  it('returns the last path segment', () => expect(O.basename('/Users/x/my-repo')).toBe('my-repo'))
  it('tolerates a trailing slash', () => expect(O.basename('/Users/x/my-repo/')).toBe('my-repo'))
  it('handles empty', () => expect(O.basename('')).toBe(''))
})

describe('suggestName', () => {
  it("uses the session's own first prompt", () => {
    expect(O.suggestName({ title: 'fix the tile cache race' })).toBe('fix the tile cache race')
  })

  // A session started in ~/TomTom must not be named "TomTom" — that names the folder,
  // not the work.
  it('falls back to the cwd basename only when there is no title', () => {
    expect(O.suggestName({ cwd: '/Users/t/TomTom' })).toBe('TomTom')
    expect(O.suggestName({ title: '   ', cwd: '/Users/t/TomTom/' })).toBe('TomTom')
  })

  it('clips a long prompt on a word boundary', () => {
    const long = 'a'.repeat(20) + ' ' + 'b'.repeat(20) + ' ' + 'c'.repeat(40)
    const out = O.suggestName({ title: long })
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out.endsWith('c')).toBe(false)
  })

  it('takes only the first line', () => {
    expect(O.suggestName({ title: 'first line\nsecond line' })).toBe('first line')
  })

  it('survives an empty session', () => expect(O.suggestName({})).toBe(''))
})

describe('buildRows', () => {
  it('sorts newest first and carries the name to import under', () => {
    const rows = O.buildRows([
      s('old', { mtime: secsAgo(10), title: 'older work' }),
      s('new', { mtime: secsAgo(1), title: 'newer work' }),
    ], NOW)
    expect(rows.map(r => r.sessionId)).toEqual(['new', 'old'])
    expect(rows[0].name).toBe('newer work')
  })

  it('handles a missing or empty list', () => {
    expect(O.buildRows(undefined, NOW)).toEqual([])
    expect(O.buildRows([], NOW)).toEqual([])
  })
})

describe('preselect', () => {
  // Each import is a headless agent run, so ticking a long history by default would
  // start a minutes-long operation nobody asked for.
  it('offers a handful, not everything', () => {
    const rows = O.buildRows(Array.from({ length: 14 }, (_, i) => s(`s${i}`, { mtime: secsAgo(i) })), NOW)
    expect(O.preselect(rows)).toHaveLength(O.PRESELECT)
    expect(O.preselect(rows)[0]).toBe('s0')
  })

  it('never returns more than there are', () => {
    expect(O.preselect(O.buildRows([s('only')], NOW))).toEqual(['only'])
  })
})

describe('unusableSpaces / setupIssues', () => {
  const exists = (p) => p === '/Users/t/TomTom'

  // The default config ships "Work" -> ~/work, which exists on almost no machine.
  it('names a space whose folder is not there', () => {
    const roots = [{ name: 'Work', path: '~/work' }, { name: 'Perso', path: '/Users/t/TomTom' }]
    expect(O.unusableSpaces(roots, exists)).toEqual(['Work'])
  })

  it('treats a blank path as unusable', () => {
    expect(O.unusableSpaces([{ name: 'X', path: '  ' }], exists)).toEqual(['X'])
  })

  it('blocks setup when no space resolves', () => {
    const issues = O.setupIssues({ roots: [{ name: 'Work', path: '~/work' }], categories: [{ name: 'FEAT', root: 'Work' }] }, exists)
    expect(issues.join(' ')).toMatch(/No space points at a folder that exists/)
  })

  it('blocks setup when every category belongs to a space that is gone', () => {
    const cfg = {
      roots: [{ name: 'Work', path: '~/work' }, { name: 'Perso', path: '/Users/t/TomTom' }],
      categories: [{ name: 'FEAT', root: 'Work' }],
    }
    expect(O.setupIssues(cfg, exists).join(' ')).toMatch(/No category belongs to a space that exists/)
  })

  it('passes a taxonomy that can actually receive an import', () => {
    const cfg = {
      roots: [{ name: 'Perso', path: '/Users/t/TomTom' }],
      categories: [{ name: 'PERSO', root: 'Perso' }],
    }
    expect(O.setupIssues(cfg, exists)).toEqual([])
  })

  it('asks for a space and a category when there are none', () => {
    expect(O.setupIssues({ roots: [], categories: [] }, exists)).toHaveLength(2)
  })
})

describe('per-row destinations', () => {
  const CFG = {
    roots: [{ name: 'Work', path: '/w' }, { name: 'Perso', path: '/p' }],
    categories: [{ name: 'FEAT', root: 'Work' }, { name: 'PERSO', root: 'Perso' }],
  }
  const all = () => true

  it('defaults to the first category under a space that exists', () => {
    expect(O.defaultTarget(CFG, all)).toEqual({ category: 'FEAT', root: 'Work' })
    // Work missing → the default moves to the category that is still reachable, rather
    // than routing every session into a folder that is not there.
    expect(O.defaultTarget(CFG, (p) => p === '/p')).toEqual({ category: 'PERSO', root: 'Perso' })
    // Nothing usable → no destination, and `unroutable` below is what blocks the import.
    expect(O.defaultTarget(CFG, () => false)).toEqual({ category: '', root: '' })
  })

  it('fills empty destinations and never overwrites a chosen one', () => {
    const rows = O.buildRows([s('a', { title: 'A' }), s('b', { title: 'B' })], NOW)
    rows[1].category = 'PERSO'; rows[1].root = 'Perso'
    const out = O.applyDefaultTargets(rows, CFG, all)
    expect(out[0]).toMatchObject({ category: 'FEAT', root: 'Work' })
    expect(out[1]).toMatchObject({ category: 'PERSO', root: 'Perso' })  // the user's choice survives
  })

  it('sends each ticked row to its own destination, in list order', () => {
    const rows = O.applyDefaultTargets(
      O.buildRows([s('a', { mtime: secsAgo(1), title: 'A' }), s('b', { mtime: secsAgo(2), title: 'B' })], NOW),
      CFG, all,
    )
    rows[1].category = 'PERSO'; rows[1].root = 'Perso'
    expect(O.importJobs(rows, ['a', 'b'])).toEqual([
      { sessionId: 'a', name: 'A', category: 'FEAT', root: 'Work', status: 'pending', error: '' },
      { sessionId: 'b', name: 'B', category: 'PERSO', root: 'Perso', status: 'pending', error: '' },
    ])
    expect(O.importJobs(rows, ['b'])).toHaveLength(1)   // untick and it is gone
  })

  // import_session_headless refuses an unknown category, so a row with no destination must
  // stop the button rather than fail halfway through the run.
  it('names ticked rows that have nowhere to go, and ignores unticked ones', () => {
    const rows = O.buildRows([s('a', { title: 'A' }), s('b', { title: 'B' })], NOW)
    expect(O.unroutable(rows, ['a'])).toEqual(['A'])
    expect(O.unroutable(O.applyDefaultTargets(rows, CFG, all), ['a', 'b'])).toEqual([])
    expect(O.unroutable(rows, [])).toEqual([])
  })
})

describe('the sequential runner', () => {
  const mk = (n) => ({ jobs: Array.from({ length: n }, (_, i) => ({ sessionId: `s${i}`, status: 'pending', error: '' })), current: -1, done: false })

  it('runs exactly one job at a time', () => {
    let st = O.reduce(mk(3), { type: 'start' })
    expect(st.jobs.filter(j => j.status === 'running')).toHaveLength(1)
    expect(st.current).toBe(0)
  })

  it('advances to the next job on success', () => {
    let st = O.reduce(mk(2), { type: 'start' })
    st = O.reduce(st, { type: 'ok' })
    expect(st.jobs[0].status).toBe('done')
    expect(st.current).toBe(1)
    expect(st.done).toBe(false)
  })

  // One session refusing to import must not strand the rest.
  it('carries on past a failure, and keeps its reason', () => {
    let st = O.reduce(mk(2), { type: 'start' })
    st = O.reduce(st, { type: 'fail', error: 'the import timed out' })
    expect(st.jobs[0]).toMatchObject({ status: 'failed', error: 'the import timed out' })
    expect(st.current).toBe(1)
    st = O.reduce(st, { type: 'start' })
    st = O.reduce(st, { type: 'ok' })
    expect(st.done).toBe(true)
    expect(O.progress(st)).toEqual({ total: 2, settled: 2, imported: 1, failed: 1 })
  })

  // The regression that the per-transition tests could not see: the controller settles a
  // job and immediately dispatches the next import, with no 'start' in between. Before the
  // fix, `current` pointed at a job still marked 'pending', the next settle found nothing
  // 'running' and returned the state untouched — so the runner re-imported job 2 for ever.
  // Drive it exactly the way the controller does.
  it('runs a whole queue to completion the way the controller drives it', () => {
    let st = O.reduce(mk(3), { type: 'start' })
    const dispatched = []
    let guard = 0
    while (!st.done && st.current >= 0) {
      if (++guard > 10) throw new Error('the runner never finished — it is looping')
      dispatched.push(st.jobs[st.current].sessionId)
      st = O.reduce(st, { type: 'ok' })
    }
    expect(dispatched).toEqual(['s0', 's1', 's2'])   // each one exactly once, in order
    expect(st.done).toBe(true)
    expect(O.progress(st)).toEqual({ total: 3, settled: 3, imported: 3, failed: 0 })
  })

  it('a second start on a run already under way changes nothing', () => {
    const st = O.reduce(mk(2), { type: 'start' })
    expect(O.reduce(st, { type: 'start' })).toEqual(st)
  })

  it('reports done when nothing is left', () => {
    expect(O.reduce({ jobs: [], current: -1, done: false }, { type: 'start' }).done).toBe(true)
  })

  it('counts progress while a job is still in flight', () => {
    const st = O.reduce(mk(3), { type: 'start' })
    expect(O.progress(st)).toEqual({ total: 3, settled: 0, imported: 0, failed: 0 })
  })
})
