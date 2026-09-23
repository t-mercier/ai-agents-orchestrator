// Throwaway UI demo for Brutus — four placements of the same conversation, over the real
// dashboard. Nothing here ships; the demo bar at the bottom-left is not part of any proposal.
(() => {
  const VARIANTS = {
    A: { name: 'Bubble', note: 'Always one click away, bottom-right. Familiar (Intercom), but it covers the corner of the list.' },
    B: { name: 'Palette', note: '⌘K, ask, read, Esc. Fast and keyboard-first; the conversation is secondary.' },
    C: { name: 'Side panel', note: 'Docked on the right, stays open while you work. Best for a long back-and-forth.' },
    D: { name: 'Popover', note: 'Drops from the titlebar button, like Filter. The literal "small pop-up".' },
  }

  const css = `
  .bru-av { display:inline-grid; place-items:center; width:22px; height:22px; border-radius:50%;
    background: linear-gradient(135deg, var(--accent), #5fb8a8); color:#fff; font:800 11px/1 var(--font);
    flex:none; box-shadow: 0 0 0 1px rgba(var(--tint),.08) inset; }
  .bru-av.lg { width:28px; height:28px; font-size:13px; }
  .bru-av.xl { width:48px; height:48px; font-size:20px; }
  .bru-tb { display:inline-flex; align-items:center; gap:7px; font:600 11px var(--font); color:var(--text-primary);
    background: rgba(var(--tint),.06); border:.5px solid rgba(var(--tint),.14); border-radius:7px; padding:3px 9px 3px 4px;
    cursor:pointer; -webkit-app-region:no-drag; }
  .bru-tb:hover, .bru-tb.on { background: rgba(var(--accent-rgb),.16); border-color: rgba(var(--accent-rgb),.5); }
  .bru-tb .bru-av { width:18px; height:18px; font-size:9.5px; }
  .bru-kbd { font:500 10px var(--font); color:var(--text-tertiary); border:.5px solid rgba(var(--tint),.18);
    border-radius:4px; padding:0 4px; margin-left:2px; }

  .bru-panel { position:fixed; z-index:900; display:flex; flex-direction:column; background:var(--surface-modal);
    border:.5px solid rgba(var(--tint),.12); box-shadow:var(--shadow-lg); color:var(--text-primary);
    font-family:var(--font); overflow:hidden; }
  .bru-head { display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:.5px solid rgba(var(--tint),.08); }
  .bru-title { font:700 13px var(--font); }
  .bru-sub { font:500 11px var(--font); color:var(--text-tertiary); }
  .bru-sub a { color:var(--text-secondary); text-decoration:none; border-bottom:1px dotted rgba(var(--tint),.3); cursor:pointer; }
  .bru-sp { flex:1; }
  .bru-ib { width:26px; height:26px; display:grid; place-items:center; border-radius:6px; border:0; background:transparent;
    color:var(--text-secondary); cursor:pointer; }
  .bru-ib:hover { background:rgba(var(--tint),.08); color:var(--text-primary); }
  .bru-ib svg { width:15px; height:15px; }
  .bru-body { flex:1; overflow:auto; padding:14px; display:flex; flex-direction:column; gap:14px; }
  .bru-u { align-self:flex-end; max-width:82%; background:rgba(var(--accent-rgb),.18); border:.5px solid rgba(var(--accent-rgb),.3);
    padding:8px 11px; border-radius:12px 12px 3px 12px; font-size:12.5px; line-height:1.45; }
  .bru-b { display:flex; gap:9px; align-items:flex-start; }
  .bru-bt { flex:1; font-size:12.5px; line-height:1.55; color:var(--text-primary); }
  .bru-bt p { margin:0 0 6px; } .bru-bt ul { margin:4px 0 6px; padding-left:0; list-style:none; display:flex; flex-direction:column; gap:6px; }
  .bru-bt li { display:block; }
  .bru-steps { font:500 10.5px var(--font); color:var(--text-tertiary); display:flex; align-items:center; gap:6px; margin-bottom:5px; }
  .bru-steps svg { width:11px; height:11px; }
  .bru-chip { vertical-align:1px; margin-right:3px; display:inline-flex; align-items:center; gap:5px; font:600 11.5px var(--font); color:var(--text-primary);
    background:rgba(var(--tint),.07); border:.5px solid rgba(var(--tint),.14); border-radius:6px; padding:1px 7px; cursor:pointer; }
  .bru-chip:hover { border-color: rgba(var(--accent-rgb),.6); background: rgba(var(--accent-rgb),.14); }
  .bru-dot { width:7px; height:7px; border-radius:50%; flex:none; }
  .bru-dot.waiting { background:var(--status-waiting); box-shadow:0 0 0 0 rgba(var(--status-waiting-rgb),.6); animation:bru-pulse 1.6s infinite; }
  .bru-dot.busy { background:var(--status-busy); } .bru-dot.idle { background:var(--status-idle); } .bru-dot.stale { background:rgba(var(--tint),.35); }
  @keyframes bru-pulse { 0%{box-shadow:0 0 0 0 rgba(var(--status-waiting-rgb),.55)} 70%{box-shadow:0 0 0 6px rgba(var(--status-waiting-rgb),0)} 100%{box-shadow:0 0 0 0 rgba(var(--status-waiting-rgb),0)} }
  .bru-meta { color:var(--text-tertiary); font-size:11.5px; }
  .bru-card { border:.5px solid rgba(var(--tint),.14); background:rgba(var(--tint),.04); border-radius:10px; padding:10px 11px; margin-top:4px; }
  .bru-card-h { display:flex; align-items:center; gap:6px; font:600 11.5px var(--font); margin-bottom:7px; }
  .bru-badge { font:700 9px var(--font); letter-spacing:.06em; text-transform:uppercase; color:var(--text-tertiary);
    border:.5px dashed rgba(var(--tint),.3); border-radius:4px; padding:1px 5px; margin-left:auto; }
  .bru-card-l { display:flex; flex-direction:column; gap:5px; margin-bottom:9px; }
  .bru-card-a { display:flex; gap:7px; justify-content:flex-end; }
  .bru-btn { font:600 11px var(--font); border-radius:6px; padding:4px 11px; cursor:pointer; border:.5px solid rgba(var(--tint),.16);
    background:transparent; color:var(--text-secondary); }
  .bru-btn.pri { background:var(--accent); color:var(--on-accent); border-color:transparent; }
  .bru-think { display:flex; align-items:center; gap:6px; }
  .bru-think i { width:5px; height:5px; border-radius:50%; background:var(--text-tertiary); animation:bru-blink 1.2s infinite; }
  .bru-think i:nth-child(2){animation-delay:.2s} .bru-think i:nth-child(3){animation-delay:.4s}
  @keyframes bru-blink { 0%,80%,100%{opacity:.25} 40%{opacity:1} }
  .bru-skel { height:8px; border-radius:4px; background:rgba(var(--tint),.08); margin:6px 0; }
  .bru-foot { border-top:.5px solid rgba(var(--tint),.08); padding:10px 12px 11px; }
  .bru-in { display:flex; align-items:center; gap:8px; background:rgba(var(--tint),.05); border:.5px solid rgba(var(--tint),.14);
    border-radius:10px; padding:7px 7px 7px 11px; }
  .bru-in:focus-within { border-color: rgba(var(--accent-rgb),.6); }
  .bru-in input { flex:1; background:transparent; border:0; outline:0; color:var(--text-primary); font:400 12.5px var(--font); }
  .bru-in input::placeholder { color:var(--text-tertiary); }
  .bru-send { width:26px; height:26px; border-radius:7px; border:0; background:var(--accent); color:var(--on-accent); display:grid; place-items:center; cursor:pointer; }
  .bru-send svg { width:13px; height:13px; }
  .bru-hint { font:500 10px var(--font); color:var(--text-tertiary); margin-top:6px; display:flex; justify-content:space-between; }
  .bru-sugg { display:flex; flex-wrap:wrap; gap:6px; }
  .bru-sugg button { font:500 11.5px var(--font); color:var(--text-secondary); background:rgba(var(--tint),.05);
    border:.5px solid rgba(var(--tint),.14); border-radius:999px; padding:5px 11px; cursor:pointer; }
  .bru-sugg button:hover { color:var(--text-primary); border-color:rgba(var(--accent-rgb),.5); }
  .bru-empty { margin:auto 0; display:flex; flex-direction:column; align-items:center; gap:10px; text-align:center; padding:10px 6px; }
  .bru-empty h4 { font:700 14px var(--font); margin:4px 0 0; } .bru-empty p { font-size:12px; color:var(--text-secondary); margin:0 0 6px; max-width:300px; }
  .bru-flash { outline: 2px solid var(--accent) !important; outline-offset: 2px; border-radius: 8px; transition: outline-color .6s; }

  /* A — bubble */
  .bru-fab { position:fixed; right:20px; bottom:20px; z-index:901; border:0; padding:0; border-radius:50%; cursor:pointer;
    box-shadow: 0 8px 24px rgba(0,0,0,.35), 0 0 0 1px rgba(var(--tint),.1); }
  .v-A { right:20px; bottom:80px; width:380px; height:min(560px, calc(100vh - 140px)); border-radius:16px; transform-origin:bottom right; animation:bru-pop .16s ease-out; }
  /* B — palette */
  .bru-scrim { position:fixed; inset:0; z-index:899; background:rgba(0,0,0,.32); backdrop-filter: blur(2px); }
  .v-B { left:50%; top:13vh; width:min(640px, calc(100vw - 40px)); max-height:66vh; transform:translateX(-50%); border-radius:14px; animation:bru-drop .14s ease-out; }
  .v-B .bru-head { padding:10px 12px; }
  .v-B .bru-in { background:transparent; border:0; padding:4px 2px; } .v-B .bru-in input { font-size:16px; }
  .v-B .bru-earlier { font:500 11px var(--font); color:var(--text-tertiary); text-align:center; cursor:pointer; }
  /* C — side panel */
  .v-C { right:0; top:var(--titlebar-h); bottom:0; width:400px; border-radius:0; border-width:0 0 0 .5px; animation:bru-slide .18s ease-out; }
  /* D — popover */
  .v-D { top:calc(var(--titlebar-h) + 6px); width:400px; height:min(540px, calc(100vh - var(--titlebar-h) - 30px)); border-radius:12px; animation:bru-drop .14s ease-out; }
  @keyframes bru-pop { from{opacity:0; transform:scale(.96)} to{opacity:1; transform:none} }
  @keyframes bru-drop { from{opacity:0; translate:0 -6px} to{opacity:1; translate:0 0} }
  @keyframes bru-slide { from{transform:translateX(24px); opacity:0} to{transform:none; opacity:1} }

  /* demo-only chrome */
  .demo-bar { position:fixed; left:14px; bottom:14px; z-index:1000; display:flex; align-items:center; gap:8px; flex-wrap:wrap; max-width:calc(100vw - 460px);
    font:600 11px var(--font); color:#ddd; background:rgba(20,20,22,.94); border:1px dashed rgba(255,255,255,.28); border-radius:10px; padding:7px 9px; }
  .demo-bar .lbl { color:#9a9a9a; text-transform:uppercase; letter-spacing:.06em; font-size:9.5px; }
  .demo-bar button { font:600 11px var(--font); color:#ccc; background:transparent; border:1px solid rgba(255,255,255,.18); border-radius:6px; padding:3px 8px; cursor:pointer; }
  .demo-bar button.on { background:#fff; color:#111; border-color:#fff; }
  .demo-note { flex-basis:100%; font:500 11px var(--font); color:#aaa; }
  .v-C.docked { box-shadow:none; }
  body.bru-docked .layout { margin-right:400px; transition: margin-right .18s ease-out; }
  .bru-menu { position:fixed; z-index:1002; min-width:230px; background:var(--surface-modal); border:.5px solid rgba(var(--tint),.14);
    border-radius:9px; box-shadow:var(--shadow-md); padding:4px; font:500 12px var(--font); color:var(--text-primary); }
  .bru-menu button { display:flex; align-items:center; gap:8px; width:100%; text-align:left; background:transparent; border:0; color:inherit;
    font:inherit; padding:6px 9px; border-radius:6px; cursor:pointer; }
  .bru-menu button:hover { background:rgba(var(--accent-rgb),.18); }
  .bru-menu .sep { height:.5px; background:rgba(var(--tint),.1); margin:4px 2px; }
  .bru-menu small { color:var(--text-tertiary); font-size:10.5px; margin-left:auto; }
  .bru-toast { position:fixed; z-index:1003; left:50%; bottom:64px; transform:translateX(-50%); background:var(--surface-modal);
    border:.5px solid rgba(var(--tint),.16); box-shadow:var(--shadow-md); border-radius:9px; padding:8px 12px; font:500 12px var(--font);
    color:var(--text-primary); display:flex; gap:10px; align-items:center; animation:bru-drop .14s ease-out; }
  .bru-toast a { color:var(--accent); cursor:pointer; font-weight:600; }
  .bru-cont { font:600 11px var(--font); color:var(--accent); cursor:pointer; text-align:right; margin-top:-4px; }
  .bru-set { position:fixed; z-index:1004; left:50%; top:18vh; transform:translateX(-50%); width:420px; background:var(--surface-modal);
    border:.5px solid rgba(var(--tint),.14); border-radius:12px; box-shadow:var(--shadow-lg); padding:16px 18px; font:500 12.5px var(--font); color:var(--text-primary); }
  .bru-set h5 { font:700 13px var(--font); margin:0 0 4px; } .bru-set p { color:var(--text-secondary); font-size:11.5px; margin:0 0 12px; }
  .bru-set label { display:flex; gap:9px; align-items:flex-start; padding:8px 10px; border:.5px solid rgba(var(--tint),.12); border-radius:8px; margin-bottom:6px; cursor:pointer; }
  .bru-set label.on { border-color: rgba(var(--accent-rgb),.6); background: rgba(var(--accent-rgb),.1); }
  .bru-set label span small { display:block; color:var(--text-tertiary); font-size:11px; margin-top:2px; }
  .bru-set .row { display:flex; justify-content:space-between; align-items:center; margin-top:10px; color:var(--text-secondary); font-size:11.5px; }
  `
  const I = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    bubble: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="16" cy="16" r="2.6" fill="currentColor"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  }
  const chip = (name, st) => `<span class="bru-chip" data-s="${name}"><span class="bru-dot ${st}"></span>${name}</span>`
  const steps = (t) => `<div class="bru-steps">${I.eye}${t}</div>`
  const TURNS = [
    { u: "What's waiting on me?" },
    { b: steps('Read the dashboard · notes of 2 sessions') + `
      <p><strong>Two sessions need you.</strong></p>
      <ul>
        <li>${chip('checkout-redesign', 'waiting')} <span>asks you to pick between two retry strategies</span> <span class="bru-meta">· 12 min ago</span></li>
        <li>${chip('search-suggest', 'waiting')} <span>is blocked on the API contract, your answer since yesterday</span></li>
      </ul>
      <p>${chip('race-on-logout', 'busy')} is still working. ${chip('legacy-export', 'stale')} has had no activity for 9 days.</p>
      <div class="bru-card">
        <div class="bru-card-h">Archive 1 stale session?<span class="bru-badge">V2</span></div>
        <div class="bru-card-l"><span>${chip('legacy-export', 'stale')} <span class="bru-meta">FEAT-1790 · last touched 9 days ago</span></span></div>
        <div class="bru-card-a"><button class="bru-btn">Not now</button><button class="bru-btn pri">Archive</button></div>
      </div>` },
    { u: 'Brief me on race-on-logout before I jump in' },
    { think: 'Reading the notes of race-on-logout' },
  ]
  const turnHTML = (t) => t.u ? `<div class="bru-u">${t.u}</div>`
    : t.think ? `<div class="bru-b"><span class="bru-av lg">B</span><div class="bru-bt">${steps(t.think + '…')}<div class="bru-think"><i></i><i></i><i></i></div><div class="bru-skel" style="width:88%"></div><div class="bru-skel" style="width:64%"></div></div></div>`
    : `<div class="bru-b"><span class="bru-av lg">B</span><div class="bru-bt">${t.b}</div></div>`
  const emptyHTML = () => `<div class="bru-empty"><span class="bru-av xl">B</span><h4>Hi, I'm Brutus.</h4>
    <p>I keep an eye on every session and remember what you tell me. Ask me anything about your work.</p>
    <div class="bru-sugg"><button>What's waiting on me?</button><button>What did I do yesterday?</button><button>Brief me on FEAT-1842</button><button>Which sessions went stale?</button></div></div>`

  const head = (compact) => `<div class="bru-head"><span class="bru-av lg">B</span>
    <div><div class="bru-title">Brutus</div>${compact ? '' : (state.empty ? '<div class="bru-sub">Nothing remembered yet</div>' : '<div class="bru-sub">Remembers <a>14 things</a> about your work</div>')}</div>
    <span class="bru-sp"></span>
    ${state.home === 'side' ? `<button class="bru-ib bru-tobubble" title="Back to the bubble">${I.bubble}</button>` : ''}
    <button class="bru-ib" title="New conversation (keeps his memory)">${I.plus}</button>
    <button class="bru-ib bru-close" title="Close (Esc)">${I.x}</button></div>`
  const foot = (big) => `<div class="bru-foot"><div class="bru-in"><input placeholder="${big ? 'Ask Brutus anything about your sessions…' : 'Ask Brutus…'}" /><button class="bru-send" title="Send">${I.send}</button></div>
    <div class="bru-hint"><span>Enter to send · Esc to close</span><span>Writes only his own memory</span></div></div>`

  function body() {
    if (state.empty && !state.extra.length) return emptyHTML()
    const turns = state.empty ? [] : TURNS
    let all = [...turns, ...state.extra]
    if (state.v === 'B' && all.length > 2) {
      const hidden = all.length - 2
      return `<div class="bru-earlier">↑ ${hidden} earlier messages</div>` + all.slice(-2).map(turnHTML).join('')
    }
    return all.map(turnHTML).join('')
  }


  // home: where Brutus lives (a Settings choice). palette: the ⌘K overlay, on top of either.
  const state = { home: 'bubble', homeOpen: true, palette: false, empty: false, extra: [], settings: false }
  const NOTES = {
    bubble: 'Home = bubble (default). Click the bubble to open; right-click it to move Brutus to the side panel. ⌘K opens the palette from anywhere in the app.',
    side: 'Home = side panel: docked on the right, the dashboard shrinks to make room. The titlebar button toggles it. ⌘K still opens the palette.',
  }

  function render() {
    document.querySelectorAll('.bru-panel,.bru-scrim,.bru-fab').forEach(e => e.remove())
    const tb = document.querySelector('.bru-tb')
    tb.classList.toggle('on', state.homeOpen)
    tb.style.display = state.home === 'bubble' ? 'none' : ''
    document.body.classList.toggle('bru-docked', state.home === 'side' && state.homeOpen)
    if (state.home === 'bubble') {
      const fab = document.createElement('button'); fab.className = 'bru-fab'; fab.title = 'Brutus (⌘K to ask quickly) — right-click for options'
      fab.innerHTML = '<span class="bru-av xl">B</span>'
      fab.onclick = () => { state.homeOpen = !state.homeOpen; render() }
      fab.oncontextmenu = e => { e.preventDefault(); menu(e.clientX, e.clientY) }
      document.body.appendChild(fab)
    }
    if (state.homeOpen) {
      const p = document.createElement('div')
      p.className = `bru-panel ${state.home === 'side' ? 'v-C docked' : 'v-A'}`
      p.innerHTML = `${head(false)}<div class="bru-body">${body(false)}</div>${foot(false)}`
      document.body.appendChild(p); wire(p)
      const b = p.querySelector('.bru-body'); b.scrollTop = b.scrollHeight
    }
    if (state.palette) {
      const sc = document.createElement('div'); sc.className = 'bru-scrim'; sc.onclick = () => { state.palette = false; render() }
      document.body.appendChild(sc)
      const p = document.createElement('div'); p.className = 'bru-panel v-B'
      const where = state.home === 'side' ? 'side panel' : 'bubble'
      p.innerHTML = `${foot(true).replace('bru-foot', 'bru-foot bru-top')}<div class="bru-body">${body(true)}<div class="bru-cont">Continue in the ${where} ↗</div></div>`
      document.body.appendChild(p); wire(p)
      p.querySelector('.bru-cont').onclick = () => { state.palette = false; state.homeOpen = true; render() }
      p.querySelector('input').focus()
    }
    bar()
  }

  function body(palette) {
    if (state.empty && !state.extra.length) return emptyHTML()
    const all = [...(state.empty ? [] : TURNS), ...state.extra]
    if (palette && all.length > 2) return `<div class="bru-earlier">↑ ${all.length - 2} earlier messages — same conversation as the ${state.home === 'side' ? 'side panel' : 'bubble'}</div>` + all.slice(-2).map(turnHTML).join('')
    return all.map(turnHTML).join('')
  }

  function menu(x, y) {
    document.querySelector('.bru-menu')?.remove()
    const m = document.createElement('div'); m.className = 'bru-menu'
    m.innerHTML = `<button data-a="side">Move Brutus to the side panel</button><div class="sep"></div><button data-a="set">Brutus settings…</button>`
    document.body.appendChild(m)
    const r = m.getBoundingClientRect()
    m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'; m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px'
    const done = () => { m.remove(); removeEventListener('mousedown', out, true) }
    const out = e => { if (!m.contains(e.target)) done() }
    addEventListener('mousedown', out, true)
    m.querySelector('[data-a=side]').onclick = () => { done(); state.home = 'side'; state.homeOpen = true; render(); toast() }
    m.querySelector('[data-a=set]').onclick = () => { done(); settings() }
  }

  function toast() {
    document.querySelector('.bru-toast')?.remove()
    const t = document.createElement('div'); t.className = 'bru-toast'
    t.innerHTML = `<span>Brutus now lives in the side panel.</span><a data-a="undo">Undo</a><a data-a="set">Settings</a>`
    document.body.appendChild(t)
    t.querySelector('[data-a=undo]').onclick = () => { t.remove(); state.home = 'bubble'; render() }
    t.querySelector('[data-a=set]').onclick = () => { t.remove(); settings() }
    setTimeout(() => t.remove(), 6000)
  }

  function settings() {
    document.querySelector('.bru-set')?.remove()
    const s = document.createElement('div'); s.className = 'bru-set'
    const opt = (k, t, sub) => `<label class="${state.home === k ? 'on' : ''}" data-k="${k}"><input type="radio" name="bh" ${state.home === k ? 'checked' : ''}/><span>${t}<small>${sub}</small></span></label>`
    s.innerHTML = `<h5>Brutus</h5><p>Settings → Brutus (mock of the section)</p>` +
      opt('bubble', 'Bubble', 'A button in the bottom-right corner. Right-click it to dock him.') +
      opt('side', 'Side panel', 'Docked on the right; the dashboard makes room.') +
      `<div class="row"><span>Quick ask shortcut</span><span class="bru-kbd">⌘K</span></div>` +
      `<div class="row"><span>Memory</span><a style="color:var(--accent);cursor:pointer">Open memory.md (14 entries)</a></div>` +
      `<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="bru-btn pri" data-a="close">Done</button></div>`
    document.body.appendChild(s)
    s.querySelectorAll('label').forEach(l => l.onclick = () => { state.home = l.dataset.k; state.homeOpen = true; render(); settings() })
    s.querySelector('[data-a=close]').onclick = () => s.remove()
  }

  function wire(p) {
    p.querySelectorAll('.bru-close').forEach(b => b.onclick = () => { state.homeOpen = false; render() })
    p.querySelector('.bru-tobubble')?.addEventListener('click', () => { state.home = 'bubble'; state.homeOpen = true; render() })
    p.querySelectorAll('.bru-chip').forEach(c => c.onclick = () => flash(c.dataset.s))
    p.querySelectorAll('.bru-sugg button').forEach(b => b.onclick = () => ask(b.textContent))
    const inp = p.querySelector('input')
    const go = () => { if (inp.value.trim()) ask(inp.value.trim()) }
    inp.onkeydown = e => { if (e.key === 'Enter') go(); if (e.key === 'Escape') { state.palette ? state.palette = false : state.homeOpen = false; render() } }
    p.querySelector('.bru-send').onclick = go
    p.querySelector('.bru-ib[title^="New"]')?.addEventListener('click', () => { state.empty = true; state.extra = []; render() })
  }

  function ask(q) {
    state.extra.push({ u: q }, { think: 'Reading the dashboard' }); render()
    setTimeout(() => {
      state.extra.pop()
      state.extra.push({ b: steps('Read the dashboard · notes of 1 session') + `<p>Here is what I found for <strong>${q.replace(/[<>]/g, '')}</strong> — in the real thing this is Claude Code answering, streamed as it reads.</p><p>${chip('checkout-redesign', 'waiting')} is the one to look at first.</p>` })
      render()
    }, 1400)
  }

  function flash(name) {
    const cands = [...document.querySelectorAll('[class*="card"], [class*="row"], [class*="item"]')]
      .filter(el => !el.closest('.bru-panel') && el.textContent.includes(name))
      .sort((a, b) => a.textContent.length - b.textContent.length)
    const el = cands[0]; if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('bru-flash')
    setTimeout(() => el.classList.remove('bru-flash'), 1300)
  }

  function bar() {
    let b = document.querySelector('.demo-bar')
    if (!b) { b = document.createElement('div'); b.className = 'demo-bar'; document.body.appendChild(b) }
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    b.innerHTML = `<span class="lbl">Brutus demo</span>` +
      `<span class="lbl">Home</span><button data-h="bubble" class="${state.home === 'bubble' ? 'on' : ''}">Bubble</button><button data-h="side" class="${state.home === 'side' ? 'on' : ''}">Side panel</button>` +
      `<button data-p="1">Palette ⌘K</button><button data-s="1">Settings</button>` +
      `<span class="lbl">State</span><button data-e="0" class="${!state.empty ? 'on' : ''}">Conversation</button><button data-e="1" class="${state.empty ? 'on' : ''}">First open</button>` +
      `<span class="lbl">Theme</span><button data-t="dark" class="${theme === 'dark' ? 'on' : ''}">Dark</button><button data-t="light" class="${theme === 'light' ? 'on' : ''}">Light</button>` +
      `<div class="demo-note">${NOTES[state.home]}</div>`
    b.querySelectorAll('[data-h]').forEach(x => x.onclick = () => { state.home = x.dataset.h; state.homeOpen = true; render() })
    b.querySelector('[data-p]').onclick = () => { state.palette = true; render() }
    b.querySelector('[data-s]').onclick = settings
    b.querySelectorAll('[data-e]').forEach(x => x.onclick = () => { state.empty = x.dataset.e === '1'; state.extra = []; render() })
    b.querySelectorAll('[data-t]').forEach(x => x.onclick = () => { document.documentElement.dataset.theme = x.dataset.t; bar() })
  }

  function mount() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)
    const btn = document.createElement('button'); btn.className = 'bru-tb'; btn.title = 'Brutus'
    btn.innerHTML = '<span class="bru-av">B</span>Brutus<span class="bru-kbd">⌘K</span>'
    btn.onclick = () => { state.homeOpen = !state.homeOpen; render() }
    document.querySelector('.titlebar-actions').insertBefore(btn, document.getElementById('sync-all-btn'))
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); state.palette = !state.palette; render() }
      if (e.key === 'Escape') { if (state.palette) state.palette = false; else if (state.homeOpen) state.homeOpen = false; else return; render() }
    })
    const q = new URLSearchParams(location.search)
    if (q.get('home') === 'side') state.home = 'side'
    if (q.get('palette') === '1') state.palette = true
    if (q.get('empty') === '1') state.empty = true
    if (q.get('closed') === '1') state.homeOpen = false
    render()
    if (q.get('menu') === '1') { const r = document.querySelector('.bru-fab').getBoundingClientRect(); menu(r.left - 200, r.top - 110) }
  }
  const wait = () => window.__SHOT_READY__ ? mount() : requestAnimationFrame(wait)
  wait()
})()
