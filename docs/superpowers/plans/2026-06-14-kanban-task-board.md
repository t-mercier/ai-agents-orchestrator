# Kanban Task Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A global, personal Kanban board (3rd view mode) that organises sessions + standalone notes into user-defined stages, stored in localStorage.

**Architecture:** A pure, unit-tested model module (`renderer/lib/board-model.js`, UMD) owns all kanban state + mutations over a localStorage-backed object. A browser-only renderer (`renderer/board.js`) draws columns/cards, wires drag-and-drop, inline column rename, add-column, and note CRUD, resolving placed sessions against a combined (running + closed + archived) index. The board is a new `viewMode === 'board'` that hides the tabbed UI. A Settings → Kanban sub-section edits columns.

**Tech Stack:** Vanilla JS (classic `<script>` + UMD libs), Jest (node), HTML5 drag-and-drop, localStorage, existing `style.css` design tokens (`--tint`, `--accent`, `--card-bg`).

**Repo note:** This is a PERSO repo — any commit MUST use the personal GitHub identity (local git config), never the work account. Commit steps below assume that's set; commit only if you want commits.

**Spec:** `docs/superpowers/specs/2026-06-14-kanban-task-board-design.md`

---

### Task 1: Board model (pure, unit-tested)

**Files:**
- Create: `renderer/lib/board-model.js`
- Test: `__tests__/board-model.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// __tests__/board-model.test.js
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
  expect(s.columns[0].name).toBe('TODO!')   // blank ignored
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
  s = B.moveColumn(s, firstNow, -1)          // out of bounds → no-op
  expect(s.columns[0].id).toBe(firstNow)
})

test('placeSession / unplaceSession', () => {
  let s = B.emptyState(); const col = s.columns[2].id
  s = B.placeSession(s, 'k1', col)
  expect(s.placements['k1']).toBe(col)
  s = B.placeSession(s, 'k1', 'does-not-exist')  // unknown column ignored
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
  s.placements['orphan'] = 'ghost-col'        // column does not exist
  const g = B.itemsByColumn(s)
  expect(g[a].sessions).toContain('k')
  expect(g[a].notes).toHaveLength(1)
  expect(Object.values(g).some(c => c.sessions.includes('orphan'))).toBe(false)
})

test('normalize repairs garbage into a valid state', () => {
  expect(B.normalize(null).columns.length).toBeGreaterThan(0)
  expect(B.normalize({ columns: [] }).columns.length).toBeGreaterThan(0)  // empty → defaults
  const s = B.normalize({ columns: [{ id: 'x', name: 'X' }], placements: 'bad', notes: [{ nope: 1 }] })
  expect(s.columns).toEqual([{ id: 'x', name: 'X' }])
  expect(s.placements).toEqual({})
  expect(s.notes).toEqual([])
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- board-model`
Expected: FAIL — `Cannot find module '../renderer/lib/board-model'`.

- [ ] **Step 3: Implement the model**

```js
// renderer/lib/board-model.js
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

  function emptyState() {
    return { columns: DEFAULT_COLUMNS.map(c => ({ ...c })), placements: {}, notes: [] }
  }

  function normalize(obj) {
    const s = (obj && typeof obj === 'object') ? obj : {}
    let columns = Array.isArray(s.columns)
      ? s.columns.filter(c => c && c.id && typeof c.name === 'string').map(c => ({ id: c.id, name: c.name }))
      : []
    if (columns.length === 0) columns = DEFAULT_COLUMNS.map(c => ({ ...c }))
    const placements = (s.placements && typeof s.placements === 'object' && !Array.isArray(s.placements)) ? { ...s.placements } : {}
    const notes = Array.isArray(s.notes)
      ? s.notes.filter(n => n && n.id && n.columnId).map(n => ({ id: n.id, text: String(n.text || ''), columnId: n.columnId }))
      : []
    return { columns, placements, notes }
  }

  function clone(state) {
    return { columns: state.columns.map(c => ({ ...c })), placements: { ...state.placements }, notes: state.notes.map(n => ({ ...n })) }
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
    return s
  }
  function moveColumn(state, columnId, dir) {
    const s = clone(state)
    const i = s.columns.findIndex(c => c.id === columnId)
    const j = i + dir
    if (i >= 0 && j >= 0 && j < s.columns.length) { const t = s.columns[i]; s.columns[i] = s.columns[j]; s.columns[j] = t }
    return s
  }
  function placeSession(state, sessionKey, columnId) {
    const s = clone(state)
    if (sessionKey && hasColumn(s, columnId)) s.placements[sessionKey] = columnId
    return s
  }
  function unplaceSession(state, sessionKey) {
    const s = clone(state); delete s.placements[sessionKey]; return s
  }
  function addNote(state, columnId, text) {
    const s = clone(state)
    const col = hasColumn(s, columnId) ? columnId : firstColumnId(s)
    if (col) s.notes.push({ id: genId('note'), text: String(text || '').trim(), columnId: col })
    return s
  }
  function updateNote(state, noteId, text) {
    const s = clone(state)
    const n = s.notes.find(x => x.id === noteId)
    if (n) n.text = String(text || '').trim()
    return s
  }
  function removeNote(state, noteId) {
    const s = clone(state); s.notes = s.notes.filter(n => n.id !== noteId); return s
  }
  function moveItem(state, kind, id, columnId) {
    if (!hasColumn(state, columnId)) return clone(state)
    if (kind === 'note') {
      const s = clone(state)
      const n = s.notes.find(x => x.id === id); if (n) n.columnId = columnId
      return s
    }
    return placeSession(state, id, columnId)
  }
  function itemsByColumn(state) {
    const out = {}
    for (const c of state.columns) out[c.id] = { sessions: [], notes: [] }
    for (const [key, col] of Object.entries(state.placements)) if (out[col]) out[col].sessions.push(key)
    for (const n of state.notes) if (out[n.columnId]) out[n.columnId].notes.push(n)
    return out
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
    addColumn, renameColumn, removeColumn, moveColumn,
    placeSession, unplaceSession, addNote, updateNote, removeNote, moveItem,
    itemsByColumn, load, save,
  }
})
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npm test -- board-model`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit** (perso identity)

```bash
git add renderer/lib/board-model.js __tests__/board-model.test.js
git commit -m "feat(kanban): board model + tests"
```

---

### Task 2: Board view mode (toggle + container + visibility)

**Files:**
- Modify: `renderer/index.html` (view-toggle button + `<script>` + `#board-view` container)
- Modify: `renderer/app.js` (`viewMode` doc comment + `setViewMode`)
- Modify: `renderer/style.css` (mode-board visibility)

- [ ] **Step 1: Add the Board button + board container + script in `index.html`**

In the `.view-toggle` (currently List/Cards), add a third button:

```html
<button class="view-btn" data-view="board" title="Board view">▥ Board</button>
```

Add the board container as a sibling of `.cards-view` inside `.layout` (after the `#cards-view` div, before `.panel-detail`):

```html
    <!-- ── Board view: full-width kanban (global, all states) ── -->
    <div class="board-view" id="board-view"></div>
```

Add the script after `app.js` (before `settings.js`):

```html
  <script src="lib/board-model.js"></script>
  <script src="board.js"></script>
```

Note: `lib/board-model.js` must load before `board.js` and before `app.js` uses it — put `lib/board-model.js` next to the other `lib/*` scripts (with `categories.js` etc.) and `board.js` after `app.js`.

- [ ] **Step 2: Handle board mode in `setViewMode` (`renderer/app.js`)**

Replace the existing `setViewMode` (around line 173):

```js
function setViewMode(mode) {
  viewMode = mode
  document.body.classList.toggle('mode-cards', mode === 'cards')
  document.body.classList.toggle('mode-list', mode === 'list')
  document.body.classList.toggle('mode-board', mode === 'board')
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === mode)
  })
  if (mode === 'cards') selectedKey = null
  if (mode === 'board') {
    if (window.getTerminalVisible && window.getTerminalVisible()) window.hideTerminalPane()
    if (window.renderBoard) window.renderBoard()    // defined in board.js
    return
  }
  renderAll(filterSessions(sessions, searchQuery), selectedKey, activeTab, false)
}
```

Update the `let viewMode` comment (line 4) to `// 'list' | 'cards' | 'board'`.

- [ ] **Step 3: Add mode-board visibility CSS (`renderer/style.css`)**

Append near the `.view-toggle` block:

```css
/* Board mode: hide the tabbed list/cards UI; show the full-width board. */
.board-view { display: none; }
body.mode-board .panel-left,
body.mode-board .resize-handle,
body.mode-board .cards-view,
body.mode-board .panel-detail,
body.mode-board .scrim { display: none !important; }
body.mode-board .board-view { display: block; flex: 1; overflow: auto; }
```

- [ ] **Step 4: Verify (manual — `cargo tauri dev`)**

Reload. Click **▥ Board** in the toggle: the sidebar/cards/detail disappear, an empty full-width area shows, the Board button is active. Click List/Cards: the normal UI returns. (Board content lands in Task 3.)

- [ ] **Step 5: Commit** (perso identity)

```bash
git add renderer/index.html renderer/app.js renderer/style.css
git commit -m "feat(kanban): board view mode toggle + container"
```

---

### Task 3: Board rendering (columns + cards from the model)

**Files:**
- Create: `renderer/board.js`
- Modify: `renderer/style.css` (board layout + cards)
- Modify: `renderer/app.js` (combined session index for the board)

- [ ] **Step 1: Combined session index in `app.js`**

The board needs session data across all states. Add after `fetchAndRender` (these expose live data + a re-render hook):

```js
// Board needs sessions across ALL states (it's global). Cache the last lists so
// board cards resolve live data by sessionKey without per-card fetches.
window._boardIndex = {}   // sessionKey -> session object
async function buildBoardIndex() {
  try {
    const [running, closed, archived] = await Promise.all([
      window.api.getSessions(),
      window.api.getHistoricalSessions('closed'),
      window.api.getHistoricalSessions('archived'),
    ])
    const idx = {}
    for (const s of [...running, ...closed, ...archived]) idx[sessionKey(s)] = s
    window._boardIndex = idx
  } catch (err) { console.error('board index fetch failed:', err) }
}
window.refreshBoard = async () => {
  await buildBoardIndex()
  if (viewMode === 'board' && window.renderBoard) window.renderBoard()
}
```

Wire the poll: in `boot()`'s `setInterval`, also refresh the board when in board mode. Replace the poll line:

```js
  setInterval(() => {
    if (viewMode === 'board') { window.refreshBoard() }
    else if (!fetchInFlight) fetchAndRender(false)
  }, POLL_INTERVAL)
```

And in `setViewMode`, make the board branch build the index first:

```js
  if (mode === 'board') {
    if (window.getTerminalVisible && window.getTerminalVisible()) window.hideTerminalPane()
    if (window.refreshBoard) window.refreshBoard()   // builds index then renders
    return
  }
```

(Remove the direct `window.renderBoard()` call from Task 2's board branch — `refreshBoard` renders.)

- [ ] **Step 2: Create `renderer/board.js` (render columns + cards)**

```js
/* global CSMBoard */
// Kanban board renderer. Reads CSMBoard state + window._boardIndex (sessionKey ->
// live session). Browser-only (like ui.js); model logic lives in lib/board-model.js.
const { escapeHtml } = window.CSMFormatters

let boardState = null   // current CSMBoard state; mutated via applyBoard()

// Persist + re-render after any mutation.
function applyBoard(next) {
  boardState = next
  CSMBoard.save(boardState)
  renderBoard()
}

function sessionCardHtml(key) {
  const s = (window._boardIndex || {})[key]
  if (!s) {
    return `<div class="kb-card kb-missing" draggable="true" data-kind="session" data-id="${escapeHtml(key)}">
      <span class="kb-name">session unavailable</span>
      <button class="kb-x" data-board-remove-session="${escapeHtml(key)}" title="Remove from board">✕</button></div>`
  }
  const cat = s.category ? `<span class="kb-cat">${escapeHtml(s.category)}</span>` : ''
  return `<div class="kb-card ${s.status || 'historical'}" draggable="true" data-kind="session" data-id="${escapeHtml(key)}">
    <span class="kb-dot ${escapeHtml(s.status || 'historical')}"></span>
    <span class="kb-name" title="${escapeHtml(s.name || '')}">${escapeHtml(s.name || 'unnamed')}</span>
    ${cat}
    <button class="kb-x" data-board-remove-session="${escapeHtml(key)}" title="Remove from board">✕</button></div>`
}

function noteCardHtml(note) {
  return `<div class="kb-card kb-note" draggable="true" data-kind="note" data-id="${escapeHtml(note.id)}">
    <span class="kb-note-tag">note</span>
    <span class="kb-name kb-note-text" data-note-edit="${escapeHtml(note.id)}">${escapeHtml(note.text) || '<em>empty</em>'}</span>
    <button class="kb-x" data-board-remove-note="${escapeHtml(note.id)}" title="Delete note">✕</button></div>`
}

function columnHtml(col, groups) {
  const g = groups[col.id] || { sessions: [], notes: [] }
  const count = g.sessions.length + g.notes.length
  const cards = [...g.sessions.map(sessionCardHtml), ...g.notes.map(noteCardHtml)].join('')
  return `<div class="kb-col" data-col="${escapeHtml(col.id)}">
    <div class="kb-col-head">
      <span class="kb-col-name" data-col-rename="${escapeHtml(col.id)}" title="Click to rename">${escapeHtml(col.name)}</span>
      <span class="kb-col-n">${count}</span>
    </div>
    <div class="kb-col-body" data-col-drop="${escapeHtml(col.id)}">${cards}
      <button class="kb-add-note" data-add-note="${escapeHtml(col.id)}">＋ add note</button>
    </div>
  </div>`
}

function renderBoard() {
  const host = document.getElementById('board-view')
  if (!host) return
  boardState = CSMBoard.load()
  const groups = CSMBoard.itemsByColumn(boardState)
  const cols = boardState.columns.map(c => columnHtml(c, groups)).join('')
  host.innerHTML = `<div class="kb-board">${cols}<button class="kb-add-col" id="kb-add-col" title="Add a column">＋</button></div>`
}

window.renderBoard = renderBoard
window.applyBoard = applyBoard
```

- [ ] **Step 3: Board layout CSS (`renderer/style.css`)**

Append:

```css
/* ── Kanban board ── */
.kb-board { display: flex; gap: 12px; padding: 16px; align-items: flex-start; min-height: 100%; }
.kb-col { width: 230px; flex-shrink: 0; }
.kb-col-head { display: flex; align-items: center; justify-content: space-between; padding: 0 4px 8px; }
.kb-col-name { font-size: 11px; font-weight: 700; letter-spacing: .04em; color: var(--text-secondary); cursor: text; padding: 2px 4px; border-radius: 5px; }
.kb-col-name:hover { background: rgba(var(--tint), 0.08); color: var(--text-primary); }
.kb-col-n { font-size: 11px; font-weight: 600; color: var(--text-tertiary); }
.kb-col-body { display: flex; flex-direction: column; gap: 8px; min-height: 60px; border-radius: 10px; padding: 4px; }
.kb-col-body.kb-over { background: rgba(var(--accent-rgb), 0.08); outline: 1px dashed rgba(var(--accent-rgb), 0.5); }
.kb-card { display: flex; align-items: center; gap: 7px; background: var(--card-bg); border: 0.5px solid var(--card-border); border-radius: 9px; padding: 8px 10px; cursor: grab; }
.kb-card:active { cursor: grabbing; }
.kb-card.dragging { opacity: 0.4; }
.kb-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--text-tertiary); }
.kb-dot.busy { background: var(--status-busy); } .kb-dot.waiting { background: var(--status-waiting); }
.kb-dot.idle { background: var(--status-idle); } .kb-dot.shell { background: var(--status-shell); }
.kb-name { flex: 1; font-size: 12px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kb-cat { font-size: 10px; color: var(--text-tertiary); flex-shrink: 0; }
.kb-card.kb-missing .kb-name { color: var(--text-tertiary); font-style: italic; }
.kb-note { background: rgba(var(--tint), 0.04); border-style: dashed; }
.kb-note .kb-name { color: var(--text-secondary); font-weight: 500; white-space: normal; }
.kb-note-tag { font-size: 9px; color: var(--text-tertiary); border: 0.5px solid var(--card-border); border-radius: 4px; padding: 0 4px; flex-shrink: 0; }
.kb-x { background: none; border: none; color: var(--text-tertiary); cursor: pointer; font-size: 11px; opacity: 0; flex-shrink: 0; }
.kb-card:hover .kb-x { opacity: 0.7; }
.kb-x:hover { color: var(--text-primary); }
.kb-add-note { background: none; border: none; color: var(--text-tertiary); font-size: 11px; text-align: left; padding: 4px; cursor: pointer; font-family: var(--font); }
.kb-add-note:hover { color: var(--text-primary); }
.kb-add-col { width: 30px; align-self: flex-start; margin-top: 22px; background: rgba(var(--tint), 0.05); border: 0.5px solid var(--card-border); border-radius: 9px; color: var(--text-tertiary); cursor: pointer; padding: 8px 0; opacity: 0; transition: opacity 0.12s; }
.kb-board:hover .kb-add-col { opacity: 1; }
.kb-add-col:hover { color: var(--text-primary); border-color: var(--accent); }
.kb-col-name-input { font-family: var(--font); font-size: 11px; font-weight: 700; color: var(--text-primary); background: rgba(var(--tint), 0.1); border: 0.5px solid var(--accent); border-radius: 5px; padding: 2px 4px; width: 150px; outline: none; }
```

- [ ] **Step 4: Verify (manual — `cargo tauri dev`)**

Reload, switch to Board. You see the 6 default columns with counts (all 0, empty bodies + "＋ add note"), and a faint **＋** add-column button at the right that appears on hover. No cards yet (none placed). Switch tabs/views still works.

- [ ] **Step 5: Commit** (perso identity)

```bash
git add renderer/board.js renderer/app.js renderer/style.css renderer/index.html
git commit -m "feat(kanban): render columns + cards"
```

---

### Task 4: Standalone notes (add / edit / delete)

**Files:**
- Modify: `renderer/board.js` (delegated handlers for notes)

- [ ] **Step 1: Add a delegated click/handler block in `board.js`**

Append (one listener on the board host, installed once):

```js
let boardHandlersInstalled = false
function installBoardHandlers() {
  if (boardHandlersInstalled) return
  boardHandlersInstalled = true
  const host = document.getElementById('board-view')
  if (!host) return

  host.addEventListener('click', (e) => {
    const addNote = e.target.closest('[data-add-note]')
    if (addNote) {
      const col = addNote.dataset.addNote
      applyBoard(CSMBoard.addNote(CSMBoard.load(), col, ''))
      // focus the new (last) note in that column for immediate typing
      const body = host.querySelector(`[data-col-drop="${CSS.escape(col)}"]`)
      const notes = body ? body.querySelectorAll('[data-note-edit]') : []
      if (notes.length) startNoteEdit(notes[notes.length - 1])
      return
    }
    const rmNote = e.target.closest('[data-board-remove-note]')
    if (rmNote) { applyBoard(CSMBoard.removeNote(CSMBoard.load(), rmNote.dataset.boardRemoveNote)); return }
    const editNote = e.target.closest('[data-note-edit]')
    if (editNote) { startNoteEdit(editNote); return }
    const rmSession = e.target.closest('[data-board-remove-session]')
    if (rmSession) { applyBoard(CSMBoard.unplaceSession(CSMBoard.load(), rmSession.dataset.boardRemoveSession)); return }
  })
}

// Inline note editing: swap the text span for an input, save on blur/Enter.
function startNoteEdit(span) {
  const id = span.dataset.noteEdit
  const current = (CSMBoard.load().notes.find(n => n.id === id) || {}).text || ''
  const input = document.createElement('input')
  input.className = 'kb-note-input'
  input.value = current
  span.replaceWith(input)
  input.focus()
  const commit = () => applyBoard(CSMBoard.updateNote(CSMBoard.load(), id, input.value))
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur() } if (e.key === 'Escape') renderBoard() })
  input.addEventListener('blur', commit, { once: true })
}
```

Call `installBoardHandlers()` at the end of `renderBoard()` (it self-guards):

```js
function renderBoard() {
  const host = document.getElementById('board-view')
  if (!host) return
  boardState = CSMBoard.load()
  const groups = CSMBoard.itemsByColumn(boardState)
  const cols = boardState.columns.map(c => columnHtml(c, groups)).join('')
  host.innerHTML = `<div class="kb-board">${cols}<button class="kb-add-col" id="kb-add-col" title="Add a column">＋</button></div>`
  installBoardHandlers()
}
```

Add CSS for the note input (append to `style.css`):

```css
.kb-note-input { flex: 1; font-family: var(--font); font-size: 12px; color: var(--text-primary); background: rgba(var(--tint), 0.1); border: 0.5px solid var(--accent); border-radius: 6px; padding: 4px 6px; outline: none; }
```

- [ ] **Step 2: Verify (manual — `cargo tauri dev`)**

Board → click "＋ add note" in a column → an empty note appears with a focused input → type "remember X", press Enter → it saves as a note card. Click the note text → edit → blur saves. Click ✕ → note removed. Reload the app → notes persist (localStorage).

- [ ] **Step 3: Commit** (perso identity)

```bash
git add renderer/board.js renderer/style.css
git commit -m "feat(kanban): standalone notes CRUD"
```

---

### Task 5: Place / unplace sessions on the board

**Files:**
- Modify: `renderer/ui.js` (a "put on board" action in the detail panel actions)
- Modify: `renderer/board.js` (already handles remove-from-board via `data-board-remove-session` from Task 4)

- [ ] **Step 1: Add a board action builder in `ui.js`**

Near the other action builders (e.g. after `notesPill`), add:

```js
// Put a session on the kanban board (assigns it to the first column). Toggles off
// (removes from board) if already placed. Lives in the detail Actions toolbar.
function boardPill(s) {
  const key = sessionKey(s)
  if (!key) return ''
  const placed = !!(window.CSMBoard && (CSMBoard.load().placements[key]))
  return `<button class="act ${placed ? 'act-primary' : ''}" data-board-toggle="${escapeHtml(key)}"
           aria-label="${placed ? 'On the board' : 'Add to board'}" data-tip="${placed ? 'On the board — click to remove' : 'Add to board'}">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" x2="9" y1="3" y2="21"/><line x1="15" x2="15" y1="3" y2="21"/></svg></button>`
}
```

Add `boardPill(s)` into the actions array in `renderDetailPanel` (after `notesPill(s.notesPath)`):

```js
  const actions = [
    embeddedTerminalAction(s),
    itermPill(s),
    isHistorical ? restartPill(s) : '',
    ticketPill(s.ticket),
    !isHistorical ? prPill(s.prLink) : '',
    notesPill(s.notesPath),
    boardPill(s),
  ].filter(Boolean).join('')
```

- [ ] **Step 2: Handle the toggle in the delegated handler (`ui.js` `installDelegatedHandlers`)**

Add before the card-select handler:

```js
    const boardToggle = e.target.closest('[data-board-toggle]')
    if (boardToggle && window.CSMBoard) {
      const key = boardToggle.dataset.boardToggle
      const st = CSMBoard.load()
      const next = st.placements[key]
        ? CSMBoard.unplaceSession(st, key)
        : CSMBoard.placeSession(st, key, (st.columns[0] || {}).id)
      CSMBoard.save(next)
      if (window.renderDetailPanel && window._lastSessions) {
        const sel = window._lastSessions.find(x => sessionKey(x) === window._lastSelectedKey)
        if (sel) renderDetailPanel(sel, activeTab)   // refresh the pill state
      }
      return
    }
```

Note: `activeTab` is a top-level `let` in app.js, readable here at click time. If lint complains, read it via `window._lastTab` — but it is in scope for classic scripts. Keep `activeTab`.

- [ ] **Step 3: Verify (manual — `cargo tauri dev`)**

Select a session (List or Cards) → in the Actions toolbar the new **board** icon appears. Click it → it turns accent (placed). Switch to Board → the session card is in the first column ("To do"). Back in detail, click the board icon again → removed from board (icon de-accents, card gone from Board). On the Board, click a session card's ✕ → removed.

- [ ] **Step 4: Commit** (perso identity)

```bash
git add renderer/ui.js
git commit -m "feat(kanban): place/unplace sessions from the detail panel"
```

---

### Task 6: Drag-and-drop between columns

**Files:**
- Modify: `renderer/board.js` (DnD handlers)

- [ ] **Step 1: Add DnD wiring in `installBoardHandlers` (`board.js`)**

Inside `installBoardHandlers`, after the click listener, add:

```js
  let dragData = null   // { kind, id }

  host.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.kb-card')
    if (!card) return
    dragData = { kind: card.dataset.kind, id: card.dataset.id }
    card.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
  })
  host.addEventListener('dragend', (e) => {
    const card = e.target.closest('.kb-card'); if (card) card.classList.remove('dragging')
    host.querySelectorAll('.kb-over').forEach(el => el.classList.remove('kb-over'))
  })
  host.addEventListener('dragover', (e) => {
    const body = e.target.closest('[data-col-drop]'); if (!body) return
    e.preventDefault()                         // allow drop
    e.dataTransfer.dropEffect = 'move'
    host.querySelectorAll('.kb-over').forEach(el => el.classList.remove('kb-over'))
    body.classList.add('kb-over')
  })
  host.addEventListener('drop', (e) => {
    const body = e.target.closest('[data-col-drop]'); if (!body || !dragData) return
    e.preventDefault()
    const col = body.dataset.colDrop
    applyBoard(CSMBoard.moveItem(CSMBoard.load(), dragData.kind, dragData.id, col))
    dragData = null
  })
```

- [ ] **Step 2: Verify (manual — `cargo tauri dev`)**

Board → drag a session card or note from one column to another → on hover the target column highlights (dashed accent), on drop the card moves and the column counts update. Reload → the new column sticks (localStorage). Dragging onto the same column is a no-op.

- [ ] **Step 3: Commit** (perso identity)

```bash
git add renderer/board.js
git commit -m "feat(kanban): drag-and-drop cards between columns"
```

---

### Task 7: Inline column rename + add column

**Files:**
- Modify: `renderer/board.js` (column rename + add-column handlers)

- [ ] **Step 1: Add column-rename + add-column handling to the click listener (`board.js`)**

Inside the `host.addEventListener('click', ...)` from Task 4, add (before the note handlers):

```js
    const addCol = e.target.closest('#kb-add-col')
    if (addCol) {
      const next = CSMBoard.addColumn(CSMBoard.load(), 'New column')
      applyBoard(next)
      const cols = host.querySelectorAll('[data-col-rename]')
      if (cols.length) startColumnRename(cols[cols.length - 1])   // edit the new column's title
      return
    }
    const renameCol = e.target.closest('[data-col-rename]')
    if (renameCol) { startColumnRename(renameCol); return }
```

Add the helper (next to `startNoteEdit`):

```js
function startColumnRename(span) {
  const id = span.dataset.colRename
  const current = (CSMBoard.load().columns.find(c => c.id === id) || {}).name || ''
  const input = document.createElement('input')
  input.className = 'kb-col-name-input'
  input.value = current
  span.replaceWith(input)
  input.focus(); input.select()
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur() } if (e.key === 'Escape') renderBoard() })
  input.addEventListener('blur', () => applyBoard(CSMBoard.renameColumn(CSMBoard.load(), id, input.value)), { once: true })
}
```

- [ ] **Step 2: Verify (manual — `cargo tauri dev`)**

Board → click a column title → it becomes an input → type a new name, Enter → renamed (persists on reload). Hover the right edge → **＋** appears → click → a "New column" is added with its title already in edit mode → name it. Esc while editing cancels.

- [ ] **Step 3: Commit** (perso identity)

```bash
git add renderer/board.js
git commit -m "feat(kanban): inline column rename + add column"
```

---

### Task 8: Settings → Kanban sub-section (manage columns)

**Files:**
- Modify: `renderer/index.html` (Kanban sub-section in the Settings modal)
- Modify: `renderer/settings.js` (render + wire the columns editor)
- Modify: `renderer/style.css` (column-row styling)

- [ ] **Step 1: Add the Kanban sub-section markup in the Settings modal (`index.html`)**

After the Appearance `.settings-section` (before the Categories section), add:

```html
        <!-- Kanban columns — apply live (localStorage), independent of Save. -->
        <div class="settings-section">
          <div class="settings-section-head">
            <span>Kanban columns</span>
            <button type="button" class="modal-btn" id="set-add-col">＋ Add</button>
          </div>
          <div id="set-col-list" class="settings-col-list"></div>
        </div>
```

- [ ] **Step 2: Render + wire the columns editor in `settings.js`**

Add a render function and call it in `populate()`. Inside the settings IIFE:

```js
  const colList = document.getElementById('set-col-list')

  function renderColRows() {
    const st = window.CSMBoard ? CSMBoard.load() : { columns: [] }
    colList.innerHTML = st.columns.map((c, i) => `
      <div class="settings-col-row" data-col-id="${c.id}">
        <input class="col-name" type="text" value="${(c.name || '').replace(/"/g, '&quot;')}" maxlength="40" spellcheck="false">
        <button type="button" class="icon-btn col-up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="icon-btn col-down" title="Move down" ${i === st.columns.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="icon-btn col-del" title="Remove (cards move to the first column)">✕</button>
      </div>`).join('')
  }

  function refreshBoardIfOpen() {
    if (window.viewMode === 'board' && window.renderBoard) window.renderBoard()
  }

  colList.addEventListener('click', (e) => {
    const row = e.target.closest('.settings-col-row'); if (!row) return
    const id = row.dataset.colId
    if (e.target.closest('.col-del')) { CSMBoard.save(CSMBoard.removeColumn(CSMBoard.load(), id)); renderColRows(); refreshBoardIfOpen() }
    else if (e.target.closest('.col-up')) { CSMBoard.save(CSMBoard.moveColumn(CSMBoard.load(), id, -1)); renderColRows(); refreshBoardIfOpen() }
    else if (e.target.closest('.col-down')) { CSMBoard.save(CSMBoard.moveColumn(CSMBoard.load(), id, 1)); renderColRows(); refreshBoardIfOpen() }
  })
  colList.addEventListener('change', (e) => {
    const name = e.target.closest('.col-name'); if (!name) return
    const id = name.closest('.settings-col-row').dataset.colId
    CSMBoard.save(CSMBoard.renameColumn(CSMBoard.load(), id, name.value)); refreshBoardIfOpen()
  })
  document.getElementById('set-add-col').addEventListener('click', () => {
    CSMBoard.save(CSMBoard.addColumn(CSMBoard.load(), 'New column')); renderColRows(); refreshBoardIfOpen()
  })
```

In `populate()`, add a call: `renderColRows()`.

Note: `window.viewMode` — expose it from app.js by adding `window.viewMode` assignment in `setViewMode` (`window.viewMode = mode`). Add that line to `setViewMode`.

- [ ] **Step 3: Column-row CSS (`style.css`)**

Append:

```css
.settings-col-list { display: flex; flex-direction: column; gap: 6px; }
.settings-col-row { display: flex; gap: 6px; align-items: center; }
.settings-col-row .col-name { flex: 1; min-width: 0; font-family: var(--font); font-size: 13px; color: var(--text-primary); background: rgba(var(--tint), 0.07); border: 0.5px solid var(--card-border); border-radius: 7px; padding: 7px 10px; outline: none; }
.settings-col-row .col-name:focus { border-color: var(--accent); }
.settings-col-row .icon-btn[disabled] { opacity: 0.3; cursor: default; }
```

- [ ] **Step 4: Verify (manual — `cargo tauri dev`)**

Settings → "Kanban columns" lists the columns with rename inputs + ↑/↓/✕. Rename one (blur) → reflected on the Board. Reorder with ↑/↓ → Board column order changes. ✕ a column that has cards → its cards appear in the first column. ＋ Add → a "New column" appears. All persist on reload.

- [ ] **Step 5: Commit** (perso identity)

```bash
git add renderer/index.html renderer/settings.js renderer/style.css renderer/app.js
git commit -m "feat(kanban): settings sub-section to manage columns"
```

---

## Final verification (manual)

Run `cargo tauri dev`, then:
- [ ] Toggle List · Cards · **Board**; board hides the tabbed UI and is global.
- [ ] Default columns present; rename/add/reorder/delete (Settings + inline) all persist.
- [ ] Place a session from the detail panel; it appears in the board; remove it (icon + card ✕).
- [ ] Add/edit/delete standalone notes.
- [ ] Drag sessions + notes between columns.
- [ ] Delete a column with cards → cards land in the first column.
- [ ] Reload the app → everything persists (localStorage).
- [ ] `npm test` → board-model tests green.
