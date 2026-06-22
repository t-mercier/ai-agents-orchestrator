const STATUS_ORDER = { waiting: 0, busy: 1, idle: 2 }

// Inject one color rule per configured category (replaces the hardcoded CSS).
// Scoped exactly like the originals so inactive filter chips stay neutral.
function applyCategoryColors(colorMap) {
  if (!colorMap) return
  const css = Object.entries(colorMap).map(([name, color]) => {
    const c = CSS.escape(name)
    return `.session-card-cat[data-cat="${c}"],.category-name[data-cat="${c}"],.cat-chip.active[data-cat="${c}"]{color:${color}}`
  }).join('')
  let el = document.getElementById('cat-colors')
  if (!el) { el = document.createElement('style'); el.id = 'cat-colors'; document.head.appendChild(el) }
  el.textContent = css
}
window.applyCategoryColors = applyCategoryColors

// Persisted across re-renders — categories start expanded
const collapsedCategories = new Set()
// Same, for the space sections shown in All mode (list view groups by space → category).
const collapsedSpaces = new Set()

// Frozen sort order: rebuilt only on tab switch / search / manual refresh,
// NOT on the 5s poll — so the list never reorders under the user's cursor.
let sortRank = new Map()        // sessionId → rank (lower = higher in list)
// Activity timestamps seen on the previous render — used to flash changed cards.
let prevActivity = new Map()    // sessionId → epoch ms

// Pure helpers live in renderer/lib/* (loaded as <script> before this file).
// Destructure so existing call sites stay unchanged.
const { truncate, escapeHtml, statusLabel, sessionTime, formatTimestamp, formatDateTime } = window.CSMFormatters
const { renderMarkdown } = window.CSMMarkdown

function rebuildSortRank(sessions) {
  const sorted = [...sessions].sort((a, b) => sessionTime(b) - sessionTime(a))
  sortRank = new Map(sorted.map((s, i) => [s.sessionId, i]))
}

function rankOf(s) {
  return sortRank.has(s.sessionId) ? sortRank.get(s.sessionId) : Number.MAX_SAFE_INTEGER
}

// Stable unique identity: sessionId can be null or duplicated across historical
// notes.md files, but notesPath is unique per session folder.
function sessionKey(s) {
  return s.notesPath || s.sessionId || s.name || ''
}

// Display title with the redundant leading "<CATEGORY> | " prefix stripped — the
// category is already shown (group header in list, badge on cards/board). Full name
// stays in the title= tooltip. Only strips when the name actually starts with it.
function displayName(s) {
  const name = s.name || 'unnamed'
  const cat = (s.category || '').trim()
  if (!cat) return name
  const re = new RegExp('^\\s*' + cat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\|\\s*', 'i')
  const stripped = name.replace(re, '').trim()
  return stripped || name
}
window.displayName = displayName

// Set innerHTML only when it changed — avoids resetting cursor/hover every poll
function setHtml(el, html) {
  if (el._lastHtml !== html) {
    el.innerHTML = html
    el._lastHtml = html
  }
}

// Detail-panel template helpers (label is a trusted literal; value/body are
// already-built HTML). Consolidates the repeated meta-row / section boilerplate.
function metaRow(label, value) {
  return `<div class="meta-row"><span class="meta-label">${label}</span>${value}</div>`
}
function detailSection(label, body) {
  return `<div class="detail-section"><div class="section-label">${label}</div>${body}</div>`
}

// The session's meta rows (working dir / branch / worktree / category / dates).
// Shared by the detail info-pane and the info popover (shown over the embedded
// terminal), so both stay in sync — single source of truth for "the card info".
function buildMetaRows(s, isHistorical) {
  const lastUpdate = formatDateTime(s.updatedAt || s.lastActivityAt)
  return [
    !isHistorical && s.cwd ? metaRow('Working directory', pathLink(s.cwd)) : '',
    (s.gitBranch || s.branch) ? metaRow('Branch', `🌿 ${escapeHtml(s.gitBranch || s.branch)}`) : '',
    !isHistorical && s.worktree ? metaRow('Worktree', pathLink(s.worktree, '🗂 ')) : '',
    s.category ? metaRow('Category', `${escapeHtml(s.category)}${s.ticket ? ` · ${escapeHtml(s.ticket)}` : ''}`) : '',
    s.root ? metaRow('Space', escapeHtml(String(s.root))) : '',
    isHistorical && s.startedAt ? metaRow('Started', escapeHtml(s.startedAt)) : '',
    lastUpdate ? metaRow('Last update', escapeHtml(lastUpdate)) : '',
  ].filter(Boolean).join('')
}

// Abbreviate an absolute path to ~/… for display (home comes from the config).
function shortHome(p) {
  if (!p) return p
  const h = (window.CSM_CONFIG && window.CSM_CONFIG.home) || ''
  return h && (p === h || p.startsWith(h + '/')) ? '~' + p.slice(h.length) : p
}

// A path rendered clickable (opens it in Finder via the data-folder handler),
// shown abbreviated with ~/.
function pathLink(fullPath, prefix = '') {
  return `<span class="path-link" data-folder="${escapeHtml(fullPath)}" title="Open in Finder — ${escapeHtml(fullPath)}">${prefix}${escapeHtml(shortHome(fullPath))}</span>`
}

// ── Left panel: grouped by category ──

function groupByCategory(sessions) {
  const groups = {}
  for (const s of sessions) {
    const cat = s.category || 'OTHER'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(s)
  }
  // Sort within each group by the frozen rank (stable across polls).
  for (const cat of Object.keys(groups)) {
    groups[cat].sort((a, b) => rankOf(a) - rankOf(b))
  }
  // Sort categories by configured order, unknown ones alphabetically after
  const order = window.CSMCategories.order()
  return Object.entries(groups).sort(([a], [b]) => {
    const ai = order.indexOf(a)
    const bi = order.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

function hasBusy(sessions) {
  return sessions.some(s => s.status === 'waiting' || s.status === 'busy' || s.status === 'shell')
}

// Pin state is owned by app.js (persisted in localStorage, capped). These read it.
function isPinnedSession(s) {
  return !!(window.isPinned && window.isPinned(sessionKey(s)))
}
function pinBtn(s) {
  const k = sessionKey(s)
  const p = isPinnedSession(s)
  return `<button class="pin-btn ${p ? 'pinned' : ''}" data-pin-key="${escapeHtml(k)}"
           title="${p ? 'Unpin' : 'Pin to top'}" aria-label="${p ? 'Unpin' : 'Pin to top'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>`
}

// Archive button — only on CLOSED sessions (historical + not already archived).
// Running sessions (no historyStatus) get none (close them first); archived ones
// are already there. Click → confirm → archive_session (moves it to Archived).
function archiveBtn(s) {
  if (!s.notesPath || !s.historyStatus || s.historyStatus === 'archived') return ''
  return `<button class="archive-btn" data-archive-notes="${escapeHtml(s.notesPath)}" data-archive-name="${escapeHtml(s.name || '')}"
           title="Archive this session" aria-label="Archive this session"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg></button>`
}

// Archived sessions get a Trash button — moves the whole session folder to the macOS
// Trash (recoverable from Finder), to declutter the disk. ONLY archived: running/closed
// work is never deletable from the app (see delete_session's archived guard in Rust).
function deleteBtn(s) {
  if (s.historyStatus !== 'archived' || !s.notesPath) return ''
  const id = s.sessionId || slugOf(s) || ''
  return `<button class="delete-btn" data-delete-notes="${escapeHtml(s.notesPath)}" data-delete-name="${escapeHtml(s.name || '')}" data-delete-id="${escapeHtml(id)}"
           title="Delete — move to the Trash" aria-label="Delete this session (move to Trash)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg></button>`
}

// First "Next steps" line — the re-entry cue ("where was I"). Strips list bullets.
function firstNextStep(nextSteps) {
  if (!nextSteps) return ''
  const line = nextSteps.split('\n').map(l => l.trim()).find(Boolean) || ''
  return line.replace(/^[-*\d.)\]\s]+/, '').trim()
}

// Compact icon row (Jira ticket / PR / notes) shown on list + session cards. Reuses
// the detail-panel pills, so a click opens the link/folder via the delegated handlers
// (which return early → the card isn't also selected). Visible in detailed + compact
// density, hidden in minimal (CSS). Returns '' when the session has none of the three.
function cardIcons(s) {
  // Ticket as a number label (consistent with the board); PR + notes stay as icons.
  // (The session's space is in the detail slide-over; the cards view adds a space
  // badge only for an AMBIGUOUS category — see ambiguousRootBadge.)
  const icons = [ticketChip(s.ticket), prPill(s.prLink), notesPill(s.notesPath)].filter(Boolean).join('')
  return icons ? `<div class="card-icons">${icons}</div>` : ''
}

// Space badge shown ONLY when the category is ambiguous (exists in 2+ spaces) and
// we're in All mode — so the cards/board stay clean except where a space is the only
// thing telling two same-named categories apart. The list disambiguates by grouping.
function ambiguousRootBadge(s) {
  if (!s.root || !window.showRootBadge || !window.showRootBadge()) return ''
  if (!window.ambiguousCategory || !window.ambiguousCategory(s.category)) return ''
  return `<span class="root-badge" title="Space">${escapeHtml(String(s.root))}</span>`
}

function renderListCard(s, selectedKey, changed) {
  // Full text — CSS (ellipsis) clips to the panel width, so widening the panel reveals more.
  const preview = escapeHtml(s.lastActivity || s.goal || '')
  const next = firstNextStep(s.nextSteps)
  // Only 'waiting' keeps a text badge (it's the one state needing action);
  // for busy/idle the colored dot carries the meaning (Tufte: no redundant ink).
  // Stale = open work whose terminal is gone (in the Running tab alongside active):
  // grey dot + a "stale" badge so it reads as distinct from a live session.
  const stale = s.state === 'stale'
  const dotClass = stale ? 'stale' : (s.status || 'idle')
  // Closed / archived: dim the name to a greyed white so it doesn't read as a live
  // (bright-white) session — but lighter than stale (which is fully greyed).
  const historical = (s.state === 'closed' || s.state === 'archived') ? 'historical' : ''
  const badge = stale
    ? `<span class="list-card-badge stale">stale</span>`
    : (s.status === 'waiting' ? `<span class="list-card-badge waiting">WAIT</span>` : '')
  // Selection is keyed on sessionKey (unique per notes.md) — sessionId can be
  // null or duplicated across historical notes, which would select two cards at once.
  return `
    <div class="list-card ${dotClass} ${historical} ${sessionKey(s) === selectedKey ? 'selected' : ''} ${changed ? 'just-updated' : ''} ${isPinnedSession(s) ? 'pinned' : ''}"
         data-key="${escapeHtml(sessionKey(s))}">
      <div class="list-card-header">
        <span class="status-dot ${dotClass}"></span>
        <span class="list-card-name" title="${escapeHtml(s.name)}">${escapeHtml(displayName(s))}</span>
        ${archiveBtn(s)}
        ${deleteBtn(s)}
        ${pinBtn(s)}
      </div>
      ${preview ? `<div class="list-card-preview">${preview}</div>` : ''}
      ${next ? `<div class="list-card-next" title="Next: ${escapeHtml(next)}">↪ ${escapeHtml(truncate(next, 70))}</div>` : ''}
      ${(cardIcons(s) || badge) ? `<div class="list-card-foot">${cardIcons(s)}${badge}</div>` : ''}
    </div>
  `
}

function renderCategoryGroup(category, sessions, selectedKey, changedKeys) {
  const collapsed = collapsedCategories.has(category)
  const active = hasBusy(sessions)
  return `
    <div class="category-group">
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

// A space section (All mode): an expandable header wrapping that space's category
// groups. Ordered by the config's space order; sessions with no space fall under "—".
function renderSpaceSection(space, sessions, selectedKey, changedKeys) {
  const collapsed = collapsedSpaces.has(space)
  const active = hasBusy(sessions)
  const inner = groupByCategory(sessions)
    .map(([cat, sess]) => renderCategoryGroup(cat, sess, selectedKey, changedKeys))
    .join('')
  return `
    <div class="space-group">
      <div class="space-header ${active ? 'has-active' : ''}" data-space="${escapeHtml(space)}">
        <span class="space-chevron ${collapsed ? 'collapsed' : ''}">›</span>
        <span class="space-name">${escapeHtml(space)}</span>
        <span class="space-count">${sessions.length}</span>
      </div>
      <div class="space-sessions ${collapsed ? 'collapsed' : ''}">${inner}</div>
    </div>
  `
}

// Group sessions by space, ordered by the config's roots order ("—" for un-spaced last).
function groupBySpace(sessions) {
  const groups = {}
  for (const s of sessions) {
    const sp = s.root || '—'
    ;(groups[sp] = groups[sp] || []).push(s)
  }
  const order = ((window.CSM_CONFIG && window.CSM_CONFIG.roots) || []).map(r => r.name)
  return Object.entries(groups).sort(([a], [b]) => {
    const ai = order.indexOf(a), bi = order.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

// Empty / loading state for the session list + cards grid (shared). Distinguishes
// "still loading the first fetch" from genuinely empty, and a no-search-match.
function emptyListMessage() {
  if (!window._sessionsLoaded) return `<div class="list-empty">Loading sessions…</div>`
  const q = (typeof searchQuery === 'string' ? searchQuery : '').trim()
  if (q) return `<div class="list-empty">No sessions match “<strong>${escapeHtml(q)}</strong>”.</div>`
  const label = activeTab === 'running' ? 'No running or stale sessions.'
    : activeTab === 'archived' ? 'No archived sessions.'
    : 'No closed sessions yet.'
  return `<div class="list-empty">${label}<span class="list-empty-hint">Start one with ＋ New</span></div>`
}

// Flash detection: keys whose activity advanced since the last render. Shared by the
// list AND the cards grid so both light up on change. Skips the very first render.
function computeChangedKeys(sessions) {
  const changed = new Set()
  const firstRender = prevActivity.size === 0
  for (const s of sessions) {
    const key = sessionKey(s)
    const now = sessionTime(s)
    const before = prevActivity.get(key)
    if (!firstRender && before !== undefined && now > before) changed.add(key)
    prevActivity.set(key, now)
  }
  // Prune sessions that vanished, so the Map can't grow unbounded over a long run.
  if (prevActivity.size > sessions.length) {
    const live = new Set(sessions.map(sessionKey))
    for (const k of prevActivity.keys()) if (!live.has(k)) prevActivity.delete(k)
  }
  return changed
}

// Per-tab count badges + a red "waiting" dot on Running. Counts come from
// window._tabCounts (filled per tab on visit); the current tab is always fresh.
function updateTabBadges() {
  const counts = window._tabCounts || {}
  const labels = { running: 'Running', closed: 'Closed', archived: 'Archived' }
  const waiting = window._waitingCount || 0
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    const tab = btn.dataset.tab
    const n = counts[tab]
    const badge = (n != null) ? `<span class="tab-count">${n}</span>` : ''
    const dot = (tab === 'running' && waiting > 0)
      ? `<span class="tab-wait-dot" title="${waiting} waiting for you"></span>` : ''
    const html = `${labels[tab] || tab}${badge}${dot}`
    if (btn._badgeHtml !== html) { btn.innerHTML = html; btn._badgeHtml = html }
  })
}

function renderPanelList(sessions, selectedKey, changedKeys) {
  if (!sessions.length) { setHtml(document.getElementById('panel-list'), emptyListMessage()); return }

  // Three floated groups, in urgency order:
  //  1. "⚡ Needs you"  — waiting sessions (claude is blocked on your input), pulled out
  //     of their category so blocked work is never buried in a collapsed group.
  //  2. "PINNED"        — your pins (minus any already in Needs you).
  //  3. category groups — everything else.
  const waiting = sessions.filter(s => s.status === 'waiting')
  const pinned = sessions.filter(s => isPinnedSession(s) && s.status !== 'waiting')
  const rest = sessions.filter(s => !isPinnedSession(s) && s.status !== 'waiting')
  let html = ''
  if (waiting.length) {
    waiting.sort((a, b) => rankOf(a) - rankOf(b))
    html += renderCategoryGroup('⚡ Needs you', waiting, selectedKey, changedKeys)
  }
  if (pinned.length) {
    pinned.sort((a, b) => rankOf(a) - rankOf(b))
    html += renderCategoryGroup('PINNED', pinned, selectedKey, changedKeys)
  }
  // In All mode (>1 space), nest the rest under expandable space sections → category
  // groups; otherwise (a single space selected) just category groups as before.
  if (window.showRootBadge && window.showRootBadge()) {
    html += groupBySpace(rest).map(([space, sess]) =>
      renderSpaceSection(space, sess, selectedKey, changedKeys)
    ).join('')
  } else {
    html += groupByCategory(rest).map(([cat, sess]) =>
      renderCategoryGroup(cat, sess, selectedKey, changedKeys)
    ).join('')
  }
  // Skip DOM rewrite when unchanged — preserves hover/cursor between idle polls.
  setHtml(document.getElementById('panel-list'), html)
}

// ── Cards view: full-width grid ──

function renderSessionCard(s, selectedKey, changed) {
  const preview = escapeHtml(truncate(s.lastActivity || s.goal, 110))
  const next = firstNextStep(s.nextSteps)
  const cat = s.category || 'OTHER'
  const upd = formatDateTime(s.updatedAt || s.lastActivityAt)  // absolute, matches detail "Last update"
  // Mirror the list card's lifecycle handling: stale = grey dot + badge; closed/
  // archived = greyed-white name (via .historical). Without this, the cards view
  // showed every Running session as live (its raw status) and historical ones bright.
  const stale = s.state === 'stale'
  const dotClass = stale ? 'stale' : (s.status || 'idle')
  const historical = (s.state === 'closed' || s.state === 'archived') ? 'historical' : ''
  const badge = stale
    ? `<span class="list-card-badge stale">stale</span>`
    : (s.status === 'waiting' ? `<span class="list-card-badge waiting">WAIT</span>` : '')
  return `
    <div class="session-card ${dotClass} ${historical} ${sessionKey(s) === selectedKey ? 'selected' : ''} ${changed ? 'just-updated' : ''} ${isPinnedSession(s) ? 'pinned' : ''}"
         data-key="${escapeHtml(sessionKey(s))}">
      <div class="session-card-head">
        <span class="status-dot ${dotClass}"></span>
        <span class="session-card-name" title="${escapeHtml(s.name)}">${escapeHtml(displayName(s))}</span>
        ${badge}
        <span class="session-card-cat" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</span>
        ${ambiguousRootBadge(s)}
        ${archiveBtn(s)}
        ${deleteBtn(s)}
        ${pinBtn(s)}
      </div>
      <div class="session-card-activity">${preview || '—'}</div>
      ${next ? `<div class="session-card-next" title="Next: ${escapeHtml(next)}">↪ ${escapeHtml(truncate(next, 90))}</div>` : ''}
      <div class="session-card-foot">
        ${cardIcons(s) || '<span></span>'}
        ${upd ? `<span class="session-card-upd" title="Last update">↻ ${escapeHtml(upd)}</span>` : ''}
      </div>
    </div>
  `
}

function renderCardsGrid(sessions, selectedKey, changedKeys = new Set()) {
  if (!sessions.length) { setHtml(document.getElementById('cards-grid'), emptyListMessage()); return }
  // Pinned cards first, then by frozen rank.
  const sorted = [...sessions].sort((a, b) => {
    const pa = isPinnedSession(a) ? 0 : 1
    const pb = isPinnedSession(b) ? 0 : 1
    return pa !== pb ? pa - pb : rankOf(a) - rankOf(b)
  })
  const html = sorted.map(s => renderSessionCard(s, selectedKey, changedKeys.has(sessionKey(s)))).join('')
  setHtml(document.getElementById('cards-grid'), html)
}

// ── Right panel: session detail ──

// Actions are an icon toolbar: a service logo where there is one (Jira/GitHub,
// vendored under renderer/icons/), a clean line-icon otherwise, each with a hover
// tooltip (data-tip) + aria-label. The delegated handlers key on the data-* attrs
// (and .pill / .terminal-toggle-btn classes), so those are preserved verbatim.
const svgIcon = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`

// Place a fixed-position popover under its anchor, but flip ABOVE when it would
// overflow the bottom of the window; clamp into the viewport (with scroll via the
// element's overflow) if it fits neither way. Used by all the action popovers so
// none gets cropped near a window edge. `el` must already be in the DOM (measured).
function positionPopover(el, anchor, gap = 6) {
  const r = anchor.getBoundingClientRect()
  const vw = window.innerWidth, vh = window.innerHeight
  el.style.maxHeight = `${vh - 16}px`     // never taller than the window (then scrolls)
  const ew = el.offsetWidth, eh = el.offsetHeight
  let top
  if (r.bottom + gap + eh <= vh) top = r.bottom + gap            // below (fits)
  else if (r.top - gap - eh >= 8) top = r.top - gap - eh         // above (fits)
  else top = Math.max(8, vh - eh - 8)                            // clamp to viewport
  const left = Math.max(8, Math.min(r.left, vw - ew - 8))
  el.style.top = `${Math.round(top)}px`
  el.style.left = `${Math.round(left)}px`
}

// Embedded terminal — the primary action, moved out of the header into Actions.
// Keeps the .terminal-toggle-btn class (its handler) and NO .pill class (so the
// .pill[data-cwd] "external terminal" handler doesn't also match it).
// The session folder slug (for /restart), derived from notesPath.
function slugOf(s) {
  if (!s.notesPath) return ''
  return s.notesPath.replace(/\/notes\.md$/, '').split('/').pop() || ''
}

function embeddedTerminalAction(s) {
  const glyph = svgIcon('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>')
  if (canResume(s)) {
    return `<button class="act act-primary terminal-toggle-btn" aria-label="Open integrated terminal" data-tip="Open integrated terminal"
             data-session="${escapeHtml(s.sessionId)}" data-cwd="${escapeHtml(s.cwd || '')}">${glyph}</button>`
  }
  // Transcript gone → can't --resume, but we can /restart from notes in the embedded
  // terminal (data-restart-slug switches the pty command). Needs a notes slug.
  const slug = slugOf(s)
  if (slug) {
    return `<button class="act act-primary terminal-toggle-btn" aria-label="Restart in integrated terminal" data-tip="Restart in integrated terminal (from notes)"
             data-session="${escapeHtml(s.sessionId || slug)}" data-cwd="${escapeHtml(s.cwd || '')}" data-restart-slug="${escapeHtml(slug)}">${glyph}</button>`
  }
  return ''
}

// Tracker-neutral tag glyph (currentColor → adapts to theme). Works for any
// issue tracker — the link is just <ticketBaseUrl> + <ticket>.
const ICON_TICKET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.414 2.414 0 0 0 3.414 0l6.586-6.586a2.414 2.414 0 0 0 0-3.414z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg>`
// GitHub mark as currentColor (not a fixed-white asset) → legible on both light & dark themes.
const ICON_GITHUB = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`

function ticketPill(ticket) {
  // Guard against junk values (e.g. a frontmatter `ticket: ""` that survived as quotes)
  if (!ticket || !/[a-z0-9]/i.test(ticket)) return ''
  // Only show the icon when it can actually open something — i.e. a tracker base URL
  // is configured (Jira, Linear, GitHub Issues, Azure DevOps…). Without one, a dead
  // icon just confuses; the ticket id still shows in the detail meta row.
  const base = (window.CSM_CONFIG && window.CSM_CONFIG.ticketBaseUrl) || ''
  if (!base) return ''
  const url = escapeHtml(base + ticket)
  return `<button class="act pill" data-url="${url}" aria-label="${escapeHtml(ticket)}" data-tip="${escapeHtml(ticket)} · open ticket">${ICON_TICKET}</button>`
}

// Ticket as a NUMBER label (e.g. FEAT-1842) for list + card views — the id reads at a
// glance, matching the board's chip. Clickable when a tracker URL is configured, a
// plain label otherwise (the detail toolbar still uses the compact icon, ticketPill).
function ticketChip(ticket) {
  if (!ticket || !/[a-z0-9]/i.test(ticket)) return ''
  const label = escapeHtml(ticket)
  const base = (window.CSM_CONFIG && window.CSM_CONFIG.ticketBaseUrl) || ''
  if (!base) return `<span class="ticket-tag" title="${label}">${label}</span>`
  return `<button class="ticket-tag ticket-chip" data-url="${escapeHtml(base + ticket)}" data-tip="${label} · open ticket">${label}</button>`
}

function prPill(prLink) {
  if (!prLink) return ''
  return `<button class="act pill" data-url="${escapeHtml(prLink)}" aria-label="Pull request" data-tip="Open PR on GitHub">${ICON_GITHUB}</button>`
}

// The PR control. Non-REVIEW: just the GitHub link if one exists. REVIEW (with a
// writable notes.md): the GitHub link + a ✎ to edit, or a "＋ Add PR link" button
// when none is set yet. The ✎ / ＋ open the inline PR editor (set_pr_link).
function prControl(s) {
  if ((s.category || '') !== 'REVIEW' || !s.notesPath) return prPill(s.prLink)
  const notes = escapeHtml(s.notesPath)
  const editIcon = svgIcon('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>')
  if (s.prLink) {
    return prPill(s.prLink) +
      `<button class="act" data-pr-edit="${notes}" aria-label="Edit PR link" data-tip="Edit PR link">${editIcon}</button>`
  }
  // No link yet → a dimmed GitHub icon that opens the editor to attach one.
  return `<button class="act pr-add" data-pr-edit="${notes}" aria-label="Add PR link" data-tip="Add PR to review">${ICON_GITHUB}</button>`
}

// A session can only be resumed if it has a real session id (UUID-ish, no spaces).
// Placeholders like "to fill" or null mean there's no Claude session to attach to.
function isResumable(sessionId) {
  return !!sessionId && /^[A-Za-z0-9_-]+$/.test(sessionId)
}

// Can we `--resume` this session? Needs a real sessionId AND (for historical
// sessions) an existing transcript — get_historical_sessions sets resumable:false
// when the .jsonl is gone, so resume would fail. Running sessions omit the flag
// (always live → resumable). When false, only Restart (rebuild from notes) works.
function canResume(s) {
  return isResumable(s.sessionId) && s.resumable !== false
}

// External terminal — resume in the user's terminal app (set in Settings). Keeps
// .pill + data-cwd so the existing handler fires; the ❯_-in-a-box arrow reads as
// "open in a full external window".
function itermPill(s) {
  if (!canResume(s)) return ''
  return `<button class="act pill" aria-label="Resume in your terminal" data-tip="Resume in your terminal (new window)"
           data-cwd="${escapeHtml(s.cwd || '')}" data-session="${escapeHtml(s.sessionId)}">${svgIcon('<path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/><path d="m21 3-9 9"/><path d="M15 3h6v6"/>')}</button>`
}

function notesPill(notesPath) {
  if (!notesPath) return ''
  const folder = notesPath.replace(/\/notes\.md$/, '')
  return `<button class="act pill" aria-label="Open notes folder" data-tip="Open notes folder"
           data-folder="${escapeHtml(folder)}">${svgIcon('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>')}</button>`
}

// Info (ⓘ) button — only shown in the header when the embedded terminal covers the
// info pane. Click pops the session's meta rows over the terminal (terminal stays up).
function infoPill() {
  return `<button class="act" data-info-pop aria-label="Session details" data-tip="Session details">${svgIcon('<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="16" y2="12"/><line x1="12" x2="12.01" y1="8" y2="8"/>')}</button>`
}

// Popover showing the selected session's meta rows (over the embedded terminal).
function closeInfoPopover() {
  const m = document.getElementById('info-pop')
  if (m) m.remove()
  document.removeEventListener('click', infoPopOutside, true)
  document.removeEventListener('keydown', infoPopEsc, true)
}
function infoPopOutside(e) {
  if (!e.target.closest('#info-pop') && !e.target.closest('[data-info-pop]')) closeInfoPopover()
}
function infoPopEsc(e) { if (e.key === 'Escape') closeInfoPopover() }
function openInfoPopover(anchor) {
  closeInfoPopover()
  // The ⓘ button lives in the header shown OVER the embedded terminal, where the
  // selection may have fallen back to the terminal session (selectedKey cleared).
  // Resolve by selectedKey first, then that fallback — else the button does nothing.
  let sel = (window._lastSessions || []).find(x => sessionKey(x) === window._lastSelectedKey)
  if (!sel && window._terminalSession) sel = window._terminalSession
  if (!sel) return
  const rows = buildMetaRows(sel, activeTab !== 'running')
  const pop = document.createElement('div')
  pop.className = 'info-pop'
  pop.id = 'info-pop'
  pop.innerHTML = `<div class="info-pop-head">Session details</div>` +
    (rows ? `<div class="detail-meta">${rows}</div>` : `<div class="info-pop-empty">No details available</div>`)
  document.body.appendChild(pop)
  positionPopover(pop, anchor)
  setTimeout(() => {
    document.addEventListener('click', infoPopOutside, true)
    document.addEventListener('keydown', infoPopEsc, true)
  }, 0)
}

// Inline editor for a REVIEW session's PR link → window.api.setPrLink (writes the
// notes.md frontmatter). Save validates the URL; Remove clears it. Reuses the
// outside-click / Esc dismiss pattern.
function closePrEditor() {
  const m = document.getElementById('pr-editor')
  if (m) m.remove()
  document.removeEventListener('click', prEditorOutside, true)
  document.removeEventListener('keydown', prEditorEsc, true)
}
function prEditorOutside(e) {
  if (!e.target.closest('#pr-editor') && !e.target.closest('[data-pr-edit]')) closePrEditor()
}
function prEditorEsc(e) { if (e.key === 'Escape') closePrEditor() }
function openPrEditor(anchor, notesPath, currentUrl) {
  closePrEditor()
  const pop = document.createElement('div')
  pop.className = 'pr-editor'
  pop.id = 'pr-editor'
  pop.innerHTML =
    `<div class="pr-editor-head">PR to review</div>` +
    `<input class="pr-editor-input" type="text" spellcheck="false" autocomplete="off" placeholder="https://github.com/owner/repo/pull/123" value="${escapeHtml(currentUrl || '')}">` +
    `<div class="pr-editor-err" hidden></div>` +
    `<div class="pr-editor-actions">${currentUrl ? `<button class="pr-editor-btn pr-editor-remove">Remove</button>` : ''}<button class="pr-editor-btn pr-editor-save">Save</button></div>`
  document.body.appendChild(pop)
  positionPopover(pop, anchor)
  const input = pop.querySelector('.pr-editor-input')
  const err = pop.querySelector('.pr-editor-err')
  input.focus(); input.select()
  const save = async (url) => {
    if (url && typeof isPrUrl === 'function' && !isPrUrl(url)) {
      err.textContent = 'Must be a GitHub PR URL (…/owner/repo/pull/123).'; err.hidden = false; return
    }
    const res = await window.api.setPrLink(notesPath, url)
    if (!res || !res.ok) { err.textContent = (res && res.error) || 'Could not save.'; err.hidden = false; return }
    closePrEditor()
    if (window.refreshSessions) window.refreshSessions()
  }
  pop.querySelector('.pr-editor-save').addEventListener('click', () => save(input.value.trim()))
  const rm = pop.querySelector('.pr-editor-remove')
  if (rm) rm.addEventListener('click', () => save(''))
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(input.value.trim()) } })
  setTimeout(() => {
    document.addEventListener('click', prEditorOutside, true)
    document.addEventListener('keydown', prEditorEsc, true)
  }, 0)
}

// Opens a small menu to pick which board column the session goes in (or to remove
// it). Lives in the detail Actions toolbar; accent-filled when already on the board.
function boardPill(s) {
  const key = sessionKey(s)
  if (!key) return ''
  const placed = !!(window.CSMBoard && CSMBoard.load().placements[key])
  return `<button class="act ${placed ? 'act-primary' : ''}" data-board-menu="${escapeHtml(key)}"
           aria-label="${placed ? 'On the board' : 'Add to board'}" data-tip="${placed ? 'On the board — click to move or remove' : 'Add to a board column'}">${svgIcon('<path d="M6 5v11"/><path d="M12 5v6"/><path d="M18 5v14"/>')}</button>`
}

// Popover menu anchored under the board button: lists the visible columns (current
// one checked) and, when placed, a Remove item. Picking one places/moves/removes the
// session, then refreshes the detail pill and the board if it's open.
function closeBoardMenu() {
  const m = document.getElementById('board-menu')
  if (m) m.remove()
  document.removeEventListener('click', boardMenuOutside, true)
  document.removeEventListener('keydown', boardMenuEsc, true)
}
function boardMenuOutside(e) {
  if (!e.target.closest('#board-menu') && !e.target.closest('[data-board-menu]')) closeBoardMenu()
}
function boardMenuEsc(e) { if (e.key === 'Escape') closeBoardMenu() }
function openBoardMenu(anchor, key) {
  closeBoardMenu()
  if (!window.CSMBoard) return
  const st = CSMBoard.load()
  const current = st.placements[key] || null
  const cols = st.columns.filter(c => !c.hidden)
  const items = cols.map(c => {
    const on = c.id === current
    const tint = /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? ` style="color:${c.color}"` : ''
    return `<button class="board-menu-item${on ? ' active' : ''}" data-col="${escapeHtml(c.id)}">
      <span class="board-menu-check">${on ? '✓' : ''}</span>
      <span class="board-menu-name"${tint}>${escapeHtml(c.name)}</span></button>`
  }).join('')
  const remove = current
    ? `<div class="board-menu-sep"></div><button class="board-menu-item board-menu-remove" data-remove="1">Remove from board</button>`
    : ''
  const menu = document.createElement('div')
  menu.className = 'board-menu'
  menu.id = 'board-menu'
  menu.innerHTML = `<div class="board-menu-head">${current ? 'Move to column' : 'Add to column'}</div>${items}${remove}`
  document.body.appendChild(menu)
  positionPopover(menu, anchor)
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.board-menu-item'); if (!item) return
    const s = CSMBoard.load()
    const next = item.dataset.remove ? CSMBoard.unplaceSession(s, key) : CSMBoard.placeSession(s, key, item.dataset.col)
    CSMBoard.save(next)
    closeBoardMenu()
    const sel = (window._lastSessions || []).find(x => sessionKey(x) === window._lastSelectedKey)
    if (sel && window.renderDetailPanel) renderDetailPanel(sel, activeTab)
    if (window.viewMode === 'board' && window.renderBoard) window.renderBoard()
  })
  // Defer the dismiss listeners so the opening click doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('click', boardMenuOutside, true)
    document.addEventListener('keydown', boardMenuEsc, true)
  }, 0)
}

// Restart a closed/archived session via the /restart skill: reloads its notes
// summary into a fresh session and re-registers it as active. (Distinct from
// "Resume", which reloads the full raw transcript and needs a live sessionId.)
function restartPill(s) {
  const slug = slugOf(s)
  if (!slug) return ''
  return `<button class="act pill" aria-label="Restart in your terminal" data-tip="Restart from notes, in your terminal"
           data-restore-slug="${escapeHtml(slug)}" data-restore-sid="${escapeHtml(s.sessionId || '')}">${svgIcon('<path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.36 2.64L3 8"/><path d="M3 3v5h5"/>')}</button>`
}

// ── Open actions (Option A): destination toggle + Resume/Restart verbs ──
// The toggle is a sticky pref (window.getOpenIn); both verbs honour it. Resume only
// when the transcript is present; Restart whenever a notes slug exists.
function destinationToggle() {
  const dest = (window.getOpenIn && window.getOpenIn()) || 'embedded'
  const kbd = svgIcon('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>')
  const ext = svgIcon('<path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/><path d="m21 3-9 9"/><path d="M15 3h6v6"/>')
  const seg = (val, label, glyph) =>
    `<button type="button" class="open-dest ${dest === val ? 'active' : ''}" data-open-dest="${val}" data-tip="Open sessions in ${label}">${glyph}${label}</button>`
  return `<span class="open-toggle">${seg('embedded', 'Embedded', kbd)}${seg('terminal', 'Terminal', ext)}</span>`
}
function resumeBtn(s) {
  if (!canResume(s)) return ''
  return `<button class="act-verb primary" data-open-resume data-session="${escapeHtml(s.sessionId)}" data-cwd="${escapeHtml(s.cwd || '')}"
           data-tip="Resume this session">${svgIcon('<polygon points="6 3 20 12 6 21 6 3"/>')}Resume</button>`
}
function restartBtn(s) {
  const slug = slugOf(s)
  if (!slug) return ''
  return `<button class="act-verb" data-open-restart data-restore-slug="${escapeHtml(slug)}" data-restore-sid="${escapeHtml(s.sessionId || '')}" data-cwd="${escapeHtml(s.cwd || '')}"
           data-tip="Restart from notes">${svgIcon('<path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.36 2.64L3 8"/><path d="M3 3v5h5"/>')}Restart</button>`
}

function renderDetailPanel(s, tab = 'running') {
  const headerEl   = document.getElementById('detail-header')
  const infoEl     = document.getElementById('detail-info-pane')

  if (!s) {
    setHtml(headerEl, '')
    setHtml(infoEl, '<div class="detail-empty">← Select a session</div>')
    return
  }

  // A stale session lives in the Running tab but has no live pid — render it like a
  // historical record (Restart/Resume/Archive, "Started" meta) with a STALE badge.
  const stale = s.state === 'stale'
  const isHistorical = s.state ? s.state !== 'active' : (tab !== 'running')
  const statusStr = stale
    ? 'STALE'
    : isHistorical
      ? (s.historyStatus === 'archived' ? 'ARCHIVED' : 'CLOSED')
      : statusLabel(s.status)
  const dotClass = stale ? 'stale' : (isHistorical ? 'historical' : (s.status || 'idle'))

  // Header: dot + name + (status badge only when it says something — IDLE is noise,
  // the dot colour already conveys it; busy/waiting + historical CLOSED/ARCHIVED stay).
  // The terminal toggle now lives in Actions as an icon; detach/close show in cards mode.
  // While the embedded terminal covers the info pane, the reference actions (ticket /
  // PR / notes / board) ride on the title line; the name (flex:1) ellipsizes to make room.
  const showBadge = isHistorical || (!!s.status && s.status !== 'idle')
  const termOpen = window.getTerminalVisible && window.getTerminalVisible()
  const headerActions = termOpen
    ? [infoPill(), ticketPill(s.ticket), prControl(s), notesPill(s.notesPath), boardPill(s)].filter(Boolean).join('')
    : ''
  setHtml(headerEl, `
    <div class="detail-header-row">
      <span class="detail-status-dot ${dotClass}"></span>
      <h1 class="detail-name" title="${escapeHtml(s.name)}">${escapeHtml(displayName(s))}</h1>
      ${showBadge ? `<span class="detail-status-badge ${isHistorical ? 'historical' : ''}">${statusStr}</span>` : ''}
      ${headerActions ? `<div class="header-actions">${headerActions}</div>` : ''}
      <button class="drawer-ctl drawer-detach" title="Detach into its own window"
              data-key="${escapeHtml(sessionKey(s))}">◳</button>
      <button class="drawer-ctl drawer-close" title="Close" onclick="window.closeDrawer()">✕</button>
    </div>
  `)

  // Info pane content
  const metaRows = buildMetaRows(s, isHistorical)

  const goalSection = s.goal ? detailSection('Goal', `<div class="detail-goal">${escapeHtml(s.goal)}</div>`) : ''

  const activitySection = !isHistorical && s.lastActivity
    ? detailSection('Last activity',
        `<div class="detail-activity">${escapeHtml(s.lastActivity)}</div>` +
        (s.lastActivityAt ? `<div class="detail-timestamp">${escapeHtml(formatTimestamp(s.lastActivityAt))}</div>` : ''))
    : ''

  const nextStepsSection = s.nextSteps
    ? detailSection('Next steps', `<div class="detail-next-steps">${renderMarkdown(s.nextSteps)}</div>`)
    : ''

  // Icon toolbar: embedded terminal (primary) first, then external terminal, then
  // ticket / PR / restart / notes — each only when relevant.
  // Launch actions grouped first (resume embedded · resume external · restart),
  // then the reference actions (ticket · PR · notes).
  // Launch cluster: destination toggle + Resume/Restart (Option A) — replaces the
  // old mixed icons (embedded/iterm × resume/restart). Then a separator, then the
  // reference actions (ticket / PR / notes / board).
  const resume = resumeBtn(s)
  const restart = restartBtn(s)
  // Only show the destination toggle when there's at least one verb to apply it to.
  const launch = (resume || restart) ? [destinationToggle(), resume, restart].filter(Boolean).join('') : ''
  const refs = [ticketPill(s.ticket), prControl(s), notesPill(s.notesPath), boardPill(s)].filter(Boolean).join('')
  const actions = launch + (launch && refs ? '<span class="act-sep"></span>' : '') + refs

  setHtml(infoEl, `
    ${metaRows ? `<div class="detail-meta">${metaRows}</div>` : ''}
    ${goalSection}
    ${activitySection}
    ${nextStepsSection}
    ${actions ? detailSection('Actions', `<div class="acts">${actions}</div>`) : ''}
  `)
}

// ── Main render ──

function renderAll(sessions, selectedKey, tab = 'running', resort = false) {
  // Rebuild the sort order only when explicitly asked (tab switch, search, manual
  // refresh, initial load). On the 5s poll, resort=false keeps the order frozen.
  if (resort || sortRank.size === 0) rebuildSortRank(sessions)
  // Render only the visible view — the other is display:none, so building its DOM
  // on every 5s poll was wasted work + layout churn. setViewMode re-renders on switch.
  const cardsMode = document.body.classList.contains('mode-cards')
  const changedKeys = computeChangedKeys(sessions)   // shared so list AND cards flash
  if (cardsMode) renderCardsGrid(sessions, selectedKey, changedKeys)
  else renderPanelList(sessions, selectedKey, changedKeys)
  updateTabBadges()   // refresh the per-tab counts
  let selected = sessions.find(s => sessionKey(s) === selectedKey) || null
  // While an embedded terminal is open, keep its session's detail panel alive even
  // if that session left the current tab's list — resuming a Closed session moves
  // it to Running, so it vanishes from the Closed list for a poll or two. Falling
  // back to the remembered session keeps the header (and its close controls) and
  // the terminal pane rendered until the user closes it (also survives a manual
  // tab switch, which nulls selectedKey).
  const termOpen = window.getTerminalVisible && window.getTerminalVisible()
  // The remembered terminal session is only a snapshot taken when the terminal
  // opened — re-resolve it from the freshly-fetched list every render so its
  // status dot (busy/waiting/idle) tracks the 5s poll instead of freezing on the
  // value it had at open time. Keyed by sessionKey, with a sessionId fallback
  // (a `--resume`d session keeps its id but runs under a new pid).
  if (window._terminalSession) {
    const pool = window._lastSessions || sessions
    const tKey = sessionKey(window._terminalSession)
    const tSid = window._terminalSession.sessionId
    const fresh = pool.find(s => sessionKey(s) === tKey) ||
                  (tSid ? pool.find(s => s.sessionId === tSid) : null)
    if (fresh) window._terminalSession = fresh
  }
  if (!selected && termOpen && window._terminalSession) selected = window._terminalSession
  renderDetailPanel(selected, tab)
  // In cards mode the detail panel is a drawer: keep it open while a session is
  // selected OR an embedded terminal is up (so the terminal isn't torn down).
  const drawerOpen = cardsMode && (!!selected || termOpen)
  document.getElementById('panel-detail').classList.toggle('open', drawerOpen)
  document.getElementById('scrim').classList.toggle('open', drawerOpen)
}

// One delegated click handler on <body>, installed once. Because containers'
// innerHTML is rebuilt only when changed, per-element listeners would either be
// lost or duplicated; delegation is immune to that and keeps hover/cursor stable.
let delegationInstalled = false
// Warn before resuming a session that's already live. Offers "Reveal window" ONLY
// when we can actually locate its terminal window (canRevealTerminal pre-check),
// else just Cancel / Open anyway. proceed() runs the original open on "Open anyway".
async function warnAlreadyRunning(sid, body, proceed) {
  if (!window.confirmAction) { proceed(); return }
  const pid = window.sessionPidFor ? window.sessionPidFor(sid) : 0
  const canReveal = pid && window.api.canRevealTerminal ? await window.api.canRevealTerminal(pid) : false
  const choice = await window.confirmAction({
    title: '🚨 Session already running',
    body,
    confirmLabel: 'Open anyway',
    extraLabel: canReveal ? 'Reveal window' : null,
  })
  if (choice === 'extra') window.api.revealTerminal(pid)
  else if (choice === 'confirm') proceed()
}

// ── Resume / Restart routing (verb × destination) ──
// Shared by the detail-panel Option-A buttons, the Enter key, and the hover quick-
// actions on cards — all route through these so the "already running" guard and the
// embedded-vs-external split stay in one place.
function routeResume(sid, cwd) {
  const dest = window.getOpenIn ? window.getOpenIn() : 'embedded'
  if (dest === 'terminal') {
    const open = () => window.api.openInTerminal(cwd, sid)
    const live = (window.isSessionLive && window.isSessionLive(sid)) || (window.hasLiveTerminal && window.hasLiveTerminal(sid))
    if (live) warnAlreadyRunning(sid, `"${window.sessionNameFor(sid)}" is already running — opening it in your terminal starts a second instance on the same session.`, open)
    else open()
  } else if (window.toggleEmbeddedTerminal) {
    const go = () => { toListForEmbedded(); window.toggleEmbeddedTerminal(sid, cwd, '') }
    const alreadyEmbedded = window.hasLiveTerminal && window.hasLiveTerminal(sid)
    if (!alreadyEmbedded && window.isSessionLive && window.isSessionLive(sid)) {
      warnAlreadyRunning(sid, `"${window.sessionNameFor(sid)}" is already running — opening it in the embedded terminal starts a second instance on the same session.`, go)
    } else { go() }
  }
}
// The embedded terminal lives in the List view's detail panel — not the cramped
// cards/board slide-over. So before opening it, leave any other view for List.
// (External-terminal resumes never call this — they open their own window.)
function toListForEmbedded() {
  if (window.viewMode && window.viewMode !== 'list' && window.setViewMode) window.setViewMode('list')
}
function routeRestart(slug, sid, cwd) {
  const dest = window.getOpenIn ? window.getOpenIn() : 'embedded'
  if (dest === 'terminal') window.api.restoreSession(slug, sid)
  else if (window.toggleEmbeddedTerminal) { toListForEmbedded(); window.toggleEmbeddedTerminal(sid || slug, cwd, slug) }
}
// Pick the right verb for a session (Resume when possible, else Restart from notes)
// and route per the destination pref. Used by Enter + hover quick-actions.
function openSessionDefault(s) {
  if (canResume(s)) { routeResume(s.sessionId, s.cwd || ''); return true }
  const slug = slugOf(s)
  if (slug) { routeRestart(slug, s.sessionId || '', s.cwd || ''); return true }
  return false
}
window.routeResume = routeResume
window.routeRestart = routeRestart
window.openSessionDefault = openSessionDefault

function installDelegatedHandlers() {
  if (delegationInstalled) return
  delegationInstalled = true
  document.body.addEventListener('click', e => {
    const url = e.target.closest('.pill[data-url], .ticket-chip[data-url]')
    if (url) { window.api.openExternal(url.dataset.url); return }

    const infoBtn = e.target.closest('[data-info-pop]')
    if (infoBtn) {
      e.stopPropagation()
      if (document.getElementById('info-pop')) closeInfoPopover()   // re-click toggles closed
      else openInfoPopover(infoBtn)
      return
    }

    const prEdit = e.target.closest('[data-pr-edit]')
    if (prEdit) {
      e.stopPropagation()
      if (document.getElementById('pr-editor')) { closePrEditor(); return }
      const sel = (window._lastSessions || []).find(x => sessionKey(x) === window._lastSelectedKey)
      openPrEditor(prEdit, prEdit.dataset.prEdit, (sel && sel.prLink) || '')
      return
    }

    // ── Open actions (Option A) ──
    const destSeg = e.target.closest('[data-open-dest]')
    if (destSeg && window.setOpenIn) {
      window.setOpenIn(destSeg.dataset.openDest)
      const sel = (window._lastSessions || []).find(x => sessionKey(x) === window._lastSelectedKey)
      if (sel && window.renderDetailPanel) renderDetailPanel(sel, activeTab)   // refresh active segment + routing
      return
    }
    const resumeEl = e.target.closest('[data-open-resume]')
    if (resumeEl) {
      e.stopPropagation()
      routeResume(resumeEl.dataset.session, resumeEl.dataset.cwd || '')
      return
    }
    const restartEl = e.target.closest('[data-open-restart]')
    if (restartEl) {
      e.stopPropagation()
      routeRestart(restartEl.dataset.restoreSlug, restartEl.dataset.restoreSid || '', restartEl.dataset.cwd || '')
      return
    }

    const iterm = e.target.closest('.pill[data-cwd]')
    if (iterm) {
      const sid = iterm.dataset.session
      const open = () => window.api.openInTerminal(iterm.dataset.cwd, sid)
      // Already live (running, or we already hold an embedded terminal)? Opening
      // another instance attaches a second process to the same session — warn first.
      const live = (window.isSessionLive && window.isSessionLive(sid)) ||
                   (window.hasLiveTerminal && window.hasLiveTerminal(sid))
      if (live) {
        warnAlreadyRunning(sid, `"${window.sessionNameFor(sid)}" is already running — you likely have it open in a terminal. Resuming opens a second instance on the same session, which can clash.`, open)
      } else { open() }
      return
    }

    const folder = e.target.closest('[data-folder]')
    if (folder) { window.api.openPath(folder.dataset.folder); return }

    const reopen = e.target.closest('.pill[data-restore-slug]')
    if (reopen) { window.api.restoreSession(reopen.dataset.restoreSlug, reopen.dataset.restoreSid || ''); return }

    const term = e.target.closest('.terminal-toggle-btn')
    if (term && window.toggleEmbeddedTerminal) {
      const sid = term.dataset.session
      const go = () => window.toggleEmbeddedTerminal(sid, term.dataset.cwd, term.dataset.restartSlug || '')
      // If we already hold this embedded terminal, toggling just reveals/hides it
      // (no new process). Only warn when it's live elsewhere (running, not ours).
      const alreadyEmbedded = window.hasLiveTerminal && window.hasLiveTerminal(sid)
      if (!alreadyEmbedded && window.isSessionLive && window.isSessionLive(sid)) {
        warnAlreadyRunning(sid, `"${window.sessionNameFor(sid)}" is already running — you likely have it open in a terminal. Opening it in the embedded terminal starts a second instance on the same session, which can clash.`, go)
      } else { go() }
      return
    }

    const detach = e.target.closest('.drawer-detach[data-key]')
    if (detach && window.detachSession) { window.detachSession(detach.dataset.key); return }

    // Archive — confirm, then archive_session (moves Closed → Archived). Must come
    // before the card-select handler (it's inside a card); stopPropagation so the
    // card isn't selected by the same click.
    const archive = e.target.closest('.archive-btn[data-archive-notes]')
    if (archive) {
      e.stopPropagation()
      const notes = archive.dataset.archiveNotes
      const name = archive.dataset.archiveName || 'this session'
      if (window.confirmAction) {
        window.confirmAction({
          title: 'Archive session',
          body: `Archive "${name}"? It moves to the Archived tab — you can bring it back later with Restart.`,
          confirmLabel: 'Archive',
        }).then(choice => {
          if (choice !== 'confirm') return
          window.api.archiveSession(notes).then(res => {
            if (res && res.ok) {
              if (window.refreshSessions) window.refreshSessions()
            } else if (window.confirmAction) {
              window.confirmAction({ title: '⚠️ Archive failed', body: (res && res.error) || 'unknown error', confirmLabel: 'OK' })
            }
          })
        })
      }
      return
    }

    // Delete (archived only) — confirm, then move the session folder to the macOS Trash.
    const del = e.target.closest('.delete-btn[data-delete-notes]')
    if (del) {
      e.stopPropagation()
      const notes = del.dataset.deleteNotes
      const name = del.dataset.deleteName || 'this session'
      const id = del.dataset.deleteId || ''
      if (window.confirmAction) {
        window.confirmAction({
          title: 'Move to Trash',
          body: `Move "${name}"${id ? ` (${id})` : ''} to the macOS Trash? This removes its session folder from disk — you can still restore it from the Finder.`,
          confirmLabel: 'Move to Trash',
        }).then(choice => {
          if (choice !== 'confirm') return
          window.api.deleteSession(notes).then(res => {
            if (res && res.ok) {
              if (window.refreshSessions) window.refreshSessions()
            } else if (window.confirmAction) {
              window.confirmAction({ title: '⚠️ Delete failed', body: (res && res.error) || 'unknown error', confirmLabel: 'OK' })
            }
          })
        })
      }
      return
    }

    // Open the board-column picker for the selected session (from the detail actions).
    const boardMenu = e.target.closest('[data-board-menu]')
    if (boardMenu && window.CSMBoard) {
      e.stopPropagation()
      if (document.getElementById('board-menu')) closeBoardMenu()   // re-click toggles closed
      else openBoardMenu(boardMenu, boardMenu.dataset.boardMenu)
      return
    }

    // Pin toggle — must come before the card-select handler (it's inside a card).
    const pin = e.target.closest('.pin-btn[data-pin-key]')
    if (pin && window.togglePin) { e.stopPropagation(); window.togglePin(pin.dataset.pinKey); return }

    const space = e.target.closest('.space-header[data-space]')
    if (space) {
      const sp = space.dataset.space
      const nowCollapsed = !collapsedSpaces.has(sp)
      if (nowCollapsed) collapsedSpaces.add(sp)
      else collapsedSpaces.delete(sp)
      const chevron = space.querySelector('.space-chevron')
      const sessionsEl = space.parentElement && space.parentElement.querySelector('.space-sessions')
      if (chevron) chevron.classList.toggle('collapsed', nowCollapsed)
      if (sessionsEl) sessionsEl.classList.toggle('collapsed', nowCollapsed)
      return
    }

    const cat = e.target.closest('.category-header[data-category]')
    if (cat) {
      const c = cat.dataset.category
      const nowCollapsed = !collapsedCategories.has(c)
      if (nowCollapsed) collapsedCategories.add(c)
      else collapsedCategories.delete(c)
      // Toggle the DOM directly instead of re-rendering: a re-render here would
      // redraw from the full (unfiltered) session list and flash a search/filter
      // mismatch. The Set keeps the next poll's full render in sync.
      const chevron = cat.querySelector('.category-chevron')
      const sessionsEl = cat.parentElement && cat.parentElement.querySelector('.category-sessions')
      if (chevron) chevron.classList.toggle('collapsed', nowCollapsed)
      if (sessionsEl) sessionsEl.classList.toggle('collapsed', nowCollapsed)
      return
    }

    const card = e.target.closest('.list-card[data-key], .session-card[data-key]')
    if (card && window.selectSession) { window.selectSession(card.dataset.key); return }
  })
}

window.renderAll = renderAll
window.renderDetailPanel = renderDetailPanel
window.installDelegatedHandlers = installDelegatedHandlers
window.updateTabBadges = updateTabBadges
// Back-compat alias for the detached window
window.attachDetailEventListeners = installDelegatedHandlers
