// Brutus's nudges: which facts are worth saying at which moment. UMD like the other lib/
// models: window.CSMNudgeModel in the renderer, require() in jest. Pure: no DOM, no storage,
// no clock of its own — every time is passed in.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMNudgeModel = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const F = typeof module !== 'undefined' && module.exports ? require('./formatters') : globalThis.CSMFormatters
  const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR
  const MORNING_HOUR = 5, MORNING_AWAY = 4 * HOUR, PAUSE = 30 * MIN
  const YOU = '👤'
  // Settings → AI Companion's default; config.rs holds the same range (1–60) and default.
  const STALE_DAYS = 3
  // The longest message the model may write, the longest sample of the person's own words
  // sent to it, and the most untriaged lines one run carries.
  const MAX_MESSAGE = 2000, SAMPLE_CHARS = 280, MAX_UNTRIAGED = 40
  // A nudge is read at a glance: the steps it names, and how long each one may run.
  const MAX_TASKS = 5, STEP_CHARS = 70
  // The baseline kept between visits: enough for thousands of open steps, small enough to
  // stay far under the state file's 1 MiB cap.
  const MAX_FACTS = 2000

  // FNV-1a, 32 bits: a line's identity in triage.json. Stable across releases, unlike a
  // language's built-in hash.
  function hashLine(s) {
    let h = 0x811c9dc5
    for (const ch of new TextEncoder().encode(String(s))) { h ^= ch; h = Math.imul(h, 0x01000193) >>> 0 }
    return h.toString(16).padStart(8, '0')
  }

  function openSteps(nextSteps) {
    return String(nextSteps || '').split('\n')
      .map(l => /^\s*[-*] \[ \]\s+(.*\S)\s*$/.exec(l))
      .filter(Boolean).map(m => m[1])
  }

  // The session's age as the app shows it, null when it has no time at all (never stale).
  const ageOf = (s) => F.sessionTime(s) || null
  const linksOf = (s) => (s.prLinks && s.prLinks.length ? s.prLinks : (s.prLink ? [s.prLink] : []))

  function collect({ live = [], stale = [], prs = {}, triage = {}, now, staleDays = STALE_DAYS }) {
    const out = []
    const open = [...live, ...stale].filter(s => s && s.notesPath)
    for (const s of open) {
      const np = s.notesPath, session = s.name || '', at = ageOf(s)
      // Every PR merged or closed: the work shipped, and the steps the notes still list are
      // most likely out of date. They are not said; the stale list offers to close it instead.
      const links = linksOf(s), shipped = links.length > 0 && links.every(u => prs[u] && (prs[u].state === 'merged' || prs[u].state === 'closed'))
      if (s.state === 'active' && s.status === 'waiting') out.push({ key: `waiting|${np}|${s.lastActivityAt || ''}`, kind: 'waiting', session, notesPath: np, text: '', at })
      if (s.state === 'active' && s.status === 'busy') out.push({ key: `busy|${np}|${s.lastActivityAt || ''}`, kind: 'busy', session, notesPath: np, text: '', at })
      for (const line of shipped ? [] : openSteps(s.nextSteps)) {
        const hash = hashLine(line)
        const owner = line.includes(YOU) ? 'you' : (triage[hash] || 'untriaged')
        if (owner === 'agent') continue
        out.push({ key: `task|${np}|${hash}`, kind: 'task', session, notesPath: np, text: line, at, owner, hash })
      }
      for (const url of linksOf(s)) {
        const p = prs[url]; if (!p || !p.state) continue
        out.push({ key: `pr|${url}|${p.state}`, kind: 'pr', session, notesPath: np, text: p.title || '', at, state: p.state, url })
      }
      for (const l of s.ticketStates || []) {
        const m = /^([A-Z][A-Z0-9]+-\d+): (.+)$/.exec(l); if (!m) continue
        out.push({ key: `ticket|${m[1]}|${m[2]}`, kind: 'ticket', session, notesPath: np, text: m[1], at, state: m[2] })
      }
      if (at !== null && now - at > staleDays * DAY) {
        out.push({ key: `stale|${np}`, kind: 'stale', session, notesPath: np, text: shipped ? '' : (openSteps(s.nextSteps)[0] || ''), at, shipped })
      }
    }
    return [...new Map(out.map(f => [f.key, f])).values()]
  }

  // What is kept of the facts between visits: decide reads only these fields of a baseline.
  function baseline(facts) {
    return (facts || []).slice(0, MAX_FACTS).map(({ key, kind, session, notesPath, at }) => ({ key, kind, session, notesPath, at }))
  }

  function dayKey(t) {
    const d = new Date(t)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  function momentFor({ now, lastVisit, lastBlur }) {
    const known = typeof lastVisit === 'number' && lastVisit <= now
    const hour = new Date(now).getHours()
    if (!known) return 'morning'
    if (hour >= MORNING_HOUR && dayKey(lastVisit) !== dayKey(now) && now - lastVisit >= MORNING_AWAY) return 'morning'
    if (typeof lastBlur === 'number' && lastBlur <= now && now - lastBlur >= PAUSE) return 'back'
    return null
  }

  const minutes = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m }
  function inQuiet(now, q) {
    if (!q || !q.from || !q.to) return false
    const d = new Date(now), m = d.getHours() * 60 + d.getMinutes(), f = minutes(q.from), t = minutes(q.to)
    return f < t ? (m >= f && m < t) : (m >= f || m < t)
  }

  const ORDER = { waiting: 0, task: 1, finished: 2, pr: 2, ticket: 2, staleCount: 3 }
  const NEWS = (f) => f.kind === 'ticket' || (f.kind === 'pr' && (f.state === 'merged' || f.state === 'closed'))

  function finishedTurns(facts, previous) {
    const now = new Set(facts.filter(f => f.kind === 'busy').map(f => f.notesPath))
    const waiting = new Set(facts.filter(f => f.kind === 'waiting').map(f => f.notesPath))
    return (previous || []).filter(f => f.kind === 'busy' && !now.has(f.notesPath) && !waiting.has(f.notesPath))
      .map(f => ({ key: `finished|${f.notesPath}|${f.at || ''}`, kind: 'finished', session: f.session, notesPath: f.notesPath }))
  }

  const mine = (f) => f.kind === 'waiting' || (f.kind === 'task' && f.owner === 'you')
  const changedSince = (previous) => { const before = new Set((previous || []).map(f => f.key)); return (f) => !before.has(f.key) }

  // The morning recap: everything still open on the person, once a day, plus the news and the
  // stale count.
  function morningItems(facts, previous, said, today, staleDays) {
    const changed = changedSince(previous)
    // Without a baseline nothing has "moved": a ticket or PR state is news only against one.
    const items = [...facts.filter(f => mine(f) && said[f.key] !== today),
                   ...(previous ? facts.filter(f => NEWS(f) && changed(f) && !said[f.key]) : []),
                   ...finishedTurns(facts, previous).filter(f => !said[f.key])]
    const stale = facts.filter(f => f.kind === 'stale')
    if (stale.length && said[`stale-count|${today}`] === undefined) {
      items.push({ key: `stale-count|${today}`, kind: 'staleCount', count: stale.length, days: staleDays })
    }
    return items
  }

  // Back from a pause, or a case that moved: only what changed against the baseline.
  function changeItems(facts, previous, said) {
    const changed = changedSince(previous)
    return [...facts.filter(f => (mine(f) || NEWS(f)) && changed(f)), ...finishedTurns(facts, previous)].filter(f => !said[f.key])
  }

  function decide({ moment, facts, previous, said = {}, now, settings }) {
    if (!settings || settings.nudges === false || inQuiet(now, settings.quietHours)) return null
    if (moment === 'moved' && !previous) return null
    const shape = (moment === 'back' && !previous) ? 'morning' : moment
    const items = shape === 'morning'
      ? morningItems(facts, previous, said, dayKey(now), settings.staleDays || STALE_DAYS)
      : changeItems(facts, previous, said)
    items.sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
    // Every waiting agent is said; the steps stop at MAX_TASKS and the rest become a count.
    // The steps said longest ago come first, never-said ones before all, so the five named
    // rotate from one morning to the next instead of the same five every day. Back from a
    // pause or on a moved case, only changed steps are candidates: one left out then is
    // counted, and named again at the next morning recap.
    const tasks = items.filter(i => i.kind === 'task')
      .map((i, n) => [i, n]).sort(([a, x], [b, y]) => String(said[a.key] || '').localeCompare(String(said[b.key] || '')) || x - y).map(([i]) => i)
    const named = new Set(tasks.slice(0, MAX_TASKS))
    const shown = items.filter(i => i.kind !== 'task' || named.has(i))
    const untriaged = shape === 'morning' ? facts.filter(f => f.kind === 'task' && f.owner === 'untriaged') : []
    if (!shown.length) return null
    return { items: shown, keys: shown.map(i => i.key), untriaged, more: Math.max(0, tasks.length - MAX_TASKS) }
  }

  const chip = (n) => `[[session:${n}]]`
  // Note text is untrusted: a [[session:…]] or [[doc:…]] written in it must not become a chip.
  const defang = (t) => String(t || '').replace(/\[\[/g, '[\u200b[')
  const clean = (t) => defang(String(t || '').replace(YOU, '').trim())
  // A step as one line of a nudge: cut on a word, the full text stays in the session's notes.
  function short(t, max = STEP_CHARS) {
    const s = String(t || '').replace(/\s+/g, ' ').trim()
    if (s.length <= max) return s
    const cut = s.slice(0, max - 1), sp = cut.lastIndexOf(' ')
    return `${(sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '')}…`
  }
  // The fallback speaks the language Brutus uses with the person (her decision, 2026-10-13):
  // French when their last message to him reads as French, otherwise the caller's fallback.
  const FR_WORDS = /\b(je|tu|il|elle|nous|vous|le|la|les|une|des|est|pas|pour|que|qui|quoi|avec|dans|sur|mais|ça|c'est|j'ai|oui|merci|stp)\b/i
  function langOf(sample, fallback = 'en') {
    const s = String(sample || '').trim()
    if (!s) return fallback === 'fr' ? 'fr' : 'en'
    return /[àâçéèêëîïôûùüÿœ]/i.test(s) || FR_WORDS.test(s) ? 'fr' : 'en'
  }
  const WORDS = {
    en: {
      waiting: (c) => `${c} is waiting on your answer.`,
      task: (c) => `For ${c}:`,
      finished: (c) => `${c} finished its turn.`,
      pr: (n, state) => `PR ${n} ${state}`,
      ticket: (k, state) => `${k} ${state}`,
      news: (c, l) => `Moved in ${c}: ${l.join(', ')}.`,
      staleCount: (n, d) => `${n} session${n > 1 ? 's have' : ' has'} not moved for more than ${d} days. Want me to list them?`,
      untriaged: (n) => `… and ${n} other open step${n > 1 ? 's' : ''}.`,
      more: (n) => `… and ${n} more thing${n > 1 ? 's' : ''}`,
      listAsk: 'Want me to list them?', open: 'Open', later: 'Not now',
      listLine: (c, day, step) => `- ${c}, ${day}${step ? `, next: ${step}` : ''}`,
      shipped: 'PR merged, ready to close',
      activeOn: (d) => `last active ${d}`, noActivity: 'no activity recorded',
    },
    fr: {
      waiting: (c) => `${c} attend ta réponse.`,
      task: (c) => `Pour ${c} :`,
      finished: (c) => `${c} a fini son tour.`,
      pr: (n, state) => `PR ${n} ${({ merged: 'mergée', closed: 'fermée', open: 'ouverte', draft: 'en brouillon' })[state] || state}`,
      ticket: (k, state) => `${k} en ${state}`,
      news: (c, l) => `Ça a bougé dans ${c} : ${l.join(', ')}.`,
      staleCount: (n, d) => `${n} session${n > 1 ? 's n’ont' : ' n’a'} pas bougé depuis plus de ${d} jours. Je te les liste ?`,
      untriaged: (n) => `… et ${n} autre${n > 1 ? 's' : ''} étape${n > 1 ? 's' : ''} ouverte${n > 1 ? 's' : ''}.`,
      more: (n) => `… et ${n} autre${n > 1 ? 's' : ''} chose${n > 1 ? 's' : ''}`,
      listAsk: 'Je te les liste ?', open: 'Ouvrir', later: 'Pas maintenant',
      listLine: (c, day, step) => `- ${c}, ${day}${step ? `, ensuite : ${step}` : ''}`,
      shipped: 'PR mergée, prête à fermer',
      activeOn: (d) => `actif le ${d}`, noActivity: 'aucune activité',
    },
  }
  const words = (lang) => WORDS[lang] || WORDS.en
  function line(i, lang = 'en') {
    const w = words(lang), c = chip(i.session)
    switch (i.kind) {
      case 'waiting': return w.waiting(c)
      case 'finished': return w.finished(c)
      case 'staleCount': return w.staleCount(i.count, i.days)
      default: return ''
    }
  }
  // A PR by its number when the URL has one, else by its title.
  const prName = (i) => { const m = /\/pull\/(\d+)/.exec(String(i.url || '')); return m ? `#${m[1]}` : `"${short(clean(i.text), 40)}"` }
  const news = (i, w) => i.kind === 'pr' ? w.pr(prName(i), i.state) : w.ticket(i.text, i.state)
  // Facts grouped under their session, keyed on the notes path: two sessions can share a name.
  function bySession(items) {
    const g = new Map()
    for (const i of items) { const k = i.notesPath || i.session; if (!g.has(k)) g.set(k, { session: i.session, items: [] }); g.get(k).items.push(i) }
    return [...g.values()]
  }
  // The fallback when the model gives no wording: waiting agents, then the steps under their
  // session's name once, the turns that finished, every state change on one line, the counts.
  function template(items, untriagedCount = 0, lang = 'en', more = 0) {
    const w = words(lang), out = []
    for (const i of items.filter(x => x.kind === 'waiting')) out.push(line(i, lang))
    for (const g of bySession(items.filter(x => x.kind === 'task'))) {
      out.push(w.task(chip(g.session)))
      for (const i of g.items) out.push(`- ${short(clean(i.text))}`)
    }
    for (const i of items.filter(x => x.kind === 'finished')) out.push(line(i, lang))
    for (const g of bySession(items.filter(x => x.kind === 'pr' || x.kind === 'ticket'))) out.push(w.news(chip(g.session), g.items.map(i => news(i, w))))
    for (const i of items.filter(x => x.kind === 'staleCount')) out.push(line(i, lang))
    const rest = more + untriagedCount
    if (rest) out.push(w.untriaged(rest))
    return out.join('\n')
  }
  // The first lines of a nudge. It never ends on a session's header with its steps cut off.
  function preview(text, max = 3, lang = 'en') {
    const l = String(text || '').split('\n').filter(x => x.trim())
    if (l.length <= max) return l.join('\n')
    let n = max
    if (n > 1 && !/^\s*[-*] /.test(l[n - 1]) && /^\s*[-*] /.test(l[n])) n--
    return `${l.slice(0, n).join('\n')}\n${words(lang).more(l.length - n)}`
  }
  function validMessage(message, facts) {
    const m = String(message || '').trim()
    if (!m || m.length > MAX_MESSAGE) return false
    // The model writes session chips and nothing else: a doc button or any other link kind
    // in its message came from the notes it read, not from the facts.
    if ((m.match(/\[\[/g) || []).length !== (m.match(/\[\[session:/g) || []).length) return false
    const known = new Set((facts || []).map(f => f.session).filter(Boolean))
    return [...m.matchAll(/\[\[session:([^\]]+?)\]\]/g)].every(x => known.has(x[1].trim()))
  }
  function withRecap(recap, reply, max = 8000) {
    const head = 'Context — you just told the person this, on your own initiative:\n'
    const tail = `\n\nTheir reply:\n${reply}`
    const room = max - head.length - tail.length
    if (room <= 0) return String(reply).slice(0, max)
    return head + String(recap).slice(0, room) + tail
  }
  function staleList(facts) {
    return (facts || []).filter(f => f.kind === 'stale').sort((a, b) => (a.at || 0) - (b.at || 0))
      .map(f => ({ session: f.session, at: f.at, step: f.text, shipped: !!f.shipped }))
  }
  // The answer to "want me to list them?", from the list the nudge carried.
  function staleLines(stale, lang = 'en', fmt = (t) => new Date(t).toLocaleDateString()) {
    const w = words(lang)
    return (stale || []).map(s => {
      const line = w.listLine(chip(defang(s.session)), s.at ? w.activeOn(fmt(s.at)) : w.noActivity, s.step ? defang(s.step) : '')
      return s.shipped ? `${line}, ${w.shipped}` : line
    }).join('\n')
  }
  function prune(said, facts, now, days = 7) {
    const live = new Set((facts || []).map(f => f.key))
    const since = dayKey(now - days * DAY), out = {}
    for (const [k, d] of Object.entries(said || {})) if (live.has(k) || d >= since) out[k] = d
    return out
  }
  function payload({ moment, items, untriaged, sample, name, staleDays, more = 0 }) {
    return {
      moment, name, staleDays, more, sample: String(sample || '').slice(0, SAMPLE_CHARS),
      items: items.map(i => ({ kind: i.kind, session: i.session, text: clean(i.text), state: i.state, count: i.count })),
      untriaged: (untriaged || []).slice(0, MAX_UNTRIAGED).map(u => ({ hash: u.hash, session: u.session, text: defang(u.text) })),
    }
  }

  return { MAX_TASKS, short, hashLine, openSteps, collect, baseline, momentFor, inQuiet, dayKey, YOU, STALE_DAYS, MAX_MESSAGE, MAX_FACTS, decide, template, preview, validMessage, withRecap, staleList, staleLines, words, payload, langOf, prune, defang }
})
