// List-view organization model: per-category session order + groups + the
// "Recent · unmanaged" block position. UMD: window.CSMListOrg + require() in jest.
// Pure mutators (each returns a NEW state) + thin localStorage load/save. No DOM.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMListOrg = api
})(typeof self !== 'undefined' ? self : this, function () {
  const STORAGE_KEY = 'csm.listorg'
  const GROUP_PREFIX = 'g:'
  const groupRef = (gid) => GROUP_PREFIX + gid
  const isGroupRef = (id) => typeof id === 'string' && id.startsWith(GROUP_PREFIX)

  function emptyState() { return { unmanagedIndex: null, categories: {} } }

  function normalize(obj) {
    const s = (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {}
    const out = emptyState()
    out.unmanagedIndex = (typeof s.unmanagedIndex === 'number' && s.unmanagedIndex >= 0) ? s.unmanagedIndex : null
    const cats = (s.categories && typeof s.categories === 'object' && !Array.isArray(s.categories)) ? s.categories : {}
    for (const [cat, c] of Object.entries(cats)) {
      if (!c || typeof c !== 'object') continue
      const order = Array.isArray(c.order) ? c.order.filter(x => typeof x === 'string') : []
      const groups = {}
      const g = (c.groups && typeof c.groups === 'object' && !Array.isArray(c.groups)) ? c.groups : {}
      for (const [gid, grp] of Object.entries(g)) {
        if (!grp || typeof grp !== 'object') continue
        groups[gid] = {
          name: String(grp.name || 'Group'),
          collapsed: !!grp.collapsed,
          members: Array.isArray(grp.members) ? grp.members.filter(x => typeof x === 'string') : [],
        }
      }
      out.categories[cat] = { order, groups }
    }
    return out
  }

  function clone(state) { return normalize(JSON.parse(JSON.stringify(state))) }
  function cat(s, c) { if (!s.categories[c]) s.categories[c] = { order: [], groups: {} }; return s.categories[c] }

  // Every id that currently belongs to some group in this category.
  function groupedSet(c) {
    const set = new Set()
    for (const g of Object.values(c.groups)) for (const m of g.members) set.add(m)
    return set
  }
  function removeFromTop(c, id) { const i = c.order.indexOf(id); if (i >= 0) c.order.splice(i, 1) }
  function removeFromGroups(c, id) { for (const g of Object.values(c.groups)) { const i = g.members.indexOf(id); if (i >= 0) g.members.splice(i, 1) } }

  function orderedItems(state, catName, liveKeys) {
    const c = state.categories[catName] || { order: [], groups: {} }
    const grouped = groupedSet(c)
    const live = liveKeys || []
    const liveSet = new Set(live)
    // Top-level = loose live sessions + group refs, in stored order, then live tail.
    const validTop = c.order.filter(id =>
      isGroupRef(id) ? !!c.groups[id.slice(GROUP_PREFIX.length)] : (liveSet.has(id) && !grouped.has(id)))
    const seen = new Set(validTop)
    const tail = live.filter(k => !grouped.has(k) && !seen.has(k))
    const top = [...validTop, ...tail]
    return top.map(id => {
      if (isGroupRef(id)) {
        const gid = id.slice(GROUP_PREFIX.length)
        const g = c.groups[gid]
        return { kind: 'group', id: gid, name: g.name, collapsed: g.collapsed, members: g.members.filter(m => liveSet.has(m)) }
      }
      return { kind: 'session', key: id }
    })
  }

  function moveSession(state, catName, key, index) {
    const s = clone(state); const c = cat(s, catName)
    removeFromGroups(c, key); removeFromTop(c, key)
    const i = (index == null || index < 0 || index > c.order.length) ? c.order.length : index
    c.order.splice(i, 0, key)
    return s
  }
  function setUnmanagedIndex(state, i) { const s = clone(state); s.unmanagedIndex = (typeof i === 'number' && i >= 0) ? i : null; return s }

  function createGroup(state, catName, gid, name) {
    const s = clone(state); const c = cat(s, catName)
    if (!c.groups[gid]) { c.groups[gid] = { name: String(name || 'Group'), collapsed: false, members: [] }; c.order.push(groupRef(gid)) }
    return s
  }
  function renameGroup(state, catName, gid, name) {
    const s = clone(state); const g = (s.categories[catName] || {}).groups && s.categories[catName].groups[gid]
    const clean = String(name || '').trim(); if (g && clean) g.name = clean; return s
  }
  function toggleGroupCollapsed(state, catName, gid) {
    const s = clone(state); const c = s.categories[catName]; if (c && c.groups[gid]) c.groups[gid].collapsed = !c.groups[gid].collapsed; return s
  }
  function deleteGroup(state, catName, gid) {
    const s = clone(state); const c = s.categories[catName]; if (!c || !c.groups[gid]) return s
    const members = c.groups[gid].members
    const i = c.order.indexOf(groupRef(gid))
    if (i >= 0) c.order.splice(i, 1, ...members); else c.order.push(...members)
    delete c.groups[gid]
    return s
  }
  function addToGroup(state, catName, gid, key, index) {
    const s = clone(state); const c = cat(s, catName); const g = c.groups[gid]; if (!g) return s
    removeFromTop(c, key); removeFromGroups(c, key)
    const i = (index == null || index < 0 || index > g.members.length) ? g.members.length : index
    g.members.splice(i, 0, key)
    return s
  }
  function removeFromGroup(state, catName, gid, key, index) {
    const s = clone(state); const c = cat(s, catName); const g = c.groups[gid]; if (!g) return s
    const j = g.members.indexOf(key); if (j >= 0) g.members.splice(j, 1)
    removeFromTop(c, key)
    const i = (index == null || index < 0 || index > c.order.length) ? c.order.length : index
    c.order.splice(i, 0, key)
    return s
  }
  function moveGroupRef(state, catName, gid, index) {
    const s = clone(state); const c = cat(s, catName); const ref = groupRef(gid)
    if (!c.groups[gid]) return s
    removeFromTop(c, ref)
    const i = (index == null || index < 0 || index > c.order.length) ? c.order.length : index
    c.order.splice(i, 0, ref)
    return s
  }
  function prune(state, liveKeysByCat) {
    const s = clone(state)
    for (const [catName, c] of Object.entries(s.categories)) {
      const live = (liveKeysByCat && liveKeysByCat[catName]) || new Set()
      c.order = c.order.filter(id => isGroupRef(id) ? !!c.groups[id.slice(GROUP_PREFIX.length)] : live.has(id))
      for (const g of Object.values(c.groups)) g.members = g.members.filter(m => live.has(m))
    }
    return s
  }

  function load() {
    try { const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(STORAGE_KEY) : null; return raw ? normalize(JSON.parse(raw)) : emptyState() } catch { return emptyState() }
  }
  function save(state) {
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(normalize(state))) } catch { /* ignore */ }
  }

  return {
    STORAGE_KEY, GROUP_PREFIX, groupRef, isGroupRef,
    emptyState, normalize, orderedItems,
    moveSession, setUnmanagedIndex,
    createGroup, renameGroup, toggleGroupCollapsed, deleteGroup, addToGroup, removeFromGroup, moveGroupRef,
    prune, load, save,
  }
})
