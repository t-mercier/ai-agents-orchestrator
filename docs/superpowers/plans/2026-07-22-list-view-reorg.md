# List-view Reorg Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the List view, let the user drag-reorder categories (persisted), move the "Recent · unmanaged" block anywhere (notably the bottom), drag-reorder sessions within their category, and create collapsible groups inside a category to cluster related sessions.

**Architecture:** A new pure UMD model `renderer/lib/list-org-model.js` (localStorage `csm.listorg`) holds per-category session order + groups + the unmanaged block position; a new `renderer/lib/drag-list.js` implements a pointer-event drag engine (modeled on `renderer/board.js:421-558`, board.js left untouched); `renderer/ui.js` `renderPanelList` renders from the model and wires the engine. Category order persists to config `order` via `setConfig`; everything else to localStorage. List view only; no `~/.claude` writes.

**Tech Stack:** vanilla-JS UMD modules (`window.CSM*` / `module.exports`), jest, pointer events, `window.api.setConfig`.

## Global Constraints

- **List view only.** Do NOT change Cards (`renderCardsGrid`) or Board views.
- **No `~/.claude` writes, no backend changes.** A session's `category` (notes.md/folder) is never modified. A drop outside the source category is a no-op (snap back). No new Rust command.
- **Git author** must be perso `t-mercier <timothee@mercier.app>` (already the local git config). Do not touch git config.
- **Run/verify from the MAIN checkout**, never a worktree (gitignored `renderer/xterm-bundle.js`). Subagents cannot run the GUI — verify with `node --check` + `npx jest`; GUI checks are deferred to the controller.
- **Renderer modules use the UMD pattern** (see `renderer/lib/board-model.js:3-7`): `(function(root,factory){ const api=factory(); if(module?.exports) module.exports=api; else root.CSMX=api })(...)`.
- **Persistence split:** category order → config `order` (via `window.api.setConfig`); unmanaged position + session order + groups → localStorage `csm.listorg`.
- **Pins unchanged:** pinned sessions keep floating at the top of their category; the manual order/groups govern the non-pinned region; a pinned session is not placed in a group.
- **Groups persist until explicitly deleted** (no auto-dissolve by size — unlike the board). Empty groups are kept.
- **Baseline tests:** 76 jest + 74 Rust. Must only grow and stay green. `sessionKey(s)` = `s.notesPath || s.sessionId || s.name || ''` (`ui.js:44`).

---

### Task 1: `list-org-model.js` — pure model + jest tests

The testable core. No DOM. Adapts the order/group patterns from `board-model.js` into a simpler per-category shape.

**Files:**
- Create: `renderer/lib/list-org-model.js`
- Create: `__tests__/list-org-model.test.js`
- Modify: `renderer/index.html` (add `<script src="lib/list-org-model.js"></script>` after `lib/board-model.js` at line 504)

**Interfaces:**
- Produces (on `window.CSMListOrg` / `module.exports`):
  - State shape: `{ unmanagedIndex: number|null, categories: { [cat]: { order: string[], groups: { [gid]: { name, collapsed, members: string[] } } } } }`. Top-level `order` entries are either a `sessionKey` or a group ref `"g:"+gid`.
  - `emptyState()`, `normalize(obj)`, `load()`, `save(state)`
  - `orderedItems(state, cat, liveKeys)` → `Array<{kind:'session', key} | {kind:'group', id, name, collapsed, members: string[]}>` — merges stored order with `liveKeys` (caller supplies them in fallback/activity order), drops dead keys, resolves groups (members filtered to `liveKeys`).
  - `moveSession(state, cat, key, index)`, `setUnmanagedIndex(state, i)`
  - `createGroup(state, cat, gid, name)`, `renameGroup(state, cat, gid, name)`, `deleteGroup(state, cat, gid)`, `toggleGroupCollapsed(state, cat, gid)`
  - `addToGroup(state, cat, gid, key, index)`, `removeFromGroup(state, cat, gid, key, index)`
  - `prune(state, liveKeysByCat)` — every mutator returns a NEW state (immutable, like board-model `clone`).

- [ ] **Step 1: Write the failing test**

Create `__tests__/list-org-model.test.js`:

```javascript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest list-org-model`
Expected: FAIL — `Cannot find module '../renderer/lib/list-org-model'`.

- [ ] **Step 3: Create the module**

Create `renderer/lib/list-org-model.js`:

```javascript
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
    createGroup, renameGroup, toggleGroupCollapsed, deleteGroup, addToGroup, removeFromGroup,
    prune, load, save,
  }
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest list-org-model`
Expected: PASS (all cases).

- [ ] **Step 5: Wire the script tag + run full suite**

In `renderer/index.html`, after `<script src="lib/board-model.js"></script>` (line 504) add: `  <script src="lib/list-org-model.js"></script>`

Run: `npx jest` → all green (76 + new). `node --check renderer/lib/list-org-model.js` → OK.

- [ ] **Step 6: Commit**

```bash
git add renderer/lib/list-org-model.js __tests__/list-org-model.test.js renderer/index.html
git commit -m "feat(list-org): pure model for list-view order + groups + unmanaged position"
```

---

### Task 2: `drag-list.js` engine + category/unmanaged reorder (Feature A)

Add the pointer-drag engine and use it for its first consumer: reordering category blocks (→ config `order`) and the unmanaged block (→ `csm.listorg.unmanagedIndex`).

**Files:**
- Create: `renderer/lib/drag-list.js`
- Modify: `renderer/index.html` (script tag after `list-org-model.js`; the panel-list already exists)
- Modify: `renderer/ui.js` (`renderPanelList` to render draggable top-level blocks + a drag-suppress guard; init the engine)
- Modify: `renderer/style.css` (ghost + insertion line + drag affordance)

**Interfaces:**
- Consumes: `window.CSMListOrg` (Task 1), `window.CSMCategories.order()`, `window.api.setConfig`, `window.reloadConfig`, `window.CSM_CONFIG`.
- Produces (on `window.CSMDragList`): `init({ root, onReorder })` where `onReorder({ kind, id, index })` is called on a completed drop (`kind` ∈ `'category' | 'unmanaged' | 'session' | 'group'`; `index` = target position among siblings in the drop container identified by `containerKey`). Also exposes `window._listDragging` (bool) while a drag is active.

- [ ] **Step 1: Create the drag engine**

Create `renderer/lib/drag-list.js` (pointer-event pattern from `board.js:421-558`, generalized; no board coupling):

```javascript
// Pointer-event drag for the List view (WKWebView's HTML5 DnD is unreliable).
// A floating ghost follows the cursor; the drop target is resolved via
// elementFromPoint reading data-* attributes. Draggable elements carry
// [data-drag-kind] + [data-drag-id]; drop containers carry [data-drop-key]
// (+ [data-drop-accept] listing accepted kinds, space-separated). A 5px
// threshold preserves plain clicks. UMD: window.CSMDragList.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMDragList = api
})(typeof self !== 'undefined' ? self : this, function () {
  let insEl = null
  function clearIns() { if (insEl) insEl.style.display = 'none' }
  function showIns(container, items, index) {
    if (!insEl) { insEl = document.createElement('div'); insEl.className = 'dl-ins'; document.body.appendChild(insEl) }
    const br = container.getBoundingClientRect()
    let y
    if (items[index]) y = items[index].getBoundingClientRect().top - 3
    else if (items.length) y = items[items.length - 1].getBoundingClientRect().bottom + 3
    else y = br.top + 4
    insEl.style.left = `${br.left + 4}px`; insEl.style.width = `${br.width - 8}px`
    insEl.style.top = `${Math.round(y)}px`; insEl.style.display = 'block'
  }

  function init(opts) {
    const root = opts.root, onReorder = opts.onReorder
    let drag = null
    root.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      const handle = e.target.closest('[data-drag-kind]')
      if (!handle) return
      // Never start from interactive controls inside a draggable (buttons/inputs/links).
      if (e.target.closest('button, input, a, .path-link, [data-nodrag]')) return
      e.preventDefault()
      drag = { kind: handle.dataset.dragKind, id: handle.dataset.dragId, el: handle, x: e.clientX, y: e.clientY, active: false, ghost: null, drop: null }
    })
    document.addEventListener('mousemove', (e) => {
      if (!drag) return
      if (!drag.active) {
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 5) return
        drag.active = true; window._listDragging = true
        drag.el.classList.add('dl-dragging')
        const r = drag.el.getBoundingClientRect()
        drag.offX = e.clientX - r.left; drag.offY = e.clientY - r.top
        const ghost = drag.el.cloneNode(true); ghost.classList.add('dl-ghost'); ghost.style.width = `${r.width}px`
        drag.ghost = ghost; document.body.appendChild(ghost); document.body.classList.add('dl-drag-active')
      }
      drag.ghost.style.left = `${e.clientX - drag.offX}px`; drag.ghost.style.top = `${e.clientY - drag.offY}px`
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const container = el && el.closest ? el.closest('[data-drop-key]') : null
      drag.drop = null; clearIns()
      if (!container) return
      const accept = (container.dataset.dropAccept || '').split(/\s+/)
      if (!accept.includes(drag.kind)) return           // cross-container / wrong kind → no-op
      const items = [...container.querySelectorAll(':scope > [data-drag-kind]')].filter(c => c !== drag.el && !c.classList.contains('dl-dragging'))
      let index = items.length
      for (let k = 0; k < items.length; k++) { const r = items[k].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { index = k; break } }
      showIns(container, items, index)
      drag.drop = { containerKey: container.dataset.dropKey, index }
    })
    document.addEventListener('mouseup', () => {
      if (!drag) return
      const d = drag; drag = null
      if (d.ghost) d.ghost.remove()
      if (d.el) d.el.classList.remove('dl-dragging')
      document.body.classList.remove('dl-drag-active'); clearIns()
      window._listDragging = false
      if (d.active && d.drop) onReorder({ kind: d.kind, id: d.id, containerKey: d.drop.containerKey, index: d.drop.index })
    })
  }
  return { init }
})
```

- [ ] **Step 2: Render top-level blocks as draggable + add the drag-suppress guard**

In `renderer/ui.js`:

(a) At the top of `renderAll` (line 884), guard against re-rendering mid-drag:
```javascript
function renderAll(sessions, selectedKey, tab = 'running', resort = false) {
  if (window._listDragging) return   // never rebuild the DOM under an active drag
```

(b) In `renderPanelList`, when NOT multi-space (the single-space branch, lines 407-418) and in the running tab, wrap each category group so its header is draggable and the container accepts category drops. Change `renderCategoryGroup` (line 276) header to carry drag + drop attributes:
```javascript
function renderCategoryGroup(category, sessions, selectedKey, changedKeys) {
  const collapsed = collapsedCategories.has(category)
  const active = hasBusy(sessions)
  return `
    <div class="category-group" data-drag-kind="category" data-drag-id="${escapeHtml(category)}">
      <div class="category-header ${active ? 'has-active' : ''}" data-category="${escapeHtml(category)}">
        <span class="category-chevron ${collapsed ? 'collapsed' : ''}">›</span>
        <span class="category-name" data-cat="${escapeHtml(category)}">${escapeHtml(category)}</span>
        <span class="category-count">${sessions.length}</span>
      </div>
      <div class="category-sessions ${collapsed ? 'collapsed' : ''}">
        ${sessions.map(s => renderListCard(s, selectedKey, changedKeys.has(sessionKey(s)))).join('')}
      </div>
    </div>
  `
}
```

(c) Make `renderPanelList` build the single-space category list inside a top-level drop container, and interleave the unmanaged block at its stored index. Replace the single-space branch (lines 407-418) with:
```javascript
  } else {
    const pinned = therest.filter(isPinnedSession).sort((a, b) => rankOf(a) - rankOf(b))
    const rest = therest.filter(s => !isPinnedSession(s))
    if (pinned.length) {
      html += `<div class="space-pinned">${pinned.map(s => renderListCard(s, selectedKey, changedKeys.has(sessionKey(s)))).join('')}</div>`
    }
    const catBlocks = groupByCategory(rest).map(([cat, sess]) => renderCategoryGroup(cat, sess, selectedKey, changedKeys))
    // The unmanaged block is moved out of its fixed slot and interleaved here at its
    // stored index (default = top). The standalone .unmanaged-section container is
    // hidden in the single-space running list (its content is rendered inline here).
    const uIdx = clampUnmanagedIndex(window.CSMListOrg.load().unmanagedIndex, catBlocks.length)
    const blocks = [...catBlocks]
    blocks.splice(uIdx, 0, `<div class="unmanaged-slot" data-drag-kind="unmanaged" data-drag-id="unmanaged"></div>`)
    html += `<div class="list-blocks" data-drop-key="__toplevel__" data-drop-accept="category unmanaged">${blocks.join('')}</div>`
  }
```
Add the helper near the top of ui.js:
```javascript
function clampUnmanagedIndex(i, n) { if (typeof i !== 'number' || i < 0) return 0; return Math.min(i, n) }
```
Note: the existing `renderUnmanagedSection()` (app.js) renders into `.unmanaged-section` containers. Keep it, but in the single-space running list its `.unmanaged-slot` above is where the section is shown; have `renderUnmanagedSection()` also target `.unmanaged-slot` (add `.unmanaged-slot` to its `querySelectorAll('.unmanaged-section, .unmanaged-slot')`), and hide the standalone `.unmanaged-section` above `#panel-list` when a `.unmanaged-slot` is present. (Multi-space + cards keep the standalone container.)

- [ ] **Step 3: Init the engine + handle reorders (category → config, unmanaged → localStorage)**

In `renderer/app.js`, after the config + CSMListOrg are available at boot (near the init block around line 1192), add:
```javascript
window.CSMDragList.init({
  root: document.getElementById('panel-left'),
  onReorder: async ({ kind, id, containerKey, index }) => {
    if (containerKey === '__toplevel__' && (kind === 'category' || kind === 'unmanaged')) {
      // Rebuild the top-level order from the current category order + unmanaged slot.
      const cfg = window.CSM_CONFIG || {}
      const cats = (cfg.order || window.CSMCategories.order()).filter(c => c !== '__unmanaged__')
      // Compose the display order (categories with the unmanaged slot at its index), move the dragged block, split back out.
      const uIdx = clampUnmanagedIndex(window.CSMListOrg.load().unmanagedIndex, cats.length)
      const display = [...cats]; display.splice(uIdx, 0, '__unmanaged__')
      const from = display.indexOf(kind === 'unmanaged' ? '__unmanaged__' : id)
      if (from < 0) return
      display.splice(from, 1)
      display.splice(index, 0, kind === 'unmanaged' ? '__unmanaged__' : id)
      const newU = display.indexOf('__unmanaged__')
      const newCats = display.filter(c => c !== '__unmanaged__')
      window.CSMListOrg.save(window.CSMListOrg.setUnmanagedIndex(window.CSMListOrg.load(), newU))
      if (JSON.stringify(newCats) !== JSON.stringify(cfg.order || [])) {
        const w = await window.api.setConfig({ ...cfg, order: newCats })
        if (w && w.ok && window.reloadConfig) await window.reloadConfig()
      }
      fetchAndRender(false)
    }
  }
})
```

- [ ] **Step 4: CSS**

Append to `renderer/style.css` (theme-aware, `var(--tint)`; reuse the board's ghost/insertion feel):
```css
/* List drag (categories, unmanaged, sessions, groups) */
.dl-ghost { position: fixed; z-index: 3000; pointer-events: none; opacity: 0.9; box-shadow: 0 6px 20px rgba(0,0,0,0.35); border-radius: 8px; }
.dl-dragging { opacity: 0.4; }
.dl-ins { position: fixed; height: 2px; background: rgba(var(--accent, 90 130 255), 0.9); border-radius: 2px; z-index: 3001; pointer-events: none; display: none; }
body.dl-drag-active { cursor: grabbing; user-select: none; }
.category-group[data-drag-kind] .category-header { cursor: grab; }
.unmanaged-slot { display: block; }
```
(If `--accent` isn't defined, use `rgba(var(--tint), 0.7)`.)

- [ ] **Step 5: Verify + commit**

Run: `node --check renderer/lib/drag-list.js` (OK), `node --check renderer/app.js` (OK), `npx jest` (still 76+ green). GUI verification (reorder categories persists across restart; unmanaged drags to bottom) is deferred to the controller.

```bash
git add renderer/lib/drag-list.js renderer/index.html renderer/ui.js renderer/app.js renderer/style.css
git commit -m "feat(list-org): drag-reorder categories + movable unmanaged block (Feature A)"
```

---

### Task 3: Session drag-reorder within a category (Feature B1)

Render session cards from the model's order and let the user drag them within their category. Cross-category drops are no-ops.

**Files:**
- Modify: `renderer/ui.js` (`renderCategoryGroup` to render via `CSMListOrg.orderedItems` + make cards draggable; the `.category-sessions` becomes a drop container)
- Modify: `renderer/app.js` (extend `onReorder` to handle `kind: 'session'`; call `prune` on load)

**Interfaces:**
- Consumes: `CSMListOrg.orderedItems / moveSession / prune`, `CSMDragList` (Task 2), `rankOf`, `sessionKey`.

- [ ] **Step 1: Render sessions via the model order + as draggable, container as a drop target**

In `renderer/ui.js`, change `renderCategoryGroup` so its `.category-sessions` renders the model's ordered items and is a drop container scoped to this category. (Groups are handled in Task 4 — here, only `kind:'session'` items appear.)
```javascript
function renderCategoryGroup(category, sessions, selectedKey, changedKeys) {
  const collapsed = collapsedCategories.has(category)
  const active = hasBusy(sessions)
  const st = window.CSMListOrg.load()
  const byKey = new Map(sessions.map(s => [sessionKey(s), s]))
  const liveKeys = sessions.slice().sort((a, b) => rankOf(a) - rankOf(b)).map(sessionKey)  // activity fallback order
  const items = window.CSMListOrg.orderedItems(st, category, liveKeys)
  const body = items.map(it => {
    if (it.kind === 'session') {
      const s = byKey.get(it.key); if (!s) return ''
      return `<div class="list-drag-item" data-drag-kind="session" data-drag-id="${escapeHtml(it.key)}">${renderListCard(s, selectedKey, changedKeys.has(it.key))}</div>`
    }
    return ''   // 'group' rendered in Task 4
  }).join('')
  return `
    <div class="category-group" data-drag-kind="category" data-drag-id="${escapeHtml(category)}">
      <div class="category-header ${active ? 'has-active' : ''}" data-category="${escapeHtml(category)}">
        <span class="category-chevron ${collapsed ? 'collapsed' : ''}">›</span>
        <span class="category-name" data-cat="${escapeHtml(category)}">${escapeHtml(category)}</span>
        <span class="category-count">${sessions.length}</span>
      </div>
      <div class="category-sessions ${collapsed ? 'collapsed' : ''}" data-drop-key="cat:${escapeHtml(category)}" data-drop-accept="session">
        ${body}
      </div>
    </div>
  `
}
```
Note: cards keep their existing click behavior — the drag wrapper `.list-drag-item` carries `data-drag-kind`; the engine ignores drags starting on buttons/links (`data-nodrag` guard), and the 5px threshold preserves clicks to select a card.

- [ ] **Step 2: Handle the session reorder in `onReorder`**

In `renderer/app.js`, extend the `onReorder` callback body (Task 2) with a branch:
```javascript
    if (kind === 'session' && containerKey.startsWith('cat:')) {
      const category = containerKey.slice(4)
      const st = window.CSMListOrg.load()
      window.CSMListOrg.save(window.CSMListOrg.moveSession(st, category, id, index))
      fetchAndRender(false)
      return
    }
```
Cross-category drop: the engine only reports a drop when the container `data-drop-accept` includes the kind AND the drop lands in a `cat:` container — dragging a session over a different category's `.category-sessions` reports that category, which WOULD move it. To enforce "no cross-category," guard: the drag start records the source category; reject drops whose target `cat:` differs. Add to the session card wrapper `data-src-cat="${escapeHtml(category)}"` and in `onReorder`, compare — simplest: encode source in the id is unnecessary; instead in `drag-list.js` `mousedown`, capture `drag.srcContainer = handle.closest('[data-drop-key]')?.dataset.dropKey` and in `mousemove` reject a target container whose key differs from `srcContainer` when kind==='session'. Implement that guard in `drag-list.js`:
```javascript
      // in mousedown, after computing drag:
      const src = handle.closest('[data-drop-key]')
      drag.srcKey = src ? src.dataset.dropKey : null
```
```javascript
      // in mousemove, after the accept check, before computing items:
      if (drag.kind === 'session' && container.dataset.dropKey !== drag.srcKey) return  // no cross-category move
```

- [ ] **Step 3: Prune dead keys on load**

In `renderer/app.js`, once per successful fetch (in `fetchAndRender` after sessions are fetched, before render), prune the model so vanished sessions drop out of orders/groups:
```javascript
    // Prune list-org of sessions no longer present (moved to Closed/Archived, etc.).
    const liveByCat = {}
    for (const s of sessions) { const c = s.category || (s.entrypoint === 'claude-desktop' ? 'Claude Desktop' : 'OTHER'); (liveByCat[c] = liveByCat[c] || new Set()).add(s.notesPath || s.sessionId || s.name || '') }
    window.CSMListOrg.save(window.CSMListOrg.prune(window.CSMListOrg.load(), liveByCat))
```
(Place this where `sessions` is in scope in `fetchAndRender`, before `renderAll`.)

- [ ] **Step 4: CSS + verify + commit**

Append to `renderer/style.css`:
```css
.list-drag-item { cursor: grab; }
body.dl-drag-active .list-card { pointer-events: none; }
```
Run: `node --check renderer/ui.js`, `node --check renderer/app.js`, `npx jest` (green). GUI verification (reorder sessions within a category; cross-category drop snaps back; order survives a poll) deferred to the controller.

```bash
git add renderer/ui.js renderer/app.js renderer/lib/drag-list.js renderer/style.css
git commit -m "feat(list-org): drag-reorder sessions within a category (Feature B1)"
```

---

### Task 4: Groups within a category (Feature B2)

Render group blocks, a "＋ Group" button per category, and let the user drag sessions in/out, rename, collapse, and delete groups.

**Files:**
- Modify: `renderer/ui.js` (render group blocks in `renderCategoryGroup`; add the ＋Group button)
- Modify: `renderer/app.js` (delegated clicks: ＋Group / rename / collapse / delete; extend `onReorder` for group drops)
- Modify: `renderer/style.css` (group block styling)

**Interfaces:**
- Consumes: `CSMListOrg.createGroup/renameGroup/toggleGroupCollapsed/deleteGroup/addToGroup/removeFromGroup/orderedItems`, `CSMDragList`.

- [ ] **Step 1: Render group blocks + the ＋Group button**

In `renderer/ui.js` `renderCategoryGroup`, add a `groupBlock` renderer and handle the `'group'` item kind, and add a ＋Group button to the header:
```javascript
function groupBlock(category, g, byKey, selectedKey, changedKeys) {
  const gid = escapeHtml(g.id)
  const memberCards = g.members.map(k => {
    const s = byKey.get(k); if (!s) return ''
    return `<div class="list-drag-item" data-drag-kind="session" data-drag-id="${escapeHtml(k)}">${renderListCard(s, selectedKey, changedKeys.has(k))}</div>`
  }).join('')
  return `
    <div class="list-group" data-drag-kind="group" data-drag-id="${gid}">
      <div class="list-group-head" data-group="${gid}" data-cat="${escapeHtml(category)}">
        <span class="list-group-chev ${g.collapsed ? 'collapsed' : ''}" data-group-collapse>›</span>
        <span class="list-group-name" data-group-rename title="Rename group">${escapeHtml(g.name)}</span>
        <span class="list-group-count">${g.members.length}</span>
        <button type="button" class="list-group-x" data-group-delete title="Delete group (keep sessions)" aria-label="Delete group">✕</button>
      </div>
      <div class="list-group-body ${g.collapsed ? 'collapsed' : ''}" data-drop-key="grp:${escapeHtml(category)}:${gid}" data-drop-accept="session">
        ${memberCards || `<div class="list-group-empty">Drop sessions here</div>`}
      </div>
    </div>`
}
```
In the `items.map(...)` in `renderCategoryGroup`, handle groups:
```javascript
    if (it.kind === 'group') return `<div class="list-drag-item" data-drag-kind="group" data-drag-id="${escapeHtml(it.id)}">${groupBlock(category, it, byKey, selectedKey, changedKeys)}</div>`
```
Wait — the group block already carries `data-drag-kind="group"`; do NOT double-wrap. Instead return `groupBlock(...)` directly:
```javascript
    if (it.kind === 'group') return groupBlock(category, it, byKey, selectedKey, changedKeys)
```
Add the ＋Group button in the header, right after `category-count`:
```javascript
        <button type="button" class="cat-add-group" data-add-group="${escapeHtml(category)}" title="New group" aria-label="New group">＋ Group</button>
```

- [ ] **Step 2: Delegated handlers (create / rename / collapse / delete)**

In `renderer/app.js` body-click delegation, add:
```javascript
document.body.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add-group]')
  if (add) {
    const cat = add.dataset.addGroup
    const gid = 'lg-' + Math.random().toString(36).slice(2, 9)
    window.CSMListOrg.save(window.CSMListOrg.createGroup(window.CSMListOrg.load(), cat, gid, 'New group'))
    fetchAndRender(false)
    return
  }
  const chev = e.target.closest('[data-group-collapse]')
  if (chev) {
    const head = chev.closest('.list-group-head')
    window.CSMListOrg.save(window.CSMListOrg.toggleGroupCollapsed(window.CSMListOrg.load(), head.dataset.cat, head.dataset.group))
    fetchAndRender(false)
    return
  }
  const del = e.target.closest('[data-group-delete]')
  if (del) {
    const head = del.closest('.list-group-head')
    window.CSMListOrg.save(window.CSMListOrg.deleteGroup(window.CSMListOrg.load(), head.dataset.cat, head.dataset.group))
    fetchAndRender(false)
    return
  }
})
document.body.addEventListener('dblclick', (e) => {
  const name = e.target.closest('[data-group-rename]')
  if (!name) return
  const head = name.closest('.list-group-head')
  const next = window.prompt('Group name:', name.textContent.trim())
  if (next != null) { window.CSMListOrg.save(window.CSMListOrg.renameGroup(window.CSMListOrg.load(), head.dataset.cat, head.dataset.group, next)); fetchAndRender(false) }
})
```
(Rename via `window.prompt` keeps it minimal and dependency-free; the click-to-collapse uses the chevron only, so clicking the name to rename doesn't also toggle.)

- [ ] **Step 3: Extend `onReorder` for group drops**

In `renderer/app.js` `onReorder`, add branches (before the session branch) so dropping a session into a `grp:` container groups it, and dropping a group block reorders it at top level:
```javascript
    if (kind === 'session' && containerKey.startsWith('grp:')) {
      const [, category, gid] = containerKey.split(':')
      window.CSMListOrg.save(window.CSMListOrg.addToGroup(window.CSMListOrg.load(), category, gid, id, index))
      fetchAndRender(false); return
    }
    if (kind === 'group' && containerKey.startsWith('cat:')) {
      const category = containerKey.slice(4)
      window.CSMListOrg.save(window.CSMListOrg.moveGroupRef(window.CSMListOrg.load(), category, id, index))
      fetchAndRender(false); return
    }
```

**Dragging a session OUT of a group** back to the category body needs no extra code: the target container is `cat:<category>`, so the Task 3 session→`cat:` branch runs `moveSession`, which first removes the key from any group (`moveSession` → `removeFromGroups`).

**Same-category guard.** Task 3's guard rejected drops whose container key differed from the source key. Groups make the key differ (`grp:<cat>:<gid>` vs `cat:<cat>`) within the SAME category, so relax it to compare the category segment. In `drag-list.js` `mousemove`, replace the Task-3 session guard with:
```javascript
      if (drag.kind === 'session') {
        const catOf = (key) => (key || '').startsWith('grp:') ? key.split(':')[1] : (key || '').replace(/^cat:/, '')
        if (catOf(drag.srcKey) !== catOf(container.dataset.dropKey)) return   // same-category only
      }
```

**Add + export `moveGroupRef`** in `renderer/lib/list-org-model.js` — moves a `g:<gid>` ref within the category top-level order (add to the return object alongside `moveSession`):
```javascript
  function moveGroupRef(state, catName, gid, index) {
    const s = clone(state); const c = cat(s, catName); const ref = groupRef(gid)
    if (!c.groups[gid]) return s
    removeFromTop(c, ref)
    const i = (index == null || index < 0 || index > c.order.length) ? c.order.length : index
    c.order.splice(i, 0, ref)
    return s
  }
```

Add a matching jest test in `__tests__/list-org-model.test.js`:
```javascript
it('moveGroupRef repositions the group within the category', () => {
  let s = M.emptyState()
  s = M.moveSession(s, 'FEAT', 'a', 0)
  s = M.createGroup(s, 'FEAT', 'g1', 'X')   // ref appended after 'a'
  s = M.moveGroupRef(s, 'FEAT', 'g1', 0)    // move group to front
  expect(s.categories.FEAT.order[0]).toBe('g:g1')
})
```

- [ ] **Step 4: CSS**

Append to `renderer/style.css` (theme-aware):
```css
.list-group { margin: 4px 6px; border: 1px solid rgba(var(--tint), 0.12); border-radius: 8px; }
.list-group-head { display: flex; align-items: center; gap: 6px; padding: 5px 8px; cursor: grab; }
.list-group-chev { cursor: pointer; transition: transform 0.15s; }
.list-group-chev.collapsed { transform: rotate(-90deg); }
.list-group-name { flex: 1; font-size: 12px; font-weight: 600; color: rgba(var(--tint), 0.85); cursor: text; }
.list-group-count { font-size: 11px; color: rgba(var(--tint), 0.48); }
.list-group-x { background: none; border: none; color: rgba(var(--tint), 0.42); cursor: pointer; font-size: 12px; }
.list-group-x:hover { color: rgba(var(--tint), 0.85); }
.list-group-body.collapsed { display: none; }
.list-group-empty { font-size: 11px; color: rgba(var(--tint), 0.4); padding: 8px; text-align: center; }
```

- [ ] **Step 5: Verify + commit**

Run: `node --check renderer/ui.js`, `node --check renderer/app.js`, `node --check renderer/lib/list-org-model.js`, `npx jest` (green, incl. the new `moveGroupRef` test). GUI verification (create/rename/collapse/delete a group; drag sessions in/out; drag a group to reorder; pins still float) deferred to the controller.

```bash
git add renderer/ui.js renderer/app.js renderer/lib/list-org-model.js __tests__/list-org-model.test.js renderer/style.css
git commit -m "feat(list-org): collapsible session groups within a category (Feature B2)"
```

---

## Self-Review

**Spec coverage:**
- A (reorder categories, persisted) → Task 2 (config `order` via setConfig). ✓
- A (unmanaged movable to bottom) → Task 2 (`unmanagedIndex` in localStorage, interleaved). ✓
- B1 (drag-reorder sessions within category) → Task 3. ✓
- B2 (collapsible groups, drag in/out, rename/collapse/delete, ＋Group button) → Task 4. ✓
- No cross-category (snap back) → Task 3 Step 2 + Task 4 Step 3 guard (same-category only). ✓
- Pins float unchanged → Tasks 3/4 render pinned region before the model-ordered blocks. ✓
- List view only → all edits in `renderPanelList`/`renderCategoryGroup`; Cards/Board untouched. ✓
- No `~/.claude` writes → only config + localStorage. ✓
- Groups persist (no auto-dissolve) → model has no size-based cleanup; `prune` keeps groups. ✓
- Testing (model jest; drag manual) → Task 1 + Task 4 tests; GUI deferred. ✓

**Placeholder scan:** No TBD/TODO. Task 4 Step 3 contains a deliberately-corrected sketch (the `gidFromId` scratch lines are explicitly replaced by the final `moveGroupRef` branch in the same step) — the implementer uses the final version. All code blocks are complete.

**Type consistency:** State shape `{unmanagedIndex, categories:{[cat]:{order,groups:{[gid]:{name,collapsed,members}}}}}` consistent across Task 1 model, its tests, and Tasks 3/4 consumers. `orderedItems` returns `{kind:'session',key}` / `{kind:'group',id,name,collapsed,members}` — matched in `renderCategoryGroup`/`groupBlock`. Drop keys: `__toplevel__` (Task 2), `cat:<category>` (Task 3), `grp:<category>:<gid>` (Task 4) — parsed consistently in `onReorder`. `data-drag-kind` values `category|unmanaged|session|group` match engine + wiring. `moveGroupRef` defined + exported in Task 4 Step 3, used there.
