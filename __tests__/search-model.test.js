const M = require('../renderer/lib/search-model')

const session = (over = {}) => Object.assign({
  name: 've-ai-system',
  category: 'REVIEW',
  goal: 'review the arrows fix',
  cwd: '/Users/t/TomTom/REVIEW/ve-ai-system',
  gitBranch: 'feat/arrows',
}, over)

describe('matchesSearch — pull requests', () => {
  const s = session({ prLinks: ['https://github.com/tomtom-internal/ve-ai-system/pull/63'] })

  it('finds a session by the bare pull-request number', () => {
    // The reported bug: typing 63 matched nothing while PR 63 was on screen.
    expect(M.matchesSearch(s, '63')).toBe(true)
  })

  it('finds it by #number too', () => {
    expect(M.matchesSearch(s, '#63')).toBe(true)
  })

  it('finds it by any part of the URL', () => {
    expect(M.matchesSearch(s, 'tomtom-internal')).toBe(true)
    expect(M.matchesSearch(s, 'pull/63')).toBe(true)
  })

  it('does not match a number that is nowhere in the session', () => {
    expect(M.matchesSearch(s, '99')).toBe(false)
  })

  it('reads the legacy single prLink as well as the list', () => {
    const old = session({ prLink: 'https://github.com/o/r/pull/7' })
    expect(M.matchesSearch(old, '7')).toBe(true)
  })
})

describe('matchesSearch — tickets', () => {
  it('matches a ticket beyond the first, which the old matcher could not see', () => {
    const s = session({ tickets: ['GOSDK-1', 'GOSDK-224455'] })
    expect(M.matchesSearch(s, 'GOSDK-224455')).toBe(true)
  })

  it('ignores a blank ticket left by empty frontmatter quotes', () => {
    expect(M.ticketsOf(session({ tickets: ['""', 'GOSDK-9'] }))).toEqual(['GOSDK-9'])
  })
})

describe('matchesSearch — the fields that already worked', () => {
  const s = session()
  it.each([
    ['name', 've-ai'], ['category', 'review'], ['goal', 'arrows'],
    ['cwd', 'TomTom/REVIEW'], ['branch', 'feat/arrows'],
  ])('still matches on %s', (_field, q) => {
    expect(M.matchesSearch(s, q)).toBe(true)
  })

  it('is case-insensitive and ignores surrounding blanks', () => {
    expect(M.matchesSearch(s, '  VE-AI-SYSTEM ')).toBe(true)
  })

  it('an empty query matches everything', () => {
    expect(M.matchesSearch(s, '')).toBe(true)
    expect(M.matchesSearch(s, '   ')).toBe(true)
  })

  it('survives a session with nothing in it', () => {
    expect(M.matchesSearch({}, 'x')).toBe(false)
    expect(M.matchesSearch({}, '')).toBe(true)
  })
})
