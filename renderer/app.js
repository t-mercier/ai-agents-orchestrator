let sessions = []
let selectedKey = null   // unique session key (notesPath || sessionId || name), not raw sessionId
let activeTab = 'running'
let viewMode = 'list'    // 'list' | 'cards' | 'board'
let searchQuery = ''
const activeCatFilters = new Set()  // empty = show all categories
// Category order (config-driven, with fallback) is shared via renderer/lib/categories.js.
const filterCategories = () => window.CSMCategories.order()
const POLL_INTERVAL = 5000

// Pinned sessions float to the top. Capped (a grid screenful) and persisted
// locally — these are app prefs, not session state, so no ~/.claude writes.
const PIN_LIMIT = 8
let pinnedKeys = new Set()
try { pinnedKeys = new Set(JSON.parse(localStorage.getItem('csm.pinnedKeys') || '[]')) } catch { /* ignore */ }

function isPinned(key) { return pinnedKeys.has(key) }
function togglePin(key) {
  if (pinnedKeys.has(key)) {
    pinnedKeys.delete(key)
  } else {
    if (pinnedKeys.size >= PIN_LIMIT) {
      const el = document.getElementById('cat-filter-list') || document.body
      el.animate?.([{ opacity: 1 }, { opacity: 0.4 }, { opacity: 1 }], { duration: 250 })
      return  // at the cap — ignore
    }
    pinnedKeys.add(key)
  }
  try { localStorage.setItem('csm.pinnedKeys', JSON.stringify([...pinnedKeys])) } catch { /* ignore */ }
  renderAll(filterSessions(sessions, searchQuery), selectedKey, activeTab, true)
}
window.isPinned = isPinned
window.togglePin = togglePin

// Appearance (theme + accent) — display prefs in localStorage (like pins; no
// ~/.claude writes). The initial load runs in an inline <head> script (no flash);
// these power the Settings controls + live apply.
function hexToRgbTriplet(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return '10, 132, 255'
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}
window.applyTheme = (theme) => {
  const t = theme === 'light' ? 'light' : 'dark'
  document.documentElement.dataset.theme = t
  try { localStorage.setItem('csm.theme', t) } catch { /* ignore */ }
}
// Pick legible text (black vs white) for a solid accent-filled element, by perceived
// luminance. Lets a light accent (cyan, mauve…) keep readable CTA text without having
// to darken the accent itself — works in both themes.
function onAccentText(hex) {
  const n = parseInt(hex.slice(1), 16)
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return lum > 150 ? '#16171b' : '#ffffff'
}
window.applyAccent = (hex) => {
  const safe = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#0a84ff'
  document.documentElement.style.setProperty('--accent', safe)
  document.documentElement.style.setProperty('--accent-rgb', hexToRgbTriplet(safe))
  document.documentElement.style.setProperty('--on-accent', onAccentText(safe))
  try { localStorage.setItem('csm.accent', safe) } catch { /* ignore */ }
}
window.getTheme = () => document.documentElement.dataset.theme || 'dark'
window.getAccent = () => { try { return localStorage.getItem('csm.accent') || '#0a84ff' } catch { return '#0a84ff' } }

// A "look" = the accent + a faint surface tint (warm/cool ambiance) washed over the
// window background. Neutral looks pass tint '0,0,0' @ 0 (no wash). Persisted so it
// re-applies before first paint (the inline head script reads csm.lookTint/-A).
window.applyLook = (accent, tintRgb, tintA, id) => {
  window.applyAccent(accent)
  const rgb = tintRgb || '0,0,0'
  const a = String(tintA == null ? 0 : tintA)
  document.documentElement.style.setProperty('--look-tint', rgb)
  document.documentElement.style.setProperty('--look-tint-a', a)
  try {
    localStorage.setItem('csm.look', id || 'custom')
    localStorage.setItem('csm.lookTint', rgb)
    localStorage.setItem('csm.lookTintA', a)
  } catch { /* ignore */ }
}
window.getLook = () => {
  try {
    return { id: localStorage.getItem('csm.look') || 'ardoise',
             tint: localStorage.getItem('csm.lookTint') || '0,0,0',
             tintA: localStorage.getItem('csm.lookTintA') || '0' }
  } catch { return { id: 'ardoise', tint: '0,0,0', tintA: '0' } }
}

// Card density (detailed | compact | minimal): how much each list/session card
// shows. Applied as a data-attr on <html> so CSS hides/shows elements — no re-render
// needed (cards always carry every element). 'detailed' = base CSS (no attr needed).
const DENSITIES = ['detailed', 'compact', 'minimal']
window.applyDensity = (d) => {
  const v = DENSITIES.includes(d) ? d : 'detailed'
  document.documentElement.dataset.density = v
  try { localStorage.setItem('csm.density', v) } catch { /* ignore */ }
}
window.getDensity = () => { try { return localStorage.getItem('csm.density') || 'detailed' } catch { return 'detailed' } }

// Compact chrome: hide the text labels on the view switch + New button (icons only),
// for an Android-style pared-back UI. Applied as a class on <html> (so the head can
// set it pre-paint); CSS hides .btn-label under .compact-chrome.
window.applyCompactChrome = (on) => {
  document.documentElement.classList.toggle('compact-chrome', !!on)
  try { localStorage.setItem('csm.compactChrome', on ? '1' : '0') } catch { /* ignore */ }
}
window.getCompactChrome = () => { try { return localStorage.getItem('csm.compactChrome') === '1' } catch { return false } }

// Remappable keyboard shortcuts. Only the single-key "jump" actions are remappable;
// arrows / Enter / Esc stay fixed. Stored as { action: key } in localStorage.csm.keys.
const DEFAULT_KEYS = { search: '/', viewToggle: 'v', board: 'b', tabRunning: '1', tabClosed: '2', tabArchived: '3' }
window.KEY_ACTIONS = [
  { id: 'search', label: 'Focus search' },
  { id: 'viewToggle', label: 'Toggle list / cards' },
  { id: 'board', label: 'Open board' },
  { id: 'tabRunning', label: 'Tab: Running' },
  { id: 'tabClosed', label: 'Tab: Closed' },
  { id: 'tabArchived', label: 'Tab: Archived' },
]
window.getKeys = () => {
  let stored = {}
  try { stored = JSON.parse(localStorage.getItem('csm.keys') || '{}') } catch { stored = {} }
  return { ...DEFAULT_KEYS, ...(stored && typeof stored === 'object' ? stored : {}) }
}
window.setKey = (action, key) => {
  if (!(action in DEFAULT_KEYS) || !key) return
  const next = { ...window.getKeys(), [action]: key }
  try { localStorage.setItem('csm.keys', JSON.stringify(next)) } catch { /* ignore */ }
}
window.setKeys = (map) => { try { localStorage.setItem('csm.keys', JSON.stringify(map || {})) } catch { /* ignore */ } }
window.resetKeys = () => { try { localStorage.removeItem('csm.keys') } catch { /* ignore */ } }

function filterSessions(list, query) {
  let out = list
  // Category filter (empty set = all)
  if (activeCatFilters.size > 0) {
    out = out.filter(s => activeCatFilters.has(s.category || 'OTHER'))
  }
  if (query) {
    const q = query.toLowerCase()
    out = out.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.ticket || '').toLowerCase().includes(q) ||
      (s.category || '').toLowerCase().includes(q) ||
      (s.goal || '').toLowerCase().includes(q) ||
      (s.cwd || '').toLowerCase().includes(q) ||
      (s.gitBranch || s.branch || '').toLowerCase().includes(q)
    )
  }
  return out
}

function renderCategoryFilters() {
  const chips = filterCategories().map(cat =>
    `<button class="cat-chip ${activeCatFilters.has(cat) ? 'active' : ''}" data-cat-filter="${cat}" data-cat="${cat}">${cat}</button>`
  ).join('')
  for (const id of ['cat-filter-list', 'cat-filter-cards']) {
    const el = document.getElementById(id)
    if (el) el.innerHTML = chips
  }
}

// +New root/scope: when both work & personal roots are configured, a Root toggle
// lets the user pick which scope's categories to show (and thus which root the
// session launches from — the category's scope drives that in start_session).
let nsScope = 'work'

// Category names for a given scope, from config (falls back to all if none match).
function categoriesForScope(scope) {
  const cats = (window.CSM_CONFIG && window.CSM_CONFIG.categories) || []
  const names = cats.filter(c => (c.scope || 'work') === scope).map(c => c.name)
  return names.length ? names : filterCategories()
}

// Fill the +New modal's category dropdown from config (validated names, so
// safe to interpolate). Shows the Root toggle only when both roots are set, and
// filters categories to the selected scope.
function populateNewSessionCategories() {
  const sel = document.getElementById('ns-category')
  if (!sel) return
  const cfg = window.CSM_CONFIG || {}
  const bothRoots = !!(cfg.workRoot && cfg.personalRoot)
  const scopeField = document.getElementById('ns-scope-field')
  if (scopeField) scopeField.hidden = !bothRoots
  const list = bothRoots ? categoriesForScope(nsScope) : filterCategories()
  sel.innerHTML = list.map(cat => `<option value="${cat}">${cat}</option>`).join('')
  syncPrField()   // selected category may have changed → toggle the PR field
}

function toggleCategoryFilter(cat) {
  if (activeCatFilters.has(cat)) activeCatFilters.delete(cat)
  else activeCatFilters.add(cat)
  selectedKey = null
  window._lastSelectedKey = null
  renderCategoryFilters()
  renderAll(filterSessions(sessions, searchQuery), selectedKey, activeTab, true)
}

let fetchInFlight = false
async function fetchAndRender(resort = false) {
  fetchInFlight = true
  try {
    if (activeTab === 'running') {
      // Running = active (live pid) ∪ stale (terminal gone, not /closed yet).
      const [active, stale] = await Promise.all([
        window.api.getSessions(),
        window.api.getHistoricalSessions('stale'),
      ])
      sessions = [...active, ...stale]
    } else {
      sessions = await window.api.getHistoricalSessions(activeTab)
    }
    window._lastSessions = sessions
    window._lastSelectedKey = selectedKey
    window._sessionsLoaded = true   // first fetch done → empty list shows "empty", not "Loading…"
    // Per-tab counts for the tab badges (current tab updates each poll; others fill on visit).
    window._tabCounts = window._tabCounts || {}
    window._tabCounts[activeTab] = sessions.length
    if (activeTab === 'running') window._waitingCount = sessions.filter(s => s.status === 'waiting').length
    renderAll(filterSessions(sessions, searchQuery), selectedKey, activeTab, resort)
  } catch (err) {
    console.error('Failed to fetch sessions:', err)
  } finally {
    fetchInFlight = false
  }
}

// Open a session's detail in the slide-over drawer WITHOUT leaving the board (UX:
// the board is the cockpit — see + act in context instead of redirecting to the list).
window.openBoardDetail = (key) => {
  const s = (window._boardIndex || {})[key]
  if (!s) return
  selectedKey = key
  window._lastSelectedKey = key
  const tab = (s.state === 'closed' || s.state === 'archived') ? s.state : 'running'
  if (window.renderDetailPanel) window.renderDetailPanel(s, tab)
  document.getElementById('panel-detail').classList.add('open')
  document.getElementById('scrim').classList.add('open')
}

// The board is GLOBAL — it resolves placed sessions across all states. Cache the
// combined lists by sessionKey so board cards render without per-card fetches.
window._boardIndex = {}
async function buildBoardIndex() {
  try {
    const [running, stale, closed, archived] = await Promise.all([
      window.api.getSessions(),
      window.api.getHistoricalSessions('stale'),
      window.api.getHistoricalSessions('closed'),
      window.api.getHistoricalSessions('archived'),
    ])
    const idx = {}
    for (const s of [...running, ...stale, ...closed, ...archived]) idx[sessionKey(s)] = s
    window._boardIndex = idx
  } catch (err) { console.error('board index fetch failed:', err) }
}
window.refreshBoard = async () => {
  await buildBoardIndex()
  if (viewMode === 'board' && window.renderBoard) window.renderBoard()
}

function selectSession(key) {
  const changing = key !== selectedKey
  selectedKey = key === selectedKey ? null : key
  window._lastSelectedKey = selectedKey
  // Switching sessions must NOT kill the embedded terminal — keep the pty alive
  // so sessions run in parallel. If the newly selected session already has a live
  // terminal, reveal it; otherwise just hide the pane (the previous pty keeps
  // running in the background). Only "End session ✕" kills.
  if (changing) {
    const sel = selectedKey && sessions.find(s => sessionKey(s) === selectedKey)
    const sid = sel && sel.sessionId
    if (sid && window.hasLiveTerminal && window.hasLiveTerminal(sid)) {
      window.openTerminalPane(sid, sel.cwd || '')
    } else if (window.getTerminalVisible && window.getTerminalVisible()) {
      window.hideTerminalPane()
    }
  }
  // resort=false → selecting must never reorder the list under the cursor
  renderAll(filterSessions(sessions, searchQuery), selectedKey, activeTab, false)
}

// From the board → reveal a session in the List view: switch to its tab (Running /
// Closed / Archived), load it, then select + scroll to it. The tab is inferred from
// the session shape (running sessions carry a live `status`; historical ones a
// `historyStatus`).
window.goToSession = async (key) => {
  const s = (window._boardIndex || {})[key]
  if (!s) return
  // active + stale both live in the Running tab; closed/archived in their own.
  const tab = (s.state === 'closed' || s.state === 'archived') ? s.state : 'running'
  if (activeTab !== tab) {
    activeTab = tab
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab))
    await fetchAndRender(true)
  }
  setViewMode('list')
  selectedKey = null   // selectSession toggles — clear first so this always selects
  selectSession(key)
  const el = document.querySelector(`.list-card[data-key="${CSS.escape(key)}"]`)
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

function switchTab(tab) {
  activeTab = tab
  selectedKey = null
  window._lastSelectedKey = null
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab)
  })
  fetchAndRender(true)  // tab switch → fresh sort
}

function cycleTab(dir) {
  const tabs = ['running', 'closed', 'archived']
  const i = tabs.indexOf(activeTab)
  switchTab(tabs[(i + dir + tabs.length) % tabs.length])
}

function setViewMode(mode) {
  viewMode = mode
  window.viewMode = mode   // exposed for settings.js (refresh board after column edits)
  document.body.classList.toggle('mode-cards', mode === 'cards')
  document.body.classList.toggle('mode-list', mode === 'list')
  document.body.classList.toggle('mode-board', mode === 'board')
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === mode)
  })
  // Switching to cards: start with no drawer open
  if (mode === 'cards') selectedKey = null
  if (mode === 'board') {
    // Board is global; the terminal pane belongs to the detail panel (hidden here).
    if (window.getTerminalVisible && window.getTerminalVisible()) window.hideTerminalPane()
    if (window.renderBoard) window.renderBoard()     // columns now (don't wait on the fetch)
    if (window.refreshBoard) window.refreshBoard()   // then refresh card data from sessions
    return
  }
  renderAll(filterSessions(sessions, searchQuery), selectedKey, activeTab, false)
}

// Close the cards-mode drawer
function closeDrawer() {
  // Dismissing the drawer only hides the terminal (pty stays alive); "End session ✕" kills.
  if (window.getTerminalVisible && window.getTerminalVisible()) window.hideTerminalPane()
  selectedKey = null
  window._lastSelectedKey = null
  renderAll(filterSessions(sessions, searchQuery), selectedKey, activeTab, false)
}

// Search — both fields (sidebar + cards topbar) drive the same query
function onSearchInput(e) {
  searchQuery = e.target.value.trim()
  selectedKey = null
  // keep the other field in sync
  const other = e.target.id === 'search-field' ? 'cards-search' : 'search-field'
  const otherEl = document.getElementById(other)
  if (otherEl && otherEl.value !== e.target.value) otherEl.value = e.target.value
  renderAll(filterSessions(sessions, searchQuery), selectedKey, activeTab, true)
}
document.getElementById('search-field').addEventListener('input', onSearchInput)
document.getElementById('cards-search').addEventListener('input', onSearchInput)

// When an embedded terminal opens, it resumes the session — which makes a Closed
// session live. Remember the session (so renderAll keeps its panel + terminal
// alive across the Closed→Running migration) and flip the view to the Running tab,
// keeping the session selected. The selection key (notesPath) is stable across
// tabs, so once the resumed session registers in the running list it stays current.
window.onTerminalOpened = (sessionId) => {
  const s = sessions.find(x => x.sessionId === sessionId)
  if (s) window._terminalSession = s
  if (activeTab !== 'running') {
    activeTab = 'running'
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === 'running')
    })
    if (s) { selectedKey = sessionKey(s); window._lastSelectedKey = selectedKey }
    fetchAndRender(true)
  } else {
    // Already on the running tab — re-render so the header picks up the icons
    // now that the terminal is visible.
    renderAll(filterSessions(sessions, searchQuery), selectedKey, activeTab, false)
  }
}
window.onTerminalClosed = () => {
  window._terminalSession = null
  // Terminal hidden → header drops its icons, info pane shows the full Actions row.
  renderAll(filterSessions(sessions, searchQuery), selectedKey, activeTab, false)
}

// True if this session's claude process is currently live. On the Running tab
// every listed session is alive (get_sessions filters by alive pid); live sessions
// never appear on Closed/Archived. So "running tab + in the list" == live.
// Live = an ACTIVE running process. The Running tab now also lists stale sessions
// (dead pid, not /closed); those must NOT count as live or opening one wrongly warns
// "already running".
window.isSessionLive = (sid) =>
  activeTab === 'running' && !!sid && sessions.some(s => s.sessionId === sid && s.state === 'active')

window.sessionNameFor = (sid) => {
  const s = (window._lastSessions || []).find(x => x.sessionId === sid)
  return (s && s.name) || 'This session'
}
window.sessionPidFor = (sid) => {
  const s = (window._lastSessions || []).find(x => x.sessionId === sid)
  return (s && s.pid) || 0
}

// Sticky open destination (Embedded vs external Terminal), shared by Resume/Restart.
// localStorage like the other appearance prefs → folds into durable storage (#18).
window.getOpenIn = () => (localStorage.getItem('csm.openIn') === 'terminal' ? 'terminal' : 'embedded')
window.setOpenIn = (v) => localStorage.setItem('csm.openIn', v === 'terminal' ? 'terminal' : 'embedded')

// Promise-based confirm dialog. Resolves 'confirm' | 'extra' | 'cancel'. The
// optional extra button (extraLabel) sits between Cancel and the primary action.
window.confirmAction = ({ title = 'Heads up', body = '', confirmLabel = 'Continue', extraLabel = null } = {}) =>
  new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal')
    document.getElementById('confirm-title').textContent = title
    document.getElementById('confirm-body').textContent = body
    const okBtn = document.getElementById('confirm-ok')
    const cancelBtn = document.getElementById('confirm-cancel')
    const extraBtn = document.getElementById('confirm-extra')
    okBtn.textContent = confirmLabel
    if (extraLabel) { extraBtn.textContent = extraLabel; extraBtn.hidden = false } else { extraBtn.hidden = true }
    const done = (val) => {
      okBtn.removeEventListener('click', onOk)
      cancelBtn.removeEventListener('click', onCancel)
      extraBtn.removeEventListener('click', onExtra)
      modal.removeEventListener('cancel', onEsc)
      modal.close()
      resolve(val)
    }
    const onOk = () => done('confirm')
    const onCancel = () => done('cancel')
    const onExtra = () => done('extra')
    const onEsc = () => done('cancel') // Esc key
    okBtn.addEventListener('click', onOk)
    cancelBtn.addEventListener('click', onCancel)
    extraBtn.addEventListener('click', onExtra)
    modal.addEventListener('cancel', onEsc)
    modal.showModal()
  })

// Re-fetch + re-render the current tab (e.g. after archiving moves a session out).
window.refreshSessions = () => fetchAndRender(true)

window.selectSession = selectSession
window.switchTab = switchTab
window.closeDrawer = closeDrawer
window.detachSession = (key) => {
  window.api.detachSession(key)
  closeDrawer()  // close the in-app drawer once it pops out to its own window
}

// View toggle buttons — only the titlebar ones (data-view). The theme/scope
// toggles reuse .view-btn but have their own handlers; don't wire setViewMode to them.
document.querySelectorAll('.view-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => setViewMode(btn.dataset.view))
})

// New-session backoffice
const newSessionModal = document.getElementById('new-session-modal')
const nsError = document.getElementById('ns-error')
function showNsError(msg) { nsError.textContent = msg; nsError.hidden = false }
function hideNsError() { nsError.hidden = true; nsError.textContent = '' }

// GitHub PR URL — mirrors is_pr_url in lib.rs (Rust re-validates; this is fast UX).
const PR_URL_RE = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+([/#?].*)?$/
function isPrUrl(u) { return PR_URL_RE.test(u) }
// The "PR to review" field is REVIEW-only — show it only for that category.
function syncPrField() {
  const cat = document.getElementById('ns-category')
  const field = document.getElementById('ns-pr-field')
  if (cat && field) field.hidden = cat.value !== 'REVIEW'
}

document.getElementById('new-session-btn').addEventListener('click', () => {
  for (const id of ['ns-name', 'ns-ticket', 'ns-repo', 'ns-branch', 'ns-pr']) {
    document.getElementById(id).value = ''
  }
  hideNsError()
  populateNewSessionCategories()   // refresh (scope toggle + config may have changed)
  newSessionModal.showModal()
  document.getElementById('ns-name').focus()
})
document.getElementById('ns-cancel').addEventListener('click', () => newSessionModal.close())
// Category change → show/hide the REVIEW-only PR field.
document.getElementById('ns-category').addEventListener('change', syncPrField)

// Root toggle: switch scope → re-filter the category dropdown.
document.querySelectorAll('.ns-scope-toggle [data-scope]').forEach(btn => {
  btn.addEventListener('click', () => {
    nsScope = btn.dataset.scope
    document.querySelectorAll('.ns-scope-toggle [data-scope]').forEach(b =>
      b.classList.toggle('active', b.dataset.scope === nsScope))
    populateNewSessionCategories()
  })
})

// Browse → native folder picker for the optional repo field (untouched on cancel).
newSessionModal.addEventListener('click', async (e) => {
  const browse = e.target.closest('.path-browse[data-browse]')
  if (!browse) return
  const target = document.getElementById(browse.dataset.browse)
  if (!target || !window.api.pickDirectory) return
  const picked = await window.api.pickDirectory()
  if (picked) target.value = picked
})

// Submit: validate, start (Rust pre-flights repo/branch), and ONLY close on
// success — failures (bad branch/repo) surface inline since the iTerm tab can't.
document.getElementById('new-session-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  hideNsError()
  const category = document.getElementById('ns-category').value
  const name = document.getElementById('ns-name').value.trim()
  const ticket = document.getElementById('ns-ticket').value.trim()
  const repo = document.getElementById('ns-repo').value.trim()
  const branch = document.getElementById('ns-branch').value.trim()
  const prLink = category === 'REVIEW' ? document.getElementById('ns-pr').value.trim() : ''
  if (!name) { showNsError('Title is required.'); return }
  if (branch && !repo) { showNsError('Pick a repo for the branch to be checked out in.'); return }
  if (prLink && !isPrUrl(prLink)) { showNsError('PR link must be a GitHub PR URL (…/owner/repo/pull/123).'); return }
  const res = await window.api.startSession({ category, name, ticket, repo, branch, prLink })
  if (!res || !res.ok) {
    showNsError('Could not start: ' + ((res && res.error) || 'unknown error'))
    return
  }
  newSessionModal.close()
})

// Category filter chips (delegated — chips are rebuilt on toggle)
document.addEventListener('click', e => {
  const chip = e.target.closest('.cat-chip[data-cat-filter]')
  if (chip) toggleCategoryFilter(chip.dataset.catFilter)
})

// Scrim click closes the drawer
document.getElementById('scrim').addEventListener('click', closeDrawer)
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return
  const drawerOpen = document.getElementById('panel-detail').classList.contains('open')
  if ((viewMode === 'cards' && selectedKey) || (viewMode === 'board' && drawerOpen)) closeDrawer()
})

// ── Keyboard navigation (power-user / flow) ──
function isTypingTarget(el) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}
function clearSearch() {
  searchQuery = ''
  ;['search-field', 'cards-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = '' })
  renderAll(filterSessions(sessions, searchQuery), selectedKey, activeTab, true)
}
// The visible session keys, in DOM/render order (respects groups, sort, filter).
function visibleSessionKeys() {
  const sel = viewMode === 'cards' ? '#cards-grid .session-card[data-key]' : '#panel-list .list-card[data-key]'
  return [...document.querySelectorAll(sel)].map(el => el.dataset.key)
}
// Lightweight selection move for keyboard nav: toggle .selected in place + refresh
// the detail panel, WITHOUT rebuilding the whole list (full innerHTML replace caused
// a flicker) or revealing/hiding the embedded terminal (which flashed on every
// keypress in the Running tab). Mouse click still uses selectSession (full behavior).
function navSelect(key) {
  if (!key || key === selectedKey) return
  selectedKey = key
  window._lastSelectedKey = key
  document.querySelectorAll('#panel-list .list-card.selected').forEach(el => el.classList.remove('selected'))
  const card = document.querySelector(`#panel-list .list-card[data-key="${CSS.escape(key)}"]`)
  if (card) { card.classList.add('selected'); card.scrollIntoView({ block: 'nearest' }) }
  const s = sessions.find(x => sessionKey(x) === key)
  if (s && window.renderDetailPanel) window.renderDetailPanel(s, activeTab)
}
function moveSelection(delta) {
  const keys = visibleSessionKeys()
  if (!keys.length) return
  const i = keys.indexOf(selectedKey)
  const next = i === -1 ? (delta > 0 ? keys[0] : keys[keys.length - 1])
    : keys[Math.max(0, Math.min(keys.length - 1, i + delta))]
  navSelect(next)
}
document.addEventListener('keydown', (e) => {
  // Leave modifier combos to the OS / the Cmd+K palette (added in P2).
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const typing = isTypingTarget(document.activeElement)
  // Esc inside a search field clears + blurs it (otherwise let other handlers act).
  if (e.key === 'Escape') {
    const el = document.activeElement
    if (typing && (el.id === 'search-field' || el.id === 'cards-search')) {
      clearSearch(); el.blur(); e.preventDefault()
    }
    return
  }
  if (typing) return
  // Remappable single-key actions (csm.keys). Case-insensitive for letters.
  const keys = window.getKeys ? window.getKeys() : DEFAULT_KEYS
  const km = (action) => {
    const key = keys[action]
    return key && (e.key === key || (e.key.length === 1 && key.length === 1 && e.key.toLowerCase() === key.toLowerCase()))
  }
  if (km('search')) {
    const el = document.getElementById(viewMode === 'cards' ? 'cards-search' : 'search-field')
    if (el) { el.focus(); el.select(); e.preventDefault() }
    return
  }
  if (km('tabRunning')) { switchTab('running'); e.preventDefault(); return }
  if (km('tabClosed')) { switchTab('closed'); e.preventDefault(); return }
  if (km('tabArchived')) { switchTab('archived'); e.preventDefault(); return }
  if (km('viewToggle')) { setViewMode(viewMode === 'cards' ? 'list' : 'cards'); e.preventDefault(); return }
  if (km('board')) { setViewMode('board'); e.preventDefault(); return }
  // Board: 2D arrow/hjkl navigation between cards & columns; Enter opens the slide-over.
  if (viewMode === 'board') {
    if (e.key === 'ArrowDown' || e.key === 'j') { window.boardNav && window.boardNav('down'); e.preventDefault(); return }
    if (e.key === 'ArrowUp' || e.key === 'k') { window.boardNav && window.boardNav('up'); e.preventDefault(); return }
    if (e.key === 'ArrowLeft' || e.key === 'h') { window.boardNav && window.boardNav('left'); e.preventDefault(); return }
    if (e.key === 'ArrowRight' || e.key === 'l') { window.boardNav && window.boardNav('right'); e.preventDefault(); return }
    if (e.key === 'Enter') { window.boardOpenFocused && window.boardOpenFocused(); e.preventDefault(); return }
    return
  }
  // ←/→ cycle the Running/Closed/Archived tab (list + cards views — board owns ←/→).
  if (e.key === 'ArrowLeft') { cycleTab(-1); e.preventDefault(); return }
  if (e.key === 'ArrowRight') { cycleTab(1); e.preventDefault(); return }
  // Arrow / vim selection + Enter to launch — list view only (cards opens a drawer).
  if (viewMode === 'list') {
    if (e.key === 'ArrowDown' || e.key === 'j') { moveSelection(1); e.preventDefault(); return }
    if (e.key === 'ArrowUp' || e.key === 'k') { moveSelection(-1); e.preventDefault(); return }
    if (e.key === 'Enter' && selectedKey) {
      const s = sessions.find(x => sessionKey(x) === selectedKey)
      if (s && window.openSessionDefault) window.openSessionDefault(s)
      e.preventDefault()
    }
  }
})

// Wire up tab buttons
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab))
})

// Resizable panel
const resizeHandle = document.getElementById('resize-handle')
const panelLeft = document.getElementById('panel-left')
let isResizing = false
let startX = 0
let startWidth = 0

resizeHandle.addEventListener('mousedown', e => {
  isResizing = true
  startX = e.clientX
  startWidth = panelLeft.getBoundingClientRect().width
  resizeHandle.classList.add('dragging')
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
})

document.addEventListener('mousemove', e => {
  if (!isResizing) return
  const delta = e.clientX - startX
  const newWidth = Math.min(520, Math.max(180, startWidth + delta))
  panelLeft.style.width = `${newWidth}px`
  if (window.fitActiveTerminal) window.fitActiveTerminal()
})

document.addEventListener('mouseup', () => {
  if (!isResizing) return
  isResizing = false
  resizeHandle.classList.remove('dragging')
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})

// Load the shared config first, then render everything from it.
// Seed every tab's count badge at launch (one-shot fetch of all three buckets), so
// the badges aren't empty until you visit each tab. The active tab then stays fresh
// via the poll; closed/archived counts refresh on visit (they change slowly).
async function seedTabCounts() {
  try {
    const [active, stale, closed, archived] = await Promise.all([
      window.api.getSessions(),
      window.api.getHistoricalSessions('stale'),
      window.api.getHistoricalSessions('closed'),
      window.api.getHistoricalSessions('archived'),
    ])
    window._tabCounts = {
      running: active.length + stale.length,
      closed: closed.length,
      archived: archived.length,
    }
    window._waitingCount = active.filter(s => s.status === 'waiting').length
    if (window.updateTabBadges) window.updateTabBadges()
  } catch (e) { /* badges fall back to lazy per-visit fill */ }
}

async function boot() {
  try {
    window.CSM_CONFIG = await window.api.getConfig()
    if (window.applyCategoryColors) window.applyCategoryColors(window.CSM_CONFIG.colorMap)
  } catch (err) {
    console.error('config load failed, using fallbacks:', err)
  }
  window.installDelegatedHandlers()           // one delegated click handler on <body>
  renderCategoryFilters()                     // build the category filter chips (from config)
  populateNewSessionCategories()              // fill the +New dropdown (from config)
  fetchAndRender(true)                        // initial → sort
  seedTabCounts()                             // fill ALL tab badges at launch (not just on visit)
  // poll → keep order frozen; skip if the previous fetch is still running (no stacking)
  setInterval(() => {
    if (viewMode === 'board') window.refreshBoard()
    else if (!fetchInFlight) fetchAndRender(false)
  }, POLL_INTERVAL)
}
window.reloadConfig = async () => {           // called by Settings after save
  window.CSM_CONFIG = await window.api.getConfig()
  if (window.applyCategoryColors) window.applyCategoryColors(window.CSM_CONFIG.colorMap)
  renderCategoryFilters()
  populateNewSessionCategories()
  fetchAndRender(true)
}
boot()
