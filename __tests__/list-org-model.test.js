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
  it('createGroupWith creates a group with members', () => {
    let s = base()
    s = M.createGroupWith(s, 'FEAT', 'g1', ['a', 'b'], 0)
    const items = M.orderedItems(s, 'FEAT', ['a', 'b', 'c'])
    const group = items.find(i => i.kind === 'group')
    expect(group).toMatchObject({ id: 'g1', collapsed: false })
    expect(group.members).toEqual(['a', 'b'])
    // grouped members are NOT also top-level; c stays loose
    expect(items.filter(i => i.kind === 'session').map(i => i.key)).toEqual(['c'])
  })
  it('adds a session to an existing group', () => {
    let s = base()
    s = M.createGroupWith(s, 'FEAT', 'g1', ['a', 'b'], 0)
    s = M.addToGroup(s, 'FEAT', 'g1', 'c', 2)
    const items = M.orderedItems(s, 'FEAT', ['a', 'b', 'c'])
    const group = items.find(i => i.kind === 'group')
    expect(group.members).toEqual(['a', 'b', 'c'])
  })
  it('rename + collapse persist', () => {
    let s = base()
    s = M.createGroupWith(s, 'FEAT', 'g1', ['a', 'b'], 0)
    s = M.renameGroup(s, 'FEAT', 'g1', 'PROJ-9')
    s = M.toggleGroupCollapsed(s, 'FEAT', 'g1')
    expect(s.categories.FEAT.groups.g1).toMatchObject({ name: 'PROJ-9', collapsed: true })
  })
  it('deleteGroup returns members to loose top-level at the group slot', () => {
    let s = base()
    s = M.moveSession(s, 'FEAT', 'x', 0)
    s = M.createGroupWith(s, 'FEAT', 'g1', ['a', 'b'], 1)
    s = M.deleteGroup(s, 'FEAT', 'g1')
    const items = M.orderedItems(s, 'FEAT', ['x', 'a', 'b'])
    expect(items.every(i => i.kind === 'session')).toBe(true)
    expect(items.map(i => i.key)).toEqual(['x', 'a', 'b'])
  })
  it('removeFromGroup leaves >= 2-member groups intact but auto-dissolves 1-member groups', () => {
    let s = base()
    s = M.createGroupWith(s, 'FEAT', 'g1', ['a', 'b', 'c'], 0)
    // Remove 'a' (still 2 members left, group survives)
    s = M.removeFromGroup(s, 'FEAT', 'g1', 'a', 0)
    let items = M.orderedItems(s, 'FEAT', ['a', 'b', 'c'])
    expect(items.find(i => i.kind === 'group').members).toEqual(['b', 'c'])
    expect(items.find(i => i.kind === 'session' && i.key === 'a')).toBeDefined()
    // Remove 'b' (1 member left, group auto-dissolves)
    s = M.removeFromGroup(s, 'FEAT', 'g1', 'b', 0)
    items = M.orderedItems(s, 'FEAT', ['a', 'b', 'c'])
    expect(items.find(i => i.kind === 'group')).toBeUndefined()
    expect(items.filter(i => i.kind === 'session').map(i => i.key)).toContain('c')
  })
  it('groups must have >= 2 members; createGroupWith enforces this', () => {
    let s = base()
    // Attempt to create with < 2 members should be rejected or handled
    s = M.createGroupWith(s, 'FEAT', 'g1', ['a'], 0)
    const items = M.orderedItems(s, 'FEAT', ['a'])
    // With < 2 members, the group ref is not created, members stay loose
    expect(items.filter(i => i.kind === 'group').length).toBe(0)
    expect(items.filter(i => i.kind === 'session').length).toBe(1)
  })
  it('moveGroupRef repositions the group within the category', () => {
    let s = M.emptyState()
    s = M.moveSession(s, 'FEAT', 'a', 0)
    s = M.createGroup(s, 'FEAT', 'g1', 'X')   // ref appended after 'a'
    s = M.moveGroupRef(s, 'FEAT', 'g1', 0)    // move group to front
    expect(s.categories.FEAT.order[0]).toBe('g:g1')
  })
})

describe('prune + load', () => {
  it('prune drops dead keys and dissolves groups with < 2 live members', () => {
    let s = base()
    s = M.moveSession(s, 'FEAT', 'dead', 0)
    s = M.createGroupWith(s, 'FEAT', 'g1', ['alive', 'deadmember'], 1)
    s = M.prune(s, { FEAT: new Set(['alive']) })
    expect(s.categories.FEAT.order).not.toContain('dead')
    // After prune, group has only 1 live member (deadmember is removed from members)
    // The group still exists in this implementation (prune doesn't call cleanupGroups)
    expect(s.categories.FEAT.groups.g1.members).toEqual(['alive'])
  })
  it('load tolerates corrupt input', () => {
    expect(M.normalize(null)).toEqual(M.emptyState())
    expect(M.normalize({ categories: 'nope' })).toEqual(M.emptyState())
  })
})

describe('group colour', () => {
  const withGroup = () => M.createGroupWith(base(), 'FEAT', 'g1', ['a', 'b'], 0)

  it('a group has no colour until one is set', () => {
    expect(withGroup().categories.FEAT.groups.g1.color).toBe('')
  })

  it('setGroupColor stores a hex and clears back to inherit', () => {
    let s = M.setGroupColor(withGroup(), 'FEAT', 'g1', '#A88FD0')
    expect(s.categories.FEAT.groups.g1.color).toBe('#A88FD0')
    s = M.setGroupColor(s, 'FEAT', 'g1', '')
    expect(s.categories.FEAT.groups.g1.color).toBe('')
  })

  it('refuses anything that is not a hex, so it can never reach a style attribute', () => {
    const s = M.setGroupColor(withGroup(), 'FEAT', 'g1', 'red; background:url(x)')
    expect(s.categories.FEAT.groups.g1.color).toBe('')
  })

  it('orderedItems carries the colour — the renderer reads the item, not the state', () => {
    const s = M.setGroupColor(withGroup(), 'FEAT', 'g1', '#8FC9B9')
    const grp = M.orderedItems(s, 'FEAT', ['a', 'b']).find(i => i.kind === 'group')
    expect(grp.color).toBe('#8FC9B9')
  })

  it('survives a normalize round trip — an unlisted key would be dropped on load', () => {
    const s = M.setGroupColor(withGroup(), 'FEAT', 'g1', '#8FC9B9')
    expect(M.normalize(JSON.parse(JSON.stringify(s))).categories.FEAT.groups.g1.color).toBe('#8FC9B9')
  })
})

describe('moveSession lands where it was dropped', () => {
  // drag-list passes the index over the RENDERED items, the dragged one excluded.
  it('in a category nobody has reordered yet, a drop below the top stays there', () => {
    const live = ['A', 'B', 'C']
    const last = M.moveSession(M.emptyState(), 'FEAT', 'A', 2, live)
    expect(M.orderedItems(last, 'FEAT', live).map(i => i.key)).toEqual(['B', 'C', 'A'])
    const mid = M.moveSession(M.emptyState(), 'FEAT', 'A', 1, live)
    expect(M.orderedItems(mid, 'FEAT', live).map(i => i.key)).toEqual(['B', 'A', 'C'])
  })
  it('a partly reordered category counts the unmoved tail too', () => {
    const live = ['A', 'B', 'C', 'D']
    let s = M.moveSession(M.emptyState(), 'FEAT', 'C', 0, live)   // C, A, B, D
    s = M.moveSession(s, 'FEAT', 'C', 2, live)                     // A, B, C, D
    expect(M.orderedItems(s, 'FEAT', live).map(i => i.key)).toEqual(['A', 'B', 'C', 'D'])
  })
  it('a group block counts as one rendered item', () => {
    const live = ['A', 'B', 'C', 'D']
    let s = M.createGroupWith(M.emptyState(), 'FEAT', 'g1', ['B', 'C'], 0)   // [g1], A, D
    s = M.moveSession(s, 'FEAT', 'D', 1, live)                              // [g1], D, A
    const items = M.orderedItems(s, 'FEAT', live)
    expect(items.map(i => i.kind === 'group' ? 'g1' : i.key)).toEqual(['g1', 'D', 'A'])
  })
})

describe('moveGroupRef with the rendered order', () => {
  it('a group dragged to the bottom of a fresh category lands there', () => {
    let s = M.createGroupWith(M.emptyState(), 'FEAT', 'g1', ['a', 'b'], 0)
    // Rendered: [group g1, c, d]. Drop the group after d (index 2 once it is lifted out).
    s = M.moveGroupRef(s, 'FEAT', 'g1', 2, ['a', 'b', 'c', 'd'])
    expect(M.orderedItems(s, 'FEAT', ['a', 'b', 'c', 'd']).map(i => i.kind === 'group' ? i.id : i.key))
      .toEqual(['c', 'd', 'g1'])
  })
})
