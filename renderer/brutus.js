// Brutus in the app: a bubble (default home) or a docked side panel, and a ⌘K palette
// over either — one conversation shared by all three. The backend streams each run as
// 'brutus-event's; this file only renders them. See docs/superpowers/specs/2026-09-23-brutus-design.md.
;(function () {
  if (!window.api || !window.api.brutusAsk) return
  const M = window.CSMBrutus
  const HOME_KEY = 'csm.brutusHome'
  const LOG_KEY = 'csm.brutusLog'
  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d } catch { return d } },
    set(k, v) { try { localStorage.setItem(k, v) } catch {} },
  }
  const state = {
    home: store.get(HOME_KEY, 'bubble') === 'side' ? 'side' : 'bubble',
    homeOpen: false, palette: false, running: false, stopping: false,
    log: (() => { try { return JSON.parse(store.get(LOG_KEY, '[]')) } catch { return [] } })(),
    steps: [], pendingText: '', memory: 0,
  }
  const name = () => ((window.CSM_CONFIG || {}).assistant || {}).name || 'Brutus'
  const sessions = () => (window.CSMBrutusSessions ? window.CSMBrutusSessions() : [])
  const esc = window.CSMFormatters.escapeHtml
  const saveLog = () => store.set(LOG_KEY, JSON.stringify(state.log.slice(-60)))
  const say = (text) => { state.log.push({ role: 'error', text }); saveLog(); render() }

  const I = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    bubble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="16" cy="16" r="2.6" fill="currentColor"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  }
  const av = (cls = 'lg') => `<span class="bru-av ${cls}">${esc(M.initialOf(name()))}</span>`

  function turnHTML(t) {
    if (t.role === 'user') return `<div class="bru-u">${esc(t.text)}</div>`
    if (t.role === 'error') return `<div class="bru-b">${av()}<div class="bru-bt bru-err">${esc(t.text)}</div></div>`
    return `<div class="bru-b">${av()}<div class="bru-bt">${t.steps ? `<div class="bru-steps">${I.eye}${esc(t.steps)}</div>` : ''}${M.renderAnswer(t.text, sessions())}</div></div>`
  }
  function liveHTML() {
    if (!state.running) return ''
    const last = state.steps[state.steps.length - 1]
    const label = state.stopping ? 'Stopping' : last ? M.stepLabel(last, sessions()) : 'Thinking'
    const text = state.pendingText ? M.renderAnswer(state.pendingText, sessions()) : '<div class="bru-think"><i></i><i></i><i></i></div><div class="bru-skel" style="width:88%"></div><div class="bru-skel" style="width:64%"></div>'
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
  const head = () => `<div class="bru-head">${av()}<div><div class="bru-title">${esc(name())}</div><div class="bru-sub">${state.memory === null ? 'Could not read his memory' : state.memory ? `Remembers <a data-bru="memory">${state.memory} thing${state.memory > 1 ? 's' : ''}</a> about your work` : 'Nothing remembered yet'}</div></div><span class="bru-sp"></span>${state.home === 'side' ? `<button class="bru-ib" data-bru="to-bubble" title="Back to the bubble">${I.bubble}</button>` : ''}<button class="bru-ib" data-bru="reset" title="New conversation (keeps his memory)">${I.plus}</button><button class="bru-ib" data-bru="close" title="Close (Esc)">${I.x}</button></div>`
  const foot = (big) => `<div class="bru-foot"><div class="bru-in"><input maxlength="8000" placeholder="${big ? `Ask ${esc(name())} anything about your sessions…` : `Ask ${esc(name())}…`}" ${state.running ? 'disabled' : ''}/>${state.running ? `<button class="bru-send" data-bru="stop" title="Stop" ${state.stopping ? 'disabled' : ''}>${I.stop}</button>` : `<button class="bru-send" data-bru="send" title="Send">${I.send}</button>`}</div><div class="bru-hint"><span>Enter to send · Esc to close</span><span>Writes only his own memory</span></div></div>`

  function render() {
    document.querySelectorAll('.bru-panel,.bru-scrim,.bru-fab').forEach(e => e.remove())
    const tb = document.getElementById('brutus-btn')
    if (tb) {
      tb.hidden = state.home !== 'side'
      tb.classList.toggle('on', state.homeOpen)
      tb.querySelector('.bru-av').textContent = M.initialOf(name())
      tb.querySelector('.bru-tb-name').textContent = name()
    }
    document.body.classList.toggle('bru-docked', state.home === 'side' && state.homeOpen)
    if (state.home === 'bubble') {
      const fab = document.createElement('button')
      fab.className = 'bru-fab'; fab.type = 'button'
      fab.title = `${name()} (⌘K to ask quickly) — right-click for options`
      fab.setAttribute('aria-label', name())
      fab.innerHTML = av('xl')
      fab.onclick = () => { state.homeOpen = !state.homeOpen; render() }
      fab.oncontextmenu = (e) => { e.preventDefault(); menu(e.clientX, e.clientY) }
      document.body.appendChild(fab)
    }
    if (state.homeOpen) mount(`bru-panel ${state.home === 'side' ? 'v-C docked' : 'v-A'}`, head() + `<div class="bru-body">${bodyHTML(false)}</div>` + foot(false))
    if (state.palette) {
      const sc = document.createElement('div'); sc.className = 'bru-scrim'
      sc.onclick = () => { state.palette = false; render() }
      document.body.appendChild(sc)
      const p = mount('bru-panel v-B', foot(true) + `<div class="bru-body">${bodyHTML(true)}${state.log.length ? `<div class="bru-cont" data-bru="continue">Continue in the ${state.home === 'side' ? 'side panel' : 'bubble'} ↗</div>` : ''}</div>`)
      p.querySelector('input')?.focus()
    }
  }
  function mount(cls, html) {
    const p = document.createElement('div')
    p.className = cls; p.innerHTML = html
    document.body.appendChild(p)
    const b = p.querySelector('.bru-body'); if (b) b.scrollTop = b.scrollHeight
    p.addEventListener('click', onClick)
    const inp = p.querySelector('input')
    if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(inp.value) } })
    return p
  }
  function onClick(e) {
    const chip = e.target.closest('[data-brutus-session]')
    if (chip) return flash(chip.dataset.brutusSession)
    const sugg = e.target.closest('.bru-sugg button')
    if (sugg) return send(sugg.textContent)
    const a = e.target.closest('[data-bru]'); if (!a) return
    const k = a.dataset.bru
    if (k === 'close') { state.homeOpen = false; render() }
    else if (k === 'send') send(a.closest('.bru-panel').querySelector('input').value)
    else if (k === 'stop') stop()
    else if (k === 'reset') reset()
    else if (k === 'memory') openMemory()
    else if (k === 'to-bubble') setHome('bubble')
    else if (k === 'continue') { state.palette = false; state.homeOpen = true; render() }
  }
  async function send(text) {
    const t = String(text || '').trim()
    if (!t || state.running) return
    state.log.push({ role: 'user', text: t }); saveLog()
    state.running = true; state.stopping = false; state.steps = []; state.pendingText = ''
    render()
    try { await window.api.brutusAsk(t) }
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
  function flash(n) {
    const el = [...document.querySelectorAll('#panel-list .list-card[data-key]')].find(c => (c.textContent || '').includes(n))
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.add('bru-flash'); setTimeout(() => el.classList.remove('bru-flash'), 1300)
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
    const s = await window.api.brutusStatus()
    // null: the file exists but could not be read, which is not "nothing remembered".
    state.memory = s.memoryCount === null ? null : (s.memoryCount || 0)
    render()
  }
  document.getElementById('brutus-btn')?.addEventListener('click', () => { state.homeOpen = !state.homeOpen; render() })
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); state.palette = !state.palette; render(); return }
    if (e.key !== 'Escape') return
    if (state.palette) { state.palette = false; render() } else if (state.homeOpen && document.activeElement?.closest('.bru-panel')) { state.homeOpen = false; render() }
  })
  window.CSMBrutusUI = {
    open: () => { state.homeOpen = true; render() }, close: () => { state.homeOpen = false; render() },
    palette: () => { state.palette = true; render() }, setHome, refresh,
  }
  refresh()
})()
