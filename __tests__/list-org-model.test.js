const M = require('../renderer/lib/list-org-model')

const base = () => M.emptyState()

describe('orderedItems', () => {
  it('appends live keys not in stored order (activity fallback)', () => {
    const s = base()
    const items = M.orderedItems(s, 'FEAT', ['a', 'b', 'c'])
    expect(items.map(i => i.key)).toEqual(['a', 'b', 'c'])
  })
  it('honors stored order, then appends new keys', () => {
    let s = base()
    s = M.moveSession(s, 'FEAT', 'c', 0)   // pin c to front
    const items = M.orderedItems(s, 'FEAT', ['a', 'b', 'c'])
    expect(items.map(i => i.key)).toEqual(['c', 'a', 'b'])
  })
  it('drops dead keys', () => {
    let s = base()
    s = M.moveSession(s, 'FEAT', 'gone', 0)
    const items = M.orderedItems(s, 'FEAT', ['a'])
    expect(items.map(i => i.key)).toEqual(['a'])
  })
})

describe('groups', () => {
  it('creates a group, adds members, resolves them under the group', () => {
    let s = base()
    s = M.createGroup(s, 'FEAT', 'g1', 'PROJ-100')
    s = M.addToGroup(s, 'FEAT', 'g1', 'a', 0)
    s = M.addToGroup(s, 'FEAT', 'g1', 'b', 1)
    const items = M.orderedItems(s, 'FEAT', ['a', 'b', 'c'])
    const group = items.find(i => i.kind === 'group')
    expect(group).toMatchObject({ id: 'g1', name: 'PROJ-100', collapsed: false })
    expect(group.members).toEqual(['a', 'b'])
    // grouped members are NOT also top-level; c stays loose
    expect(items.filter(i => i.kind === 'session').map(i => i.key)).toEqual(['c'])
  })
  it('rename + collapse persist', () => {
    let s = base()
    s = M.createGroup(s, 'FEAT', 'g1', 'X')
    s = M.renameGroup(s, 'FEAT', 'g1', 'PROJ-9')
    s = M.toggleGroupCollapsed(s, 'FEAT', 'g1')
    expect(s.categories.FEAT.groups.g1).toMatchObject({ name: 'PROJ-9', collapsed: true })
  })
  it('deleteGroup returns members to loose top-level at the group slot', () => {
    let s = base()
    s = M.moveSession(s, 'FEAT', 'x', 0)
    s = M.createGroup(s, 'FEAT', 'g1', 'X')
    s = M.addToGroup(s, 'FEAT', 'g1', 'a', 0)
    s = M.addToGroup(s, 'FEAT', 'g1', 'b', 1)
    s = M.deleteGroup(s, 'FEAT', 'g1')
    const items = M.orderedItems(s, 'FEAT', ['x', 'a', 'b'])
    expect(items.every(i => i.kind === 'session')).toBe(true)
    expect(items.map(i => i.key)).toEqual(['x', 'a', 'b'])
  })
  it('removeFromGroup puts the session back at top level', () => {
    let s = base()
    s = M.createGroup(s, 'FEAT', 'g1', 'X')
    s = M.addToGroup(s, 'FEAT', 'g1', 'a', 0)
    s = M.addToGroup(s, 'FEAT', 'g1', 'b', 1)
    s = M.removeFromGroup(s, 'FEAT', 'g1', 'a', 0)
    const items = M.orderedItems(s, 'FEAT', ['a', 'b'])
    expect(items.find(i => i.kind === 'group').members).toEqual(['b'])
    expect(items.find(i => i.kind === 'session').key).toBe('a')
  })
  it('empty groups are kept (no auto-dissolve)', () => {
    let s = base()
    s = M.createGroup(s, 'FEAT', 'g1', 'X')
    expect(s.categories.FEAT.groups.g1).toBeDefined()
    const items = M.orderedItems(s, 'FEAT', [])
    expect(items.find(i => i.kind === 'group').id).toBe('g1')
  })
})

describe('unmanaged position + prune + load', () => {
  it('setUnmanagedIndex stores the position', () => {
    expect(M.setUnmanagedIndex(base(), 3).unmanagedIndex).toBe(3)
  })
  it('prune drops dead keys but keeps groups', () => {
    let s = base()
    s = M.moveSession(s, 'FEAT', 'dead', 0)
    s = M.createGroup(s, 'FEAT', 'g1', 'X')
    s = M.addToGroup(s, 'FEAT', 'g1', 'deadmember', 0)
    s = M.prune(s, { FEAT: new Set(['alive']) })
    expect(s.categories.FEAT.order).not.toContain('dead')
    expect(s.categories.FEAT.groups.g1).toBeDefined()
    expect(s.categories.FEAT.groups.g1.members).not.toContain('deadmember')
  })
  it('load tolerates corrupt input', () => {
    expect(M.normalize(null)).toEqual(M.emptyState())
    expect(M.normalize({ categories: 'nope', unmanagedIndex: 'x' })).toEqual(M.emptyState())
  })
})
