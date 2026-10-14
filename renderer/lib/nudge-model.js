// Brutus's nudges: which facts are worth saying at which moment. UMD like the other lib/
// models: window.CSMNudgeModel in the renderer, require() in jest. Pure: no DOM, no storage,
// no clock of its own — every time is passed in. See docs/superpowers/specs/2026-10-13-brutus-nudges-design.md.
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
      if (s.state === 'active' && s.status === 'waiting') out.push({ key: `waiting|${np}|${s.lastActivityAt || ''}`, kind: 'waiting', session, notesPath: np, text: '', at })
      if (s.state === 'active' && s.status === 'busy') out.push({ key: `busy|${np}|${s.lastActivityAt || ''}`, kind: 'busy', session, notesPath: np, text: '', at })
      for (const line of openSteps(s.nextSteps)) {
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
        out.push({ key: `stale|${np}`, kind: 'stale', session, notesPath: np, text: openSteps(s.nextSteps)[0] || '', at })
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
    const untriaged = shape === 'morning' ? facts.filter(f => f.kind === 'task' && f.owner === 'untriaged') : []
    if (!items.length) return null
    return { items, keys: items.map(i => i.key), untriaged }
  }

  const chip = (n) => `[[session:${n}]]`
  // Note text is untrusted: a [[session:…]] or [[doc:…]] written in it must not become a chip.
  const defang = (t) => String(t || '').replace(/\[\[/g, '[\u200b[')
  const clean = (t) => defang(String(t || '').replace(YOU, '').trim())
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
      task: (c, t) => `For ${c}: ${t}`,
      finished: (c) => `${c} finished its turn.`,
      pr: (n, title, state, c) => `PR #${n}${title ? ` (${title})` : ''} was ${state} — ${c}.`,
      ticket: (k, state, c) => `${k} moved to ${state} — ${c}.`,
      staleCount: (n, d) => `${n} session${n > 1 ? 's have' : ' has'} not moved for more than ${d} days — want me to list them?`,
      untriaged: (n) => `… and ${n} other open steps.`,
      more: (n) => `… and ${n} more things`,
      listAsk: 'Want me to list them?', open: 'Open', later: 'Not now',
      listLine: (c, day, step) => `- ${c} — ${day}${step ? ` — next: ${step}` : ''}`,
      activeOn: (d) => `last active ${d}`, noActivity: 'no activity recorded',
    },
    fr: {
      waiting: (c) => `${c} attend ta réponse.`,
      task: (c, t) => `Pour ${c} : ${t}`,
      finished: (c) => `${c} a fini son tour.`,
      pr: (n, title, state, c) => `La PR #${n}${title ? ` (${title})` : ''} est ${({ merged: 'mergée', closed: 'fermée', open: 'ouverte', draft: 'en brouillon' })[state] || state} — ${c}.`,
      ticket: (k, state, c) => `${k} est passé en ${state} — ${c}.`,
      staleCount: (n, d) => `${n} session${n > 1 ? 's n’ont' : ' n’a'} pas bougé depuis plus de ${d} jours — je te les liste ?`,
      untriaged: (n) => `… et ${n} autres étapes ouvertes.`,
      more: (n) => `… et ${n} autre${n > 1 ? 's' : ''} chose${n > 1 ? 's' : ''}`,
      listAsk: 'Je te les liste ?', open: 'Ouvrir', later: 'Pas maintenant',
      listLine: (c, day, step) => `- ${c} — ${day}${step ? ` — ensuite : ${step}` : ''}`,
      activeOn: (d) => `actif le ${d}`, noActivity: 'aucune activité',
    },
  }
  const words = (lang) => WORDS[lang] || WORDS.en
  function line(i, lang = 'en') {
    const w = words(lang), c = chip(i.session)
    switch (i.kind) {
      case 'waiting': return w.waiting(c)
      case 'task': return w.task(c, clean(i.text))
      case 'finished': return w.finished(c)
      case 'pr': return w.pr(String(i.url || '').split('/').pop(), i.text, i.state, c)
      case 'ticket': return w.ticket(i.text, i.state, c)
      case 'staleCount': return w.staleCount(i.count, i.days)
      default: return ''
    }
  }
  function template(items, untriagedCount = 0, lang = 'en') {
    const lines = items.map(i => line(i, lang)).filter(Boolean)
    if (untriagedCount) lines.push(words(lang).untriaged(untriagedCount))
    return lines.join('\n')
  }
  function preview(text, max = 3, lang = 'en') {
    const l = String(text || '').split('\n').filter(x => x.trim())
    return l.length <= max ? l.join('\n') : `${l.slice(0, max).join('\n')}\n${words(lang).more(l.length - max)}`
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
      .map(f => ({ session: f.session, at: f.at, step: f.text }))
  }
  // The answer to "want me to list them?", from the list the nudge carried.
  function staleLines(stale, lang = 'en', fmt = (t) => new Date(t).toLocaleDateString()) {
    const w = words(lang)
    return (stale || []).map(s => w.listLine(chip(defang(s.session)), s.at ? w.activeOn(fmt(s.at)) : w.noActivity, s.step ? defang(s.step) : '')).join('\n')
  }
  function prune(said, facts, now, days = 7) {
    const live = new Set((facts || []).map(f => f.key))
    const since = dayKey(now - days * DAY), out = {}
    for (const [k, d] of Object.entries(said || {})) if (live.has(k) || d >= since) out[k] = d
    return out
  }
  function payload({ moment, items, untriaged, sample, name, staleDays }) {
    return {
      moment, name, staleDays, sample: String(sample || '').slice(0, SAMPLE_CHARS),
      items: items.map(i => ({ kind: i.kind, session: i.session, text: clean(i.text), state: i.state, count: i.count })),
      untriaged: (untriaged || []).slice(0, MAX_UNTRIAGED).map(u => ({ hash: u.hash, session: u.session, text: defang(u.text) })),
    }
  }

  return { hashLine, openSteps, collect, baseline, momentFor, inQuiet, dayKey, YOU, STALE_DAYS, MAX_MESSAGE, MAX_FACTS, decide, template, preview, validMessage, withRecap, staleList, staleLines, words, payload, langOf, prune, defang }
})
