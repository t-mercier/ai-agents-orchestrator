const S = require('../renderer/lib/sort-model')

const s = (key, ticket, t) => ({ key, ticket, t })
const timeOf = (x) => x.t
const keyOf = (x) => x.key

describe('sortSessions', () => {
  const list = [s('a', 'GOSDK-225187', 10), s('b', '', 30), s('c', 'GOSDK-9', 20), s('d', 'NAV-12', 5)]
  it('leaves the order alone in manual mode', () => {
    expect(S.sortSessions(list, 'manual', timeOf).map(keyOf)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('puts the most recently updated first', () => {
    expect(S.sortSessions(list, 'updated', timeOf).map(keyOf)).toEqual(['b', 'c', 'a', 'd'])
  })
  it('sorts by ticket number, numerically, with no ticket last either way', () => {
    expect(S.sortSessions(list, 'ticket-asc', timeOf).map(keyOf)).toEqual(['c', 'd', 'a', 'b'])
    expect(S.sortSessions(list, 'ticket-desc', timeOf).map(keyOf)).toEqual(['a', 'd', 'c', 'b'])
  })
  it('an unknown mode is manual', () => {
    expect(S.sortSessions(list, 'nope', timeOf).map(keyOf)).toEqual(['a', 'b', 'c', 'd'])
    expect(S.normalizeMode('nope')).toBe('manual')
  })
})

describe('sortItems', () => {
  const byKey = new Map([['a', s('a', 'X-3', 1)], ['b', s('b', 'X-1', 9)], ['c', s('c', 'X-2', 5)], ['d', s('d', '', 7)]])
  const items = [
    { kind: 'session', key: 'a' },
    { kind: 'group', id: 'g', members: ['d', 'c'] },
    { kind: 'session', key: 'b' },
  ]
  it('sorts loose cards and the members of each group; a group ranks by its best member', () => {
    const out = S.sortItems(items, byKey, 'ticket-asc', timeOf)
    expect(out.map(i => i.kind === 'group' ? `g[${i.members}]` : i.key)).toEqual(['b', 'g[c,d]', 'a'])
    const byTime = S.sortItems(items, byKey, 'updated', timeOf)
    expect(byTime.map(i => i.kind === 'group' ? `g[${i.members}]` : i.key)).toEqual(['b', 'g[d,c]', 'a'])
  })
})
