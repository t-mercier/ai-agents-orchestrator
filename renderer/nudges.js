// Brutus speaks first: at the morning arrival, back from a pause, and when a case moves.
// This file only decides WHEN and keeps the record; lib/nudge-model.js decides WHAT, the
// backend words it (one tool-less Haiku run) and brutus.js draws it.
;(function () {
  const N = window.CSMNudgeModel
  if (!N || !window.api || !window.api.brutusNudge) return
  const GROUP_MS = 2 * 60_000
  // A case that moves again soon after a nudge waits for this gap, so a busy afternoon does
  // not cost one Haiku run every two minutes. The batch is delayed, never dropped.
  const MOVED_GAP_MS = 5 * 60_000
  // How long a history scan, or the PR states, stay good enough to reuse.
  const SCAN_MS = 5 * 60_000, PRS_MS = 60_000
  let st = { said: {}, lastVisit: null, lastFacts: null, triage: {}, pending: null, snoozeUntil: null }
  let ready = null, lastBlur = null, pollPrev = null, pollAt = 0, polling = false, batch = null, stale = []
  let lastScan = { at: 0, facts: null }, prs = { at: 0, v: {} }, lastNudgeAt = 0
  // The model's "not hers" verdicts hold for this run of the app only: a wrong one hides a
  // line from the count until the next launch, not forever.
  const agentLines = {}
  const cfg = () => (window.CSM_CONFIG || {}).assistant || {}
  const settings = () => ({ nudges: cfg().nudges !== false && cfg().enabled !== false, quietHours: cfg().quietHours || null, staleDays: cfg().staleDays || N.STALE_DAYS })
  // What was said is kept while it is still true, or for a week: unpruned, the file would
  // reach its size cap and every save after that would fail.
  const prune = () => { st.said = N.prune(st.said, st.lastFacts || [], Date.now()) }
  // Saving is best-effort: a failed save only means a reminder may be said once more.
  const save = async () => {
    const r = await window.api.brutusNudgeSave(st)
    if (r && r.ok === false) console.warn(`brutus nudges: could not save (${r.error})`)
  }
  // Off, or inside Do not disturb: nothing is said and the baseline does not move, so the
  // recap waits for the window to end instead of being lost.
  const snoozed = (now) => typeof st.snoozeUntil === 'number' && now < st.snoozeUntil
  const silent = (now) => !settings().nudges || N.inQuiet(now, settings().quietHours) || snoozed(now)
  // One nudge at a time: a launch and a focus, or a run and a moved batch, would otherwise
  // both pass momentFor and make two Haiku calls.
  let chain = Promise.resolve()
  const serial = (fn) => (chain = chain.then(fn, fn))

  async function prStates() {
    if (Date.now() - prs.at > PRS_MS) prs = { at: Date.now(), v: (await window.api.getPrStatus()) || {} }
    return prs.v
  }
  // The 5 s poll passes the sessions it already has and skips the history scan: the stale
  // list is refreshed at the morning, back and blur collections, which is often enough.
  async function gather(live) {
    const [l, hist, p] = await Promise.all([live ? live : window.api.getSessions(), live ? null : window.api.getHistoricalAll(), prStates()])
    if (hist && hist.stale) stale = hist.stale
    const facts = N.collect({ live: l || [], stale, prs: p, triage: { ...agentLines, ...st.triage }, now: Date.now(), staleDays: settings().staleDays })
    if (!live) lastScan = { at: Date.now(), facts }
    return facts
  }

  // Ask Haiku for the wording; any failure, or a session it named that is not in the
  // facts, falls back to the templates. The reminder itself is never lost.
  const sample = () => (window.CSMBrutusUI ? window.CSMBrutusUI.lastUserText() : '')
  const uiLang = () => (String(navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en')
  // The language Brutus speaks with the person: their last message to him, else the system's.
  const lang = () => N.langOf(sample(), uiLang())
  const idle = () => new Promise(r => (window.CSMBrutusUI ? window.CSMBrutusUI.onIdle(r) : r()))
  async function word(d, facts, moment) {
    const payload = JSON.stringify(N.payload({ moment, items: d.items, untriaged: d.untriaged, sample: sample(),
      name: cfg().name || 'Brutus', staleDays: settings().staleDays, more: d.more }))
    await idle()
    let r = await window.api.brutusNudge(payload)
    // He started answering between the wait and the call: wait for him once more.
    if (r && r.error === 'busy') { await idle(); r = await window.api.brutusNudge(payload) }
    if (r && r.ok) {
      for (const [h, v] of Object.entries(r.triage || {})) {
        if (v === 'you') st.triage[h] = v
        else agentLines[h] = v
      }
      if (N.validMessage(r.message, facts)) return r.message
      console.warn('brutus nudges: the wording named something outside the facts; using the templates')
    } else console.warn(`brutus nudges: no wording (${r && r.error}); using the templates`)
    return N.template(d.items, d.untriaged.length, lang(), d.more)
  }

  // Shows the nudge and keeps it as pending until it is opened or put away: it is recorded
  // as said before it is seen, so without this a nudge would be lost if the app quit first.
  function show(text, facts) {
    lastNudgeAt = Date.now()
    if (!window.CSMBrutusUI) return
    window.CSMBrutusUI.showNudge({ text, stale: N.staleList(facts), lang: lang() })
    st.pending = window.CSMBrutusUI.pendingNudge()
  }

  function run(moment, now = Date.now()) {
    return serial(async () => {
      await ready
      if (silent(now)) return
      const facts = await gather()
      const d = N.decide({ moment, facts, previous: st.lastFacts, said: st.said, now, settings: settings() })
      st.lastVisit = now
      st.lastFacts = N.baseline(facts)
      // Recorded before the wording is awaited, so nothing running meanwhile says it again.
      if (d) for (const k of d.keys) st.said[k] = N.dayKey(now)
      if (d) show(await word(d, facts, moment), facts)
      prune()
      await save()
    })
  }

  async function onForeground(now = Date.now()) {
    await ready
    const m = N.momentFor({ now, lastVisit: st.lastVisit, lastBlur })
    if (m) return run(m, now)
  }

  // While the app is in front, a case that moves is said once the burst settles: the first
  // change opens a 2-minute window, and what changed by its end is said together.
  async function onPoll(sessions) {
    if (polling || !document.hasFocus() || !settings().nudges) return
    polling = true
    try {
      const facts = await gather(sessions)
      if (pollPrev && !batch) {
        const before = new Set(pollPrev.map(f => f.key))
        if (facts.length !== pollPrev.length || facts.some(f => !before.has(f.key))) {
          const wait = Math.max(GROUP_MS, lastNudgeAt + MOVED_GAP_MS - Date.now())
          batch = { base: pollPrev, timer: setTimeout(flushMoved, wait) }
        }
      }
      pollPrev = facts; pollAt = Date.now()
    } finally { polling = false }
  }
  function flushMoved() {
    if (!batch) return Promise.resolve()
    const { base } = batch
    clearTimeout(batch.timer); batch = null
    return serial(async () => {
      const now = Date.now(), latest = pollPrev || []
      if (silent(now)) return
      const d = N.decide({ moment: 'moved', facts: latest, previous: base, said: st.said, now, settings: settings() })
      if (!d) return
      for (const k of d.keys) st.said[k] = N.dayKey(now)
      show(await word(d, latest, 'moved'), latest)
      prune()
      await save()
    })
  }

  // The baseline for "while you were away", without a scan on every blur: the last poll's
  // facts when they are fresh, else a recent scan, else a new one.
  function awayBaseline(now) {
    if (pollPrev && now - pollAt < 15_000) return pollPrev
    if (lastScan.facts && now - lastScan.at < SCAN_MS) return lastScan.facts
    return gather()
  }
  window.addEventListener('blur', () => {
    lastBlur = Date.now()
    return serial(async () => {
      await ready
      // Off, or inside Do not disturb: the baseline stays where it was, as in run(), so a
      // blur during the quiet window does not count as the day's visit and skip the morning.
      if (silent(lastBlur)) return
      st.lastVisit = lastBlur
      try { st.lastFacts = N.baseline(await awayBaseline(lastBlur)) } catch { /* keep the previous baseline */ }
      prune()
      await save()
    })
  })
  window.addEventListener('focus', () => onForeground())
  // Opened or put away: no longer pending.
  window.addEventListener('brutus-nudge-done', () => serial(async () => {
    if (!st.pending) return
    st.pending = null
    await save()
  }))

  // An unreadable state reads as none (lib/tauri-api.js): the launch then takes the morning shape.
  ready = window.api.brutusNudgeState().then(s => {
    if (s) st = { ...st, ...s }
    if (st.pending && window.CSMBrutusUI) window.CSMBrutusUI.showNudge(st.pending)
  })
  // Paused from his panel: kept quiet until `until` (ms), or speaking again with null. Like
  // quiet hours, the baseline stays put, so what moved meanwhile is said when it ends.
  function snooze(until) {
    return serial(async () => {
      await ready
      st.snoozeUntil = typeof until === 'number' && until > Date.now() ? until : null
      await save()
      window.dispatchEvent(new Event('brutus-snooze'))
      if (st.snoozeUntil === null) onForeground()
    })
  }
  window.CSMNudges = { run, onPoll, flushMoved, foreground: onForeground, settled: () => chain, state: () => st, snooze,
    snoozedUntil: () => (snoozed(Date.now()) ? st.snoozeUntil : null) }
  // Launch counts as arriving: there is no focus event when the first visit is the launch.
  onForeground()
})()
