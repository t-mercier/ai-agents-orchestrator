const B = require('../renderer/lib/board-model')

test('emptyState seeds the default columns, no items', () => {
  const s = B.emptyState()
  expect(s.columns.map(c => c.name)).toEqual(
    ['To do', 'In progress', 'To review', 'Waiting for review', 'Waiting for info', 'Done'])
  expect(s.placements).toEqual({})
  expect(s.notes).toEqual([])
})

test('addColumn appends a column with a unique id', () => {
  const s = B.addColumn(B.emptyState(), 'Blocked')
  expect(s.columns[s.columns.length - 1].name).toBe('Blocked')
  expect(s.columns[s.columns.length - 1].id).toBeTruthy()
})

test('renameColumn changes the name, ignores blank', () => {
  let s = B.emptyState(); const id = s.columns[0].id
  s = B.renameColumn(s, id, 'TODO!')
  expect(s.columns[0].name).toBe('TODO!')
  s = B.renameColumn(s, id, '   ')
  expect(s.columns[0].name).toBe('TODO!')
})

test('removeColumn reassigns its placements + notes to the first column', () => {
  let s = B.emptyState()
  const second = s.columns[1].id
  s = B.placeSession(s, 'sessA', second)
  s = B.addNote(s, second, 'note in second')
  s = B.removeColumn(s, second)
  const first = s.columns[0].id
  expect(s.columns.find(c => c.id === second)).toBeUndefined()
  expect(s.placements['sessA']).toBe(first)
  expect(s.notes[0].columnId).toBe(first)
})

test('moveColumn reorders left/right within bounds', () => {
  let s = B.emptyState()
  const [a, b] = [s.columns[0].id, s.columns[1].id]
  s = B.moveColumn(s, b, -1)
  expect(s.columns[0].id).toBe(b)
  expect(s.columns[1].id).toBe(a)
  const firstNow = s.columns[0].id
  s = B.moveColumn(s, firstNow, -1)
  expect(s.columns[0].id).toBe(firstNow)
})

test('setColumnHidden toggles a column hidden flag, normalize keeps it', () => {
  let s = B.emptyState(); const id = s.columns[0].id
  s = B.setColumnHidden(s, id, true)
  expect(s.columns[0].hidden).toBe(true)
  s = B.normalize(s)
  expect(s.columns[0].hidden).toBe(true)
  s = B.setColumnHidden(s, id, false)
  expect(s.columns[0].hidden).toBe(false)
})

test('setColumnColor sets valid hex, clears on invalid; normalize keeps it', () => {
  let s = B.emptyState(); const id = s.columns[0].id
  s = B.setColumnColor(s, id, '#ff8800')
  expect(s.columns[0].color).toBe('#ff8800')
  s = B.normalize(s)
  expect(s.columns[0].color).toBe('#ff8800')
  s = B.setColumnColor(s, id, 'nope')
  expect(s.columns[0].color).toBeUndefined()
})

test('placeSession / unplaceSession', () => {
  let s = B.emptyState(); const col = s.columns[2].id
  s = B.placeSession(s, 'k1', col)
  expect(s.placements['k1']).toBe(col)
  s = B.placeSession(s, 'k1', 'does-not-exist')
  expect(s.placements['k1']).toBe(col)
  s = B.unplaceSession(s, 'k1')
  expect(s.placements['k1']).toBeUndefined()
})

test('note CRUD', () => {
  let s = B.emptyState(); const col = s.columns[0].id
  s = B.addNote(s, col, 'remember X')
  const id = s.notes[0].id
  expect(s.notes[0]).toMatchObject({ text: 'remember X', columnId: col })
  s = B.updateNote(s, id, 'remember Y')
  expect(s.notes[0].text).toBe('remember Y')
  s = B.removeNote(s, id)
  expect(s.notes).toEqual([])
})

test('moveItem moves a note and a session placement', () => {
  let s = B.emptyState(); const [a, b] = [s.columns[0].id, s.columns[1].id]
  s = B.addNote(s, a, 'n'); const nid = s.notes[0].id
  s = B.moveItem(s, 'note', nid, b)
  expect(s.notes[0].columnId).toBe(b)
  s = B.placeSession(s, 'sess', a)
  s = B.moveItem(s, 'session', 'sess', b)
  expect(s.placements['sess']).toBe(b)
})

test('itemsByColumn groups sessions (keys) + notes, drops orphans', () => {
  let s = B.emptyState(); const a = s.columns[0].id
  s = B.placeSession(s, 'k', a)
  s = B.addNote(s, a, 'n')
  s.placements['orphan'] = 'ghost-col'
  const g = B.itemsByColumn(s)
  expect(g[a].sessions).toContain('k')
  expect(g[a].notes).toHaveLength(1)
  expect(Object.values(g).some(c => c.sessions.includes('orphan'))).toBe(false)
})

test('normalize repairs garbage into a valid state', () => {
  expect(B.normalize(null).columns.length).toBeGreaterThan(0)
  expect(B.normalize({ columns: [] }).columns.length).toBeGreaterThan(0)
  const s = B.normalize({ columns: [{ id: 'x', name: 'X' }], placements: 'bad', notes: [{ nope: 1 }] })
  expect(s.columns).toEqual([{ id: 'x', name: 'X', hidden: false }])
  expect(s.placements).toEqual({})
  expect(s.notes).toEqual([])
})

test('toggleUrgent flips a flag and survives clone-based mutations', () => {
  let s = B.emptyState()
  s = B.placeSession(s, 'sess', s.columns[0].id)
  s = B.toggleUrgent(s, 'sess')
  expect(B.isUrgent(s, 'sess')).toBe(true)
  // a later mutation (clone) must preserve the urgent flag
  s = B.placeSession(s, 'other', s.columns[1].id)
  expect(s.urgent).toContain('sess')
  s = B.toggleUrgent(s, 'sess')
  expect(B.isUrgent(s, 'sess')).toBe(false)
})

test('unplaceSession + removeNote clear the urgent flag', () => {
  let s = B.emptyState()
  s = B.placeSession(s, 'k', s.columns[0].id); s = B.toggleUrgent(s, 'k')
  s = B.unplaceSession(s, 'k')
  expect(s.urgent).not.toContain('k')
  s = B.addNote(s, s.columns[0].id, 'n'); const nid = s.notes[0].id
  s = B.toggleUrgent(s, nid); s = B.removeNote(s, nid)
  expect(s.urgent).not.toContain(nid)
})

test('moveItem with an index reorders within a column; orderedItems reflects it', () => {
  let s = B.emptyState(); const col = s.columns[0].id
  s = B.placeSession(s, 'a', col); s = B.placeSession(s, 'b', col); s = B.placeSession(s, 'c', col)
  expect(B.orderedItems(s, col).map(i => i.id)).toEqual(['a', 'b', 'c'])
  s = B.moveItem(s, 'session', 'c', col, 0)        // c to the top
  expect(B.orderedItems(s, col).map(i => i.id)).toEqual(['c', 'a', 'b'])
})

test('orderedItems appends un-ordered items (sessions then notes) and survives clone', () => {
  let s = B.emptyState(); const col = s.columns[0].id
  s = B.placeSession(s, 'a', col)
  s = B.addNote(s, col, 'n')
  const items = B.orderedItems(s, col)
  expect(items.map(i => i.kind)).toEqual(['session', 'note'])
  // order persists through an unrelated mutation
  s = B.toggleUrgent(s, 'a')
  expect(B.orderedItems(s, col).map(i => i.id)[0]).toBe('a')
})

test('createGroup nests two cards; orderedItems shows a group at the column top level', () => {
  let s = B.emptyState(); const col = s.columns[0].id
  s = B.placeSession(s, 'a', col); s = B.placeSession(s, 'b', col); s = B.placeSession(s, 'c', col)
  s = B.createGroup(s, col, ['a', 'b'], 'Auth')
  const top = B.orderedItems(s, col)
  expect(top.some(i => i.kind === 'group')).toBe(true)
  expect(top.filter(i => i.kind === 'session').map(i => i.id)).toEqual(['c'])  // a,b hidden inside the group
  const gid = top.find(i => i.kind === 'group').id
  expect(B.groupMembers(s, gid)).toEqual(['a', 'b'])
  expect(B.findGroupOf(s, 'a')).toBe(gid)
})

test('group auto-dissolves when it drops below 2 members', () => {
  let s = B.emptyState(); const col = s.columns[0].id
  s = B.placeSession(s, 'a', col); s = B.placeSession(s, 'b', col)
  s = B.createGroup(s, col, ['a', 'b'], 'G')
  const gid = B.orderedItems(s, col).find(i => i.kind === 'group').id
  s = B.removeFromGroup(s, gid, 'a', col)         // pull 'a' out → only 'b' left → dissolve
  expect(s.groups.length).toBe(0)
  expect(B.orderedItems(s, col).map(i => i.id).sort()).toEqual(['a', 'b'])
})

test('addToGroup + ungroup + collapse', () => {
  let s = B.emptyState(); const col = s.columns[0].id
  ;['a', 'b', 'c'].forEach(k => { s = B.placeSession(s, k, col) })
  s = B.createGroup(s, col, ['a', 'b'], 'G')
  let gid = s.groups[0].id
  s = B.addToGroup(s, gid, 'c')
  expect(B.groupMembers(s, gid).sort()).toEqual(['a', 'b', 'c'])
  s = B.setGroupCollapsed(s, gid, true)
  expect(s.groups[0].collapsed).toBe(true)
  s = B.ungroup(s, gid)
  expect(s.groups.length).toBe(0)
  expect(B.orderedItems(s, col).map(i => i.id).sort()).toEqual(['a', 'b', 'c'])
})

test('attached notes hang under their parent and are hidden from the column top level', () => {
  let s = B.emptyState(); const col = s.columns[0].id
  s = B.placeSession(s, 'card', col)
  s = B.addNote(s, col, 'attached', 'card')   // attached to the card
  s = B.addNote(s, col, 'loose')              // loose column note
  const top = B.orderedItems(s, col)
  expect(top.filter(i => i.kind === 'note').length).toBe(1)   // only the loose note at top level
  expect(B.notesFor(s, 'card').map(n => n.text)).toEqual(['attached'])
})

test('an attached note whose parent is gone falls back to a loose note', () => {
  let s = B.emptyState(); const col = s.columns[0].id
  s = B.placeSession(s, 'card', col)
  s = B.addNote(s, col, 'attached', 'card')
  s = B.unplaceSession(s, 'card')             // parent gone
  expect(B.orderedItems(s, col).some(i => i.kind === 'note')).toBe(true)   // now loose
  expect(B.notesFor(s, 'card')).toEqual([])
})
