const M = require('../renderer/lib/sync-all-model')

const s = (notesPath, over) => ({ notesPath, cwd: '/tmp/r', name: notesPath.split('/').pop(), ...over })

describe('plan', () => {
  it('visits sessions with a PR or a ticket, and skips the rest', () => {
    const out = M.plan([
      s('/a/notes.md', { prLink: 'https://github.com/o/r/pull/1' }),
      s('/b/notes.md', { ticket: 'GOSDK-1' }),
      s('/c/notes.md', {}),
    ])
    expect(out.map((t) => t.notesPath)).toEqual(['/a/notes.md', '/b/notes.md'])
  })

  // A frontmatter `ticket: ""` that survived as quotes is not a ticket — same guard as the
  // card button, or Sync all would run an agent on a session the card shows no Sync for.
  it('does not count a junk ticket', () => {
    expect(M.plan([s('/a/notes.md', { ticket: '""' })])).toEqual([])
  })

  it('needs a notes path — nothing to realign without one', () => {
    expect(M.plan([{ prLink: 'https://github.com/o/r/pull/1', cwd: '/tmp' }])).toEqual([])
  })

  // Running = active ∪ stale; the same session can appear in both lists.
  it('dedupes by notes path', () => {
    const out = M.plan([
      s('/a/notes.md', { ticket: 'T-1' }),
      s('/a/notes.md', { ticket: 'T-1', cwd: '/other' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].cwd).toBe('/tmp/r')
  })

  it('prefers the full list over the primary, like the card', () => {
    const out = M.plan([s('/a/notes.md', { prLink: 'x', prLinks: ['u1', 'u2'] })])
    expect(out[0].prs).toEqual(['u1', 'u2'])
  })
})

describe('knownPrs / newPrs', () => {
  it('collects every PR once, in plan order', () => {
    const targets = [{ prs: ['u1', 'u2'] }, { prs: ['u2', 'u3'] }]
    expect(M.knownPrs(targets)).toEqual(['u1', 'u2', 'u3'])
  })
  it('newPrs keeps only what the first batch did not cover', () => {
    expect(M.newPrs(['u1', 'u2'], ['u2', 'u4', 'u4', ''])).toEqual(['u4'])
  })
})

describe('reduce + line', () => {
  const targets = [{ name: 'alpha', prs: [] }, { name: 'beta', prs: [] }, { name: 'gamma', prs: [] }]

  it('walks states → refs → done, counting successes and failures', () => {
    let st = M.start(targets)
    expect(M.line(st)).toBe('Syncing 3 sessions — refreshing pull-request states…')
    st = M.reduce(st, { type: 'states-done' })
    st = M.reduce(st, { type: 'agent-start', name: 'alpha' })
    expect(M.line(st)).toBe('Syncing 1 / 3 — alpha…')
    st = M.reduce(st, { type: 'agent-done', name: 'alpha', prs: ['u9'] })
    st = M.reduce(st, { type: 'agent-start', name: 'beta' })
    expect(M.line(st)).toBe('Syncing 2 / 3 — beta…')
    st = M.reduce(st, { type: 'agent-failed', name: 'beta', error: 'timed out' })
    st = M.reduce(st, { type: 'agent-start', name: 'gamma' })
    st = M.reduce(st, { type: 'agent-done', name: 'gamma' })
    st = M.reduce(st, { type: 'restates-done' })
    expect(st.phase).toBe('done')
    expect(st.discovered).toEqual(['u9'])
    expect(M.line(st)).toBe('Synced 2 of 3 sessions. 1 failed: beta (timed out).')
  })

  // The counter must never read "4 / 3" while the last agent runs.
  it('caps the running index at the total', () => {
    let st = M.reduce(M.start([targets[0]]), { type: 'states-done' })
    st = M.reduce(st, { type: 'agent-start', name: 'alpha' })
    expect(M.line(st)).toBe('Syncing 1 / 1 — alpha…')
  })

  it('names the second gh batch once every agent is back', () => {
    let st = M.reduce(M.start([targets[0]]), { type: 'states-done' })
    st = M.reduce(st, { type: 'agent-start', name: 'alpha' })
    st = M.reduce(st, { type: 'agent-done', name: 'alpha', prs: ['u1'] })
    expect(M.line(st)).toBe('Refreshing the states of the pull requests the agents found…')
  })

  it('a fatal first batch ends the run with the one thing to fix', () => {
    const st = M.reduce(M.start(targets), { type: 'fatal', error: 'gh is not logged in. Run `gh auth login`, then sync again.' })
    expect(st.phase).toBe('fatal')
    expect(M.line(st)).toBe('Could not sync: gh is not logged in. Run `gh auth login`, then sync again.')
  })

  it('a clean run says so without a failure clause', () => {
    let st = M.reduce(M.start([targets[0]]), { type: 'states-done' })
    st = M.reduce(st, { type: 'agent-done', name: 'alpha' })
    st = M.reduce(st, { type: 'restates-done' })
    expect(M.line(st)).toBe('Synced 1 of 1 session.')
  })

  it('ignores an unknown event', () => {
    const st = M.start(targets)
    expect(M.reduce(st, { type: 'nope' })).toBe(st)
  })
})
