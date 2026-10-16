// Brutus in the app: a bubble (default home) or a docked side panel, and a ⌘K palette
// over either — one conversation shared by all three. The backend streams each run as
// 'brutus-event's; this file only renders them.
;(function () {
  if (!window.api || !window.api.brutusAsk) return
  const M = window.CSMBrutus
  const HOME_KEY = 'csm.brutusHome'
  const LOG_KEY = 'csm.brutusLog'
  // A question typed and not sent: kept across a fold, a re-render and a restart.
  const DRAFT_KEY = 'csm.brutusDraft'
  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d } catch { return d } },
    set(k, v) { try { localStorage.setItem(k, v) } catch {} },
  }
  const state = {
    home: store.get(HOME_KEY, 'bubble') === 'side' ? 'side' : 'bubble',
    homeOpen: false, palette: false, running: false, stopping: false,
    log: (() => { try { return JSON.parse(store.get(LOG_KEY, '[]')) } catch { return [] } })(),
    steps: [], pendingText: '', memory: 0,
    nudge: null, recap: null, idle: [],
  }
  const name = () => ((window.CSM_CONFIG || {}).assistant || {}).name || 'Brutus'
  // Turned off in Settings: nothing of him is drawn, and ⌘K goes back to the page.
  const enabled = () => ((window.CSM_CONFIG || {}).assistant || {}).enabled !== false
  const sessions = () => (window.CSMBrutusSessions ? window.CSMBrutusSessions() : [])
  const ticketBase = () => (window.CSM_CONFIG && window.CSM_CONFIG.ticketBaseUrl) || ''
  const esc = window.CSMFormatters.escapeHtml
  const saveLog = () => store.set(LOG_KEY, JSON.stringify(state.log.slice(-60)))
  // The palette shortcut as this platform writes it (the handler takes Cmd or Ctrl). Read
  // at render time: settings/shortcuts.js, which sets modKeyLabel, loads after this file.
  const kbd = () => `${window.modKeyLabel || '⌘'}K`
  const say = (text) => { state.log.push({ role: 'error', text }); saveLog(); render() }

  // How big each home is, kept per viewer. Neither grows past half the window's width: he
  // sits beside the work, he does not cover it.
  const SIDE_KEY = 'csm.brutusSideW', BUBBLE_KEY = 'csm.brutusBubble'
  const MIN_W = 320, MIN_H = 360
  const maxW = () => Math.max(MIN_W, Math.floor(window.innerWidth * 0.5))
  const maxH = () => Math.max(MIN_H, window.innerHeight - 100)
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)))
  const size = {
    side: Number(store.get(SIDE_KEY, 400)) || 400,
    bubble: (() => { try { return JSON.parse(store.get(BUBBLE_KEY, 'null')) || { w: 380, h: 560 } } catch { return { w: 380, h: 560 } } })(),
  }
  function applySize(panel) {
    if (!panel) return
    if (panel.classList.contains('v-C')) {
      const w = clamp(size.side, MIN_W, maxW())
      panel.style.width = `${w}px`
      document.documentElement.style.setProperty('--bru-side-w', `${w}px`)
    } else if (panel.classList.contains('v-A')) {
      panel.style.width = `${clamp(size.bubble.w, MIN_W, maxW())}px`
      panel.style.height = `${clamp(size.bubble.h, MIN_H, maxH())}px`
    }
  }
  // Drag a grip: the side panel grows leftwards; the bubble is anchored bottom-right, so
  // its left edge sets the width and its top edge the height. The panel is re-rendered
  // whenever his status refreshes, so the drag works on sizes, and applies them to
  // whichever panel is on screen at each move, never to the element the drag began on.
  const homePanel = () => document.querySelector('.bru-panel.v-A, .bru-panel.v-C')
  function startResize(e, dir) {
    const panel = homePanel()
    if (!panel) return
    e.preventDefault()
    const side = panel.classList.contains('v-C')
    const r = panel.getBoundingClientRect()
    const x0 = e.clientX, y0 = e.clientY
    document.body.classList.add('bru-resizing')
    const move = (ev) => {
      const dx = x0 - ev.clientX, dy = y0 - ev.clientY
      if (side) size.side = clamp(r.width + dx, MIN_W, maxW())
      else {
        if (dir.includes('w')) size.bubble.w = clamp(r.width + dx, MIN_W, maxW())
        if (dir.includes('n')) size.bubble.h = clamp(r.height + dy, MIN_H, maxH())
      }
      applySize(homePanel())
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.body.classList.remove('bru-resizing')
      store.set(SIDE_KEY, String(size.side))
      store.set(BUBBLE_KEY, JSON.stringify(size.bubble))
      if (window.fitActiveTerminal) window.fitActiveTerminal()
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  const I = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    side: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M15 3v18"/></svg>',
    bubble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="16" cy="16" r="2.6" fill="currentColor"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  }
  // His face: the companion picked in Settings → AI Companion, in the state he is in. The
  // small avatars beside each answer stay still, so only the live one moves.
  const pet = () => ((window.CSM_CONFIG || {}).assistant || {}).pet || 'blob'
  const waiting = () => window._waitingCount || 0
  const mood = () => state.running ? 'think' : (state.happyUntil > Date.now() ? 'happy' : (waiting() ? 'wait' : 'rest'))
  // The number of sessions waiting shows once, on the bubble; elsewhere he only looks it.
  const face = (still, badge = false) => window.CSMPets
    ? window.CSMPets.svg(pet(), still ? 'rest' : mood(), { count: badge ? waiting() : 0, still })
    : esc(M.initialOf(name()))
  const av = (cls = 'lg', still = false, badge = false) => `<span class="bru-pet ${cls}">${face(still, badge)}</span>`

  const NM = () => window.CSMNudgeModel
  // Opened or put away: renderer/nudges.js stops keeping it as pending.
  const nudgeDone = () => window.dispatchEvent(new Event('brutus-nudge-done'))
  // A nudge turn carries its stale list, so "want me to list them?" can answer from it.
  function nudgeTurnHTML(t) {
    const list = t.stale && t.stale.length && !t.listed ? `<button type="button" class="bru-nudge-list" data-bru="nudge-list" data-turn="${state.log.indexOf(t)}">${NM().words(t.lang).listAsk}</button>` : ''
    return `<div class="bru-b">${av('', true)}<div class="bru-bt">${M.renderAnswer(t.text, sessions(), ticketBase())}${list}</div></div>`
  }
  function nudgeBubble() {
    if (!state.nudge || state.homeOpen || state.palette) return
    const n = document.createElement('div')
    n.className = `bru-nudge ${state.home === 'side' ? 'under-tb' : ''}`
    n.setAttribute('role', 'status')
    const w = NM().words(state.nudge.lang)
    n.innerHTML = `<div class="bru-nudge-who">${esc(name())}</div><div class="bru-bt">${M.renderAnswer(NM().preview(state.nudge.text, 6, state.nudge.lang), sessions(), ticketBase())}</div>
      <div class="bru-nudge-acts"><button type="button" class="bru-nudge-open" data-bru="nudge-open">${w.open}</button><button type="button" data-bru="nudge-later">${w.later}</button></div>`
    n.addEventListener('click', onClick)
    document.body.appendChild(n)
    anchor(n)
  }
  // Points the bubble's tail at whoever speaks: the avatar, or the titlebar button when docked,
  // with the bubble's right edge kept on screen.
  function anchor(n) {
    const a = document.querySelector(state.home === 'side' ? '#brutus-btn' : '.bru-fab')
    const r = a && a.getBoundingClientRect()
    if (!r || !r.width) return
    const mid = r.left + r.width / 2
    const right = Math.max(12, Math.min(innerWidth - mid - 28, innerWidth - n.offsetWidth - 12))
    n.style.right = `${right}px`
    n.style.setProperty('--tail', `${Math.max(16, Math.min(innerWidth - right - mid, n.offsetWidth - 16))}px`)
    if (state.home === 'side') n.style.top = `${Math.round(r.bottom + 10)}px`
  }
  // The titlebar button moves with the window's width: keep the tail on it.
  window.addEventListener('resize', () => { const n = document.querySelector('.bru-nudge'); if (n) anchor(n) })
  function turnHTML(t) {
    if (t.role === 'brutus' && t.nudge) return nudgeTurnHTML(t)
    if (t.role === 'user') return `<div class="bru-u">${esc(t.text)}</div>`
    if (t.role === 'error') return `<div class="bru-b">${av('', true)}<div class="bru-bt bru-err">${esc(t.text)}</div></div>`
    return `<div class="bru-b">${av('', true)}<div class="bru-bt">${t.steps ? `<div class="bru-steps">${I.eye}${esc(t.steps)}</div>` : ''}${M.renderAnswer(t.text, sessions(), ticketBase())}</div></div>`
  }
  function liveHTML() {
    if (!state.running) return ''
    const last = state.steps[state.steps.length - 1]
    const label = state.stopping ? 'Stopping' : last ? M.stepLabel(last, sessions()) : 'Thinking'
    const text = state.pendingText ? M.renderAnswer(state.pendingText, sessions(), ticketBase()) : '<div class="bru-think"><i></i><i></i><i></i></div><div class="bru-skel" style="width:88%"></div><div class="bru-skel" style="width:64%"></div>'
    return `<div class="bru-b">${av()}<div class="bru-bt"><div class="bru-steps">${I.eye}${esc(label)}…</div>${text}</div></div>`
  }
  function emptyHTML() {
    const q = ["What's waiting on me?", 'What did I do yesterday?', 'Which sessions went stale?', 'What did I decide last week?']
    return `<div class="bru-empty">${av('xl')}<h4>Hi, I'm ${esc(name())}.</h4><p>I keep an eye on every session and remember what you tell me. Ask me anything about your work.</p><div class="bru-sugg">${q.map(x => `<button type="button">${esc(x)}</button>`).join('')}</div></div>`
  }
  function bodyHTML(palette) {
    if (!state.log.length && !state.running) return emptyHTML()
    let turns = state.log
    let lead = ''
    if (palette && turns.length > 2) { lead = `<div class="bru-earlier">↑ ${turns.length - 2} earlier messages</div>`; turns = turns.slice(-2) }
    return lead + turns.map(turnHTML).join('') + liveHTML()
  }
  const head = () => `<div class="bru-head">${av()}<div><div class="bru-title">${esc(name())}</div><div class="bru-sub">${quietUntil() ? `Quiet until ${esc(hhmm(quietUntil()))} · <a data-bru="unsnooze">Resume</a>` : state.memory === null ? 'Could not read his memory' : state.memory ? `Remembers <a data-bru="memory">${state.memory} thing${state.memory > 1 ? 's' : ''}</a> about your work` : 'Nothing remembered yet'}</div></div><span class="bru-sp"></span>${state.home === 'side' ? `<button class="bru-ib" data-bru="to-bubble" title="Back to the bubble">${I.bubble}</button>` : `<button class="bru-ib" data-bru="to-side" title="Move to the side panel">${I.side}</button>`}<button class="bru-ib${quietUntil() ? ' on' : ''}" data-bru="snooze" title="${quietUntil() ? `Quiet until ${hhmm(quietUntil())}` : 'Pause his reminders'}">${I.moon}</button><button class="bru-ib" data-bru="reset" title="New conversation (keeps his memory)">${I.plus}</button><button class="bru-ib" data-bru="close" title="Close (Esc)">${I.x}</button></div>`
  const foot = (big) => `<div class="bru-foot"><div class="bru-in"><input maxlength="8000" placeholder="${big ? `Ask ${esc(name())} anything about your sessions…` : `Ask ${esc(name())}…`}" ${state.running ? 'disabled' : ''}/>${state.running ? `<button class="bru-send" data-bru="stop" title="Stop" ${state.stopping ? 'disabled' : ''}>${I.stop}</button>` : `<button class="bru-send" data-bru="send" title="Send">${I.send}</button>`}</div><div class="bru-hint"><span>Enter to send · Esc to close</span><span>Writes only his memory and his docs</span></div></div>`

  function render() {
    // A panel already on screen is re-rendered in place: only a panel that is opening
    // plays its entrance, or every answer would slide it in again.
    const wasHome = !!document.querySelector('.bru-panel.v-A, .bru-panel.v-C')
    const wasPalette = !!document.querySelector('.bru-panel.v-B')
    document.querySelectorAll('.bru-panel,.bru-scrim,.bru-fab,.bru-nudge').forEach(e => e.remove())
    const tb = document.getElementById('brutus-btn')
    if (!enabled()) {
      document.querySelectorAll('.bru-toast,.bru-menu').forEach(e => e.remove())
      if (tb) tb.hidden = true
      state.homeOpen = false; state.palette = false
      document.body.classList.remove('bru-docked')
      return
    }
    if (tb) {
      tb.hidden = state.home !== 'side'
      tb.classList.toggle('on', state.homeOpen)
      const tbFace = tb.querySelector('.bru-pet'); if (tbFace) tbFace.innerHTML = face(false, true)
      tb.querySelector('.bru-tb-name').textContent = name()
    }
    document.body.classList.toggle('bru-docked', state.home === 'side' && state.homeOpen)
    if (state.home === 'bubble') {
      const fab = document.createElement('button')
      fab.className = 'bru-fab'; fab.type = 'button'
      fab.title = `${name()} (${kbd()} to ask quickly) — right-click for options`
      fab.setAttribute('aria-label', name())
      fab.innerHTML = av('xl', false, true)
      fab.onclick = () => { state.homeOpen = !state.homeOpen; render() }
      fab.oncontextmenu = (e) => { e.preventDefault(); menu(e.clientX, e.clientY) }
      document.body.appendChild(fab)
    }
    if (state.homeOpen) {
      const grips = state.home === 'side' ? '<div class="bru-rs w"></div>' : '<div class="bru-rs nw"></div><div class="bru-rs n"></div><div class="bru-rs w"></div>'
      const panel = mount(`bru-panel ${state.home === 'side' ? 'v-C docked' : 'v-A'}`, grips + head() + `<div class="bru-body">${bodyHTML(false)}</div>` + foot(false))
      applySize(panel)
      if (wasHome) panel.classList.add('bru-still')
    }
    if (state.palette) {
      const sc = document.createElement('div'); sc.className = 'bru-scrim'
      sc.onclick = () => { state.palette = false; render() }
      document.body.appendChild(sc)
      const p = mount('bru-panel v-B', foot(true) + `<div class="bru-body">${bodyHTML(true)}${state.log.length ? `<div class="bru-cont" data-bru="continue">Continue in the ${state.home === 'side' ? 'side panel' : 'bubble'} ↗</div>` : ''}</div>`)
      if (wasPalette) p.classList.add('bru-still')
      p.querySelector('input')?.focus()
    }
    nudgeBubble()
  }
  function mount(cls, html) {
    const p = document.createElement('div')
    p.className = cls; p.innerHTML = html
    document.body.appendChild(p)
    const b = p.querySelector('.bru-body'); if (b) b.scrollTop = b.scrollHeight
    p.addEventListener('click', onClick)
    const inp = p.querySelector('input')
    if (inp) {
      // Every render rebuilds the input, so it takes back what was typed.
      inp.value = store.get(DRAFT_KEY, '')
      inp.addEventListener('input', () => store.set(DRAFT_KEY, inp.value))
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(inp.value) } })
    }
    return p
  }
  function onClick(e) {
    const chip = e.target.closest('[data-brutus-session]')
    if (chip) return goTo(chip.dataset.brutusSession)
    const refA = e.target.closest('[data-bru-url]')
    if (refA) { window.api.openExternal(refA.dataset.bruUrl); return }
    const doc = e.target.closest('[data-bru-doc]')
    if (doc) {
      window.api.brutusOpenDoc(doc.dataset.bruDoc).then(r => { if (r && !r.ok) say(`Could not open ${doc.dataset.bruDoc}: ${r.error}`) })
      return
    }
    const sugg = e.target.closest('.bru-sugg button')
    if (sugg) return send(sugg.textContent)
    const a = e.target.closest('[data-bru]'); if (!a) return
    const k = a.dataset.bru
    if (k === 'nudge-open') {
      const n = state.nudge; state.nudge = null
      state.log.push({ role: 'brutus', nudge: true, text: n.text, stale: n.stale || [], lang: n.lang }); saveLog()
      state.recap = n.text; state.homeOpen = true; render(); nudgeDone(); return
    }
    if (k === 'nudge-later') { state.nudge = null; render(); nudgeDone(); return }
    if (k === 'nudge-list') {
      const t = state.log[Number(a.dataset.turn)]; if (!t) return
      t.listed = true
      state.log.push({ role: 'brutus', text: NM().staleLines(t.stale, t.lang) }); saveLog(); render(); return
    }
    if (k === 'close') { state.homeOpen = false; render() }
    else if (k === 'send') send(a.closest('.bru-panel').querySelector('input').value)
    else if (k === 'stop') stop()
    else if (k === 'reset') reset()
    else if (k === 'snooze') snoozeMenu(a)
    else if (k === 'unsnooze') window.CSMNudges && window.CSMNudges.snooze(null)
    else if (k === 'memory') openMemory()
    else if (k === 'to-bubble') setHome('bubble')
    else if (k === 'to-side') setHome('side')
    else if (k === 'continue') { state.palette = false; state.homeOpen = true; render() }
  }
  async function send(text) {
    const t = String(text || '').trim()
    if (!t || state.running) return
    // A suggestion clicked while a question was half typed leaves that question in place.
    if (store.get(DRAFT_KEY, '').trim() === t) store.set(DRAFT_KEY, '')
    state.log.push({ role: 'user', text: t }); saveLog()
    state.running = true; state.stopping = false; state.steps = []; state.pendingText = ''
    render()
    // The reply to a nudge goes with the nudge: his conversation does not contain it.
    const msg = state.recap ? NM().withRecap(state.recap, t) : t
    state.recap = null
    try { await window.api.brutusAsk(msg) }
    catch (e) { finish({ kind: 'error', message: String(e) }) }
  }
  // Stop is received even before claude has started (the backend is still preparing):
  // the run ends on "Stopped." as soon as it would spawn. Say so meanwhile.
  async function stop() {
    if (!state.running || state.stopping) return
    const ok = await window.api.brutusCancel()
    if (ok && state.running) { state.stopping = true; render() }
  }
  function finish(ev) {
    if (!state.running) return
    state.running = false; state.stopping = false
    const waiters = state.idle.splice(0); setTimeout(() => waiters.forEach(cb => cb()), 0)
    // A moment of joy when an answer lands, then back to rest.
    if (ev.kind === 'done' && !ev.is_error) { state.happyUntil = Date.now() + 2400; setTimeout(render, 2500) }
    if (ev.kind === 'error' || (ev.kind === 'done' && ev.is_error)) {
      state.log.push({ role: 'error', text: ev.message || ev.result || 'Something went wrong.' })
    } else {
      const text = state.pendingText || ev.result || ''
      state.log.push({ role: 'brutus', text, steps: M.stepsLine(state.steps, sessions()) })
    }
    state.steps = []; state.pendingText = ''
    saveLog(); refresh()
  }
  window.api.onEvent('brutus-event', (ev) => {
    if (!ev || !state.running) return
    if (ev.kind === 'step') { state.steps.push(ev); render() }
    else if (ev.kind === 'text') { state.pendingText += (state.pendingText ? '\n\n' : '') + ev.text; render() }
    else if (ev.kind === 'done' || ev.kind === 'error') finish(ev)
  })
  // A reset that failed leaves the saved conversation in place, and the next message would
  // resume it: keep the chat, and say why.
  async function reset() {
    if (state.running) return
    const r = await window.api.brutusReset()
    if (!r || !r.ok) return say(`Could not start a new conversation: ${(r && r.error) || 'unknown error'}`)
    state.log = []; saveLog(); render()
  }
  async function openMemory() {
    const r = await window.api.brutusOpenMemory()
    if (!r || !r.ok) say(`Could not open his memory: ${(r && r.error) || 'unknown error'}`)
  }
  // A session chip opens that session, the way a click on its card does, and shows where
  // it is in the list. A name no session has falls back to finding the card by its text.
  function goTo(n) {
    const s = sessions().find(x => (x.name || '') === n)
    const key = s ? (s.notesPath || s.sessionId || s.name) : ''
    if (key && window.selectSession && window._lastSelectedKey !== key) window.selectSession(key)
    if (key && window.revealSelected) window.revealSelected()
    const cards = [...document.querySelectorAll('#panel-list .list-card[data-key]')]
    const el = (key && cards.find(c => c.dataset.key === key)) || cards.find(c => (c.textContent || '').includes(n))
    if (!el) return
    el.classList.add('bru-flash'); setTimeout(() => el.classList.remove('bru-flash'), 1300)
  }
  const quietUntil = () => (window.CSMNudges && window.CSMNudges.snoozedUntil ? window.CSMNudges.snoozedUntil() : null)
  const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  // Tomorrow at 05:00, when the morning recap may start.
  const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(5, 0, 0, 0); return d.getTime() }
  function snoozeMenu(anchor) {
    document.querySelector('.bru-menu')?.remove()
    const m = document.createElement('div'); m.className = 'bru-menu'
    const opts = [['30 minutes', 30 * 60_000], ['1 hour', 60 * 60_000], ['2 hours', 120 * 60_000], ['Until tomorrow', 0]]
    m.innerHTML = `<div class="bru-menu-head">Pause his reminders</div>${opts.map(([l], i) => `<button type="button" data-i="${i}">${l}</button>`).join('')}${quietUntil() ? '<div class="sep"></div><button type="button" data-i="resume">Resume now</button>' : ''}`
    document.body.appendChild(m)
    const r = anchor.getBoundingClientRect(), mr = m.getBoundingClientRect()
    m.style.left = Math.max(8, Math.min(r.right - mr.width, innerWidth - mr.width - 8)) + 'px'
    m.style.top = Math.min(r.bottom + 6, innerHeight - mr.height - 8) + 'px'
    const done = () => { m.remove(); removeEventListener('mousedown', out, true) }
    const out = (e) => { if (!m.contains(e.target)) done() }
    addEventListener('mousedown', out, true)
    m.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-i]'); if (!btn || !window.CSMNudges) return
      done()
      const i = btn.dataset.i
      window.CSMNudges.snooze(i === 'resume' ? null : (opts[i][1] ? Date.now() + opts[i][1] : tomorrow()))
    })
  }
  function menu(x, y) {
    document.querySelector('.bru-menu')?.remove()
    const m = document.createElement('div'); m.className = 'bru-menu'
    m.innerHTML = `<button type="button" data-a="side">Move ${esc(name())} to the side panel</button><div class="sep"></div><button type="button" data-a="set">${esc(name())} settings…</button>`
    document.body.appendChild(m)
    const r = m.getBoundingClientRect()
    m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'
    m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px'
    const done = () => { m.remove(); removeEventListener('mousedown', out, true) }
    const out = (e) => { if (!m.contains(e.target)) done() }
    addEventListener('mousedown', out, true)
    m.querySelector('[data-a=side]').onclick = () => { done(); setHome('side'); toast() }
    m.querySelector('[data-a=set]').onclick = () => { done(); window.openSettingsTab && window.openSettingsTab('assistant') }
  }
  function toast() {
    document.querySelector('.bru-toast')?.remove()
    const t = document.createElement('div'); t.className = 'bru-toast'
    t.innerHTML = `<span>${esc(name())} now lives in the side panel.</span><a data-a="undo">Undo</a><a data-a="set">Settings</a>`
    document.body.appendChild(t)
    t.querySelector('[data-a=undo]').onclick = () => { t.remove(); setHome('bubble') }
    t.querySelector('[data-a=set]').onclick = () => { t.remove(); window.openSettingsTab && window.openSettingsTab('assistant') }
    setTimeout(() => t.remove(), 6000)
  }
  function setHome(h) {
    state.home = h === 'side' ? 'side' : 'bubble'
    store.set(HOME_KEY, state.home)
    state.homeOpen = true; render()
  }
  async function refresh() {
    if (!enabled()) {
      // Off means he does not run, including the answer he was in the middle of.
      if (state.running) window.api.brutusCancel()
      render(); return
    }
    const s = await window.api.brutusStatus()
    // null: the file exists but could not be read, which is not "nothing remembered".
    state.memory = s.memoryCount === null ? null : (s.memoryCount || 0)
    render()
  }
  document.getElementById('brutus-btn')?.addEventListener('click', () => { state.homeOpen = !state.homeOpen; render() })
  // The bubble folds on a click anywhere else, like a popover. The side panel stays:
  // it is docked beside the work, not over it. The ⌘K palette has its own scrim.
  document.addEventListener('mousedown', (e) => {
    if (state.home !== 'bubble' || !state.homeOpen || state.palette) return
    if (document.body.classList.contains('bru-resizing')) return
    const t = e.target
    if (!t.closest || t.closest('.bru-panel, .bru-fab, .bru-menu, dialog, .bru-toast')) return
    state.homeOpen = false
    render()
  }, true)
  // One delegated listener: grips come and go with every render.
  document.addEventListener('mousedown', (e) => {
    const g = e.target.closest && e.target.closest('.bru-rs')
    if (g && e.button === 0) startResize(e, [...g.classList].find(c => c !== 'bru-rs') || '')
  })
  document.addEventListener('keydown', (e) => {
    if (!enabled()) return
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); state.palette = !state.palette; render(); return }
    if (e.key !== 'Escape') return
    if (state.palette) { state.palette = false; render() } else if (state.homeOpen && document.activeElement?.closest('.bru-panel')) { state.homeOpen = false; render() }
  })
  // A pause set or lifted redraws his header, which shows until when he keeps quiet.
  window.addEventListener('brutus-snooze', () => render())
  window.CSMBrutusUI = {
    open: () => { state.homeOpen = true; render() }, close: () => { state.homeOpen = false; render() },
    palette: () => { state.palette = true; render() }, setHome, refresh,
    // A nudge that arrives while another is still unread joins it: replacing it would lose
    // reminders that were already recorded as said.
    showNudge: (n) => {
      if (!enabled() || !n || !n.text) return
      const prev = state.nudge
      state.nudge = { text: prev ? `${prev.text}\n\n${n.text}` : n.text, stale: n.stale || (prev && prev.stale) || [], lang: n.lang === 'fr' ? 'fr' : 'en' }
      render()
    },
    // The nudge on screen, merged as shown, so renderer/nudges.js can keep it until it is seen.
    pendingNudge: () => (state.nudge ? { ...state.nudge } : null),
    onIdle: (cb) => { if (!state.running) cb(); else state.idle.push(cb) },
    lastUserText: () => { const u = [...state.log].reverse().find(t => t.role === 'user'); return u ? u.text : '' },
  }
  refresh()
})()
