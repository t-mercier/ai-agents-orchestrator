// Kanban board model. UMD: window.CSMBoard in the renderer + require() in jest.
// Pure state mutators (each returns a NEW state) + thin localStorage load/save.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMBoard = api
})(typeof self !== 'undefined' ? self : this, function () {
  const STORAGE_KEY = 'csm.kanban'

  const DEFAULT_COLUMNS = [
    { id: 'todo', name: 'To do' },
    { id: 'doing', name: 'In progress' },
    { id: 'review', name: 'To review' },
    { id: 'wait-review', name: 'Waiting for review' },
    { id: 'wait-info', name: 'Waiting for info' },
    { id: 'done', name: 'Done' },
  ]

  let seq = 0
  function genId(prefix) { seq += 1; return `${prefix}-${Date.now().toString(36)}-${seq}` }

  const GROUP_PREFIX = 'g:'
  const groupRef = (gid) => GROUP_PREFIX + gid
  const isGroupRef = (id) => typeof id === 'string' && id.startsWith(GROUP_PREFIX)

  function emptyState() {
    return { columns: DEFAULT_COLUMNS.map(c => ({ ...c })), placements: {}, notes: [], urgent: [], order: {}, groups: [] }
  }

  function normalize(obj) {
    const s = (obj && typeof obj === 'object') ? obj : {}
    let columns = Array.isArray(s.columns)
      ? s.columns.filter(c => c && c.id && typeof c.name === 'string')
      : []
    if (columns.length === 0) columns = DEFAULT_COLUMNS
    columns = columns.map(c => {
      const col = { id: c.id, name: c.name, hidden: !!c.hidden }
      if (/^#[0-9a-fA-F]{6}$/.test(c.color || '')) col.color = c.color
      return col
    })
    const placements = (s.placements && typeof s.placements === 'object' && !Array.isArray(s.placements)) ? { ...s.placements } : {}
    const notes = Array.isArray(s.notes)
      ? s.notes.filter(n => n && n.id && n.columnId).map(n => ({
          id: n.id, text: String(n.text || ''), columnId: n.columnId,
          ...(typeof n.parent === 'string' ? { parent: n.parent } : {}),   // attached to a card/group
        }))
      : []
    // Manually-flagged "urgent" items (session keys or note ids); float to the top.
    const urgent = Array.isArray(s.urgent) ? s.urgent.filter(x => typeof x === 'string') : []
    // Per-column manual ordering: { columnId: [itemId, ...] }. Items absent from the
    // list fall back to natural order (appended). Group-ready (ids can be group refs).
    const order = {}
    if (s.order && typeof s.order === 'object' && !Array.isArray(s.order)) {
      for (const [col, ids] of Object.entries(s.order)) {
        if (Array.isArray(ids)) order[col] = ids.filter(x => typeof x === 'string')
      }
    }
    // Card groups: { id, name, columnId, collapsed }. Members + their order live in
    // order['g:'+id]; the column references a group via the ref 'g:'+id.
    const groups = Array.isArray(s.groups)
      ? s.groups.filter(g => g && g.id && g.columnId)
        .map(g => ({ id: g.id, name: String(g.name || 'Group'), columnId: g.columnId, collapsed: !!g.collapsed }))
      : []
    return { columns, placements, notes, urgent, order, groups }
  }

  function clone(state) {
    const order = {}
    if (state.order) for (const [col, ids] of Object.entries(state.order)) order[col] = [...ids]
    return {
      columns: state.columns.map(c => ({ ...c })),
      placements: { ...state.placements },
      notes: state.notes.map(n => ({ ...n })),
      urgent: Array.isArray(state.urgent) ? [...state.urgent] : [],
      order,
      groups: Array.isArray(state.groups) ? state.groups.map(g => ({ ...g })) : [],
    }
  }
  function firstColumnId(state) { return state.columns.length ? state.columns[0].id : null }
  function hasColumn(state, id) { return state.columns.some(c => c.id === id) }

  function addColumn(state, name) {
    const s = clone(state)
    s.columns.push({ id: genId('col'), name: String(name || '').trim() || 'New column' })
    return s
  }
  function renameColumn(state, columnId, name) {
    const s = clone(state)
    const col = s.columns.find(c => c.id === columnId)
    const clean = String(name || '').trim()
    if (col && clean) col.name = clean
    return s
  }
  function removeColumn(state, columnId) {
    const s = clone(state)
    s.columns = s.columns.filter(c => c.id !== columnId)
    const fallback = firstColumnId(s)
    for (const k of Object.keys(s.placements)) {
      if (s.placements[k] === columnId) {
        if (fallback) s.placements[k] = fallback; else delete s.placements[k]
      }
    }
    s.notes = s.notes
      .map(n => n.columnId === columnId ? { ...n, columnId: fallback } : n)
      .filter(n => n.columnId)
    s.groups = s.groups
      .map(g => g.columnId === columnId ? { ...g, columnId: fallback } : g)
      .filter(g => g.columnId)
    delete s.order[columnId]   // moved items fall back to natural order in the fallback column
    return s
  }
  function moveColumn(state, columnId, dir) {
    const s = clone(state)
    const i = s.columns.findIndex(c => c.id === columnId)
    const j = i + dir
    if (i >= 0 && j >= 0 && j < s.columns.length) { const t = s.columns[i]; s.columns[i] = s.columns[j]; s.columns[j] = t }
    return s
  }
  function setColumnHidden(state, columnId, hidden) {
    const s = clone(state)
    const col = s.columns.find(c => c.id === columnId)
    if (col) col.hidden = !!hidden
    return s
  }
  function setColumnColor(state, columnId, color) {
    const s = clone(state)
    const col = s.columns.find(c => c.id === columnId)
    if (col) {
      if (/^#[0-9a-fA-F]{6}$/.test(color || '')) col.color = color
      else delete col.color
    }
    return s
  }
  // ── Manual ordering within a column ──
  function removeFromOrder(s, id) {
    for (const col of Object.keys(s.order)) {
      const i = s.order[col].indexOf(id)
      if (i >= 0) s.order[col].splice(i, 1)
    }
  }
  // Insert `id` at `index` within the column's FULL ordered list (explicit order +
  // natural tail), then write that back as the column's order. Robust for data with
  // no prior order (migrated boards): the tail is folded in on first move.
  function setOrder(s, id, columnId, index) {
    const full = orderedIds(s, columnId).filter(x => x !== id)
    const i = (index == null || index < 0 || index > full.length) ? full.length : index
    full.splice(i, 0, id)
    removeFromOrder(s, id)
    s.order[columnId] = full
  }
  function placeSession(state, sessionKey, columnId) {
    const s = clone(state)
    if (sessionKey && hasColumn(s, columnId)) { s.placements[sessionKey] = columnId; setOrder(s, sessionKey, columnId) }
    return s
  }
  function unplaceSession(state, sessionKey) {
    const s = clone(state); delete s.placements[sessionKey]; removeFromOrder(s, sessionKey); s.urgent = s.urgent.filter(x => x !== sessionKey); return cleanupGroups(s)
  }
  // Toggle an item's "urgent" flag (session key or note id).
  function toggleUrgent(state, id) {
    const s = clone(state)
    s.urgent = s.urgent.includes(id) ? s.urgent.filter(x => x !== id) : [...s.urgent, id]
    return s
  }
  function isUrgent(state, id) { return Array.isArray(state.urgent) && state.urgent.includes(id) }
  // Add a note. With `parent` (a session key or group id) the note is *attached* to
  // that card/group (rendered under it); without, it's a loose column note.
  function addNote(state, columnId, text, parent) {
    const s = clone(state)
    const col = hasColumn(s, columnId) ? columnId : firstColumnId(s)
    if (col) {
      const id = genId('note')
      const note = { id, text: String(text || '').trim(), columnId: col }
      if (parent) note.parent = parent
      s.notes.push(note)
      if (!parent) setOrder(s, id, col)   // only loose notes take part in the column order
    }
    return s
  }
  // Is a note's parent still a real card/group?
  function validParent(state, pid) {
    return pid != null && (state.placements[pid] !== undefined || state.groups.some(g => g.id === pid))
  }
  // Notes attached to a given card/group (in insertion order).
  function notesFor(state, parentId) {
    return state.notes.filter(n => n.parent === parentId && validParent(state, parentId))
  }
  function updateNote(state, noteId, text) {
    const s = clone(state)
    const n = s.notes.find(x => x.id === noteId)
    if (n) n.text = String(text || '').trim()
    return s
  }
  function removeNote(state, noteId) {
    const s = clone(state); s.notes = s.notes.filter(n => n.id !== noteId); removeFromOrder(s, noteId); s.urgent = s.urgent.filter(x => x !== noteId); return cleanupGroups(s)
  }
  // Move an item to a column (and optional position `index` within that column).
  function moveItem(state, kind, id, columnId, index) {
    if (!hasColumn(state, columnId)) return clone(state)
    const s = clone(state)
    if (kind === 'note') { const n = s.notes.find(x => x.id === id); if (n) n.columnId = columnId }
    else if (id) s.placements[id] = columnId
    setOrder(s, id, columnId, index)   // setOrder strips id from any group's order too
    return cleanupGroups(s)            // pulling a card out can leave a <2 group → dissolve
  }
  // Move a whole group (and its members' column) to a column at an optional position.
  function moveGroup(state, gid, columnId, index) {
    const g = state.groups.find(x => x.id === gid)
    if (!g || !hasColumn(state, columnId)) return clone(state)
    const s = clone(state)
    s.groups.find(x => x.id === gid).columnId = columnId
    for (const m of (s.order[groupRef(gid)] || [])) setMemberColumn(s, m, columnId)
    setOrder(s, groupRef(gid), columnId, index)
    return s
  }
  function itemsByColumn(state) {
    const out = {}
    for (const c of state.columns) out[c.id] = { sessions: [], notes: [] }
    for (const [key, col] of Object.entries(state.placements)) if (out[col]) out[col].sessions.push(key)
    for (const n of state.notes) if (out[n.columnId]) out[n.columnId].notes.push(n)
    return out
  }
  // Every item id that currently belongs to some group (so it's hidden from the
  // column top level and shown inside its group instead).
  function groupedIdSet(state) {
    const out = new Set()
    for (const g of state.groups) for (const id of (state.order[groupRef(g.id)] || [])) out.add(id)
    return out
  }
  // Ordered ids for a "container": a column id → its top-level items (ungrouped
  // sessions/notes + group refs), or a group ref 'g:<id>' → that group's members.
  function orderedIds(state, key) {
    if (isGroupRef(key)) {
      const present = new Set([...Object.keys(state.placements), ...state.notes.map(n => n.id)])
      return (state.order[key] || []).filter(id => present.has(id))
    }
    const columnId = key
    const grouped = groupedIdSet(state)
    const sessions = Object.keys(state.placements).filter(k => state.placements[k] === columnId && !grouped.has(k))
    // Notes with a valid parent are shown under that card/group, not at the top level.
    const noteIds = state.notes.filter(n => n.columnId === columnId && !grouped.has(n.id) && !validParent(state, n.parent)).map(n => n.id)
    const groupRefs = state.groups.filter(g => g.columnId === columnId).map(g => groupRef(g.id))
    const present = new Set([...sessions, ...noteIds, ...groupRefs])
    const ord = ((state.order && state.order[columnId]) || []).filter(id => present.has(id))
    const seen = new Set(ord)
    const tail = [...sessions, ...noteIds, ...groupRefs].filter(id => !seen.has(id))
    return [...ord, ...tail]
  }
  // Same, as {kind, id} for rendering: 'group' | 'session' | 'note'.
  function orderedItems(state, key) {
    const sessionSet = new Set(Object.keys(state.placements))
    return orderedIds(state, key).map(id => ({
      kind: isGroupRef(id) ? 'group' : (sessionSet.has(id) ? 'session' : 'note'),
      id: isGroupRef(id) ? id.slice(GROUP_PREFIX.length) : id,
      ref: id,
    }))
  }

  // ── Groups ──
  function setMemberColumn(s, id, columnId) {
    const n = s.notes.find(x => x.id === id)
    if (n) n.columnId = columnId
    else if (s.placements[id] !== undefined || !n) s.placements[id] = columnId   // treat as a session
  }
  function findGroupOf(state, id) {
    for (const g of state.groups) if ((state.order[groupRef(g.id)] || []).includes(id)) return g.id
    return null
  }
  function groupMembers(state, gid) { return orderedIds(state, groupRef(gid)) }
  // Dissolve a group in place: its members replace the group ref in the column order.
  function ungroupInPlace(s, gid) {
    const g = s.groups.find(x => x.id === gid)
    if (!g) return s
    const ref = groupRef(gid)
    const members = [...(s.order[ref] || [])]
    if (!s.order[g.columnId]) s.order[g.columnId] = orderedIds(s, g.columnId)
    const arr = s.order[g.columnId]
    const i = arr.indexOf(ref)
    if (i >= 0) arr.splice(i, 1, ...members); else arr.push(...members)
    delete s.order[ref]
    s.groups = s.groups.filter(x => x.id !== gid)
    return s
  }
  // A group must hold ≥2 members; otherwise it dissolves.
  function cleanupGroups(s) {
    for (const g of [...s.groups]) {
      if ((s.order[groupRef(g.id)] || []).filter(Boolean).length < 2) ungroupInPlace(s, g.id)
    }
    return s
  }
  function createGroup(state, columnId, memberIds, name, atIndex) {
    if (!hasColumn(state, columnId)) return clone(state)
    const ids = (memberIds || []).filter(Boolean)
    if (ids.length < 2) return clone(state)
    const s = clone(state)
    const gid = genId('grp')
    s.groups.push({ id: gid, name: String(name || 'Group'), columnId, collapsed: false })
    ids.forEach(id => { removeFromOrder(s, id); setMemberColumn(s, id, columnId) })
    s.order[groupRef(gid)] = [...ids]
    setOrder(s, groupRef(gid), columnId, atIndex)
    return cleanupGroups(s)   // a member pulled from another group may have shrunk it
  }
  function addToGroup(state, gid, id, index) {
    const g = state.groups.find(x => x.id === gid)
    if (!g || !id) return clone(state)
    const s = clone(state)
    const ref = groupRef(gid)
    removeFromOrder(s, id)
    setMemberColumn(s, id, g.columnId)
    if (!s.order[ref]) s.order[ref] = []
    const arr = s.order[ref]
    const i = (index == null || index < 0 || index > arr.length) ? arr.length : index
    arr.splice(i, 0, id)
    return cleanupGroups(s)
  }
  // Pull an item out of its group, placing it at column top level (optional index).
  function removeFromGroup(state, gid, id, toColumnId, index) {
    const g = state.groups.find(x => x.id === gid)
    if (!g) return clone(state)
    let s = clone(state)
    s.order[groupRef(gid)] = (s.order[groupRef(gid)] || []).filter(x => x !== id)
    setMemberColumn(s, id, toColumnId || g.columnId)
    setOrder(s, id, toColumnId || g.columnId, index)
    return cleanupGroups(s)
  }
  function ungroup(state, gid) { return ungroupInPlace(clone(state), gid) }
  function renameGroup(state, gid, name) {
    const s = clone(state); const g = s.groups.find(x => x.id === gid)
    const clean = String(name || '').trim(); if (g && clean) g.name = clean; return s
  }
  function setGroupCollapsed(state, gid, collapsed) {
    const s = clone(state); const g = s.groups.find(x => x.id === gid); if (g) g.collapsed = !!collapsed; return s
  }

  function load() {
    try {
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(STORAGE_KEY) : null
      return raw ? normalize(JSON.parse(raw)) : emptyState()
    } catch { return emptyState() }
  }
  function save(state) {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(normalize(state))) } catch { /* ignore */ }
  }

  return {
    STORAGE_KEY, DEFAULT_COLUMNS, emptyState, normalize,
    addColumn, renameColumn, removeColumn, moveColumn, setColumnHidden, setColumnColor,
    placeSession, unplaceSession, addNote, updateNote, removeNote, moveItem,
    toggleUrgent, isUrgent, itemsByColumn, orderedItems, orderedIds,
    createGroup, addToGroup, removeFromGroup, ungroup, renameGroup, setGroupCollapsed, groupMembers, findGroupOf, moveGroup,
    notesFor,
    load, save,
  }
})
