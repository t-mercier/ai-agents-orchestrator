const O = require('../renderer/lib/onboarding-model')

const NOW = Date.parse('2026-09-07T12:00:00Z')
const secsAgo = (d) => Math.floor((NOW - d * 86400000) / 1000)
const s = (id, over) => ({ sessionId: id, mtime: secsAgo(1), ...over })

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

describe('importJobs', () => {
  it('keeps only what was ticked, in list order, with the chosen target', () => {
    const rows = O.buildRows([s('a', { mtime: secsAgo(1), title: 'A' }), s('b', { mtime: secsAgo(2), title: 'B' })], NOW)
    const jobs = O.importJobs(rows, ['b'], { category: 'PERSO', root: 'Perso' })
    expect(jobs).toEqual([{ sessionId: 'b', name: 'B', category: 'PERSO', root: 'Perso', status: 'pending', error: '' }])
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

  it('reports done when nothing is left', () => {
    expect(O.reduce({ jobs: [], current: -1, done: false }, { type: 'start' }).done).toBe(true)
  })

  it('counts progress while a job is still in flight', () => {
    const st = O.reduce(mk(3), { type: 'start' })
    expect(O.progress(st)).toEqual({ total: 3, settled: 0, imported: 0, failed: 0 })
  })
})
