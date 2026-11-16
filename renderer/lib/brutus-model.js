// Brutus's answers, rendered. UMD like the other lib/ models: window.CSMBrutus in the
// renderer, require() in jest. Pure, no DOM. Everything the model wrote is escaped FIRST,
// then a small, closed set of formatting is applied to the escaped text.
(function (root, factory) {
  const F = (typeof module !== 'undefined' && module.exports) ? require('./formatters') : root.CSMFormatters
  const api = factory(F)
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMBrutus = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F) {
  const esc = F.escapeHtml

  function statusOf(s) {
    if (!s) return 'idle'
    if (s.state === 'stale') return 'stale'
    return ['waiting', 'busy', 'idle'].includes(s.status) ? s.status : 'idle'
  }

  // The name arrives escaped (the whole text was), so compare against the escaped name.
  function chipFor(escapedName, sessions) {
    const s = (sessions || []).find(x => esc(x.name || '') === escapedName)
    if (!s) return escapedName
    return `<span class="bru-chip" data-brutus-session="${escapedName}"><span class="bru-dot ${statusOf(s)}"></span>${escapedName}</span>`
  }

  // Ticket keys and PR references in his text, as links. A key is linked only when its
  // project prefix is one the sessions use, so "UTF-8" stays text; "#123" only when exactly
  // one known PR has that number. Chips, doc cards and code are left alone. One pass over
  // the text, so a link's own URL is never scanned again for a key.
  const KEY = /^([A-Z][A-Z0-9]{1,9})-\d+$/
  const REFS = /(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+)|\b([A-Z][A-Z0-9]{1,9})-(\d+)\b|(?<![\w&;"/])#(\d+)\b/g
  const ref = (url, label) => `<a class="bru-ref" data-bru-url="${esc(url)}">${label}</a>`
  function refsOf(sessions, ticketBase) {
    const prefixes = new Set(), prs = new Map()
    for (const s of sessions || []) {
      for (const t of [s.ticket, ...(s.tickets || [])]) { const m = KEY.exec(String(t || '')); if (m) prefixes.add(m[1]) }
      for (const u of [s.prLink, ...(s.prLinks || [])]) {
        // Only the part of the link that matches: a malformed one cannot carry a quote along.
        const m = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/.exec(String(u || ''))
        if (m) prs.set(m[1], prs.has(m[1]) && prs.get(m[1]) !== m[0] ? null : m[0])
      }
    }
    return { prefixes, prs, ticketBase: /^https?:\/\//.test(ticketBase || '') ? ticketBase : '' }
  }
  function linkRefs(t, refs) {
    if (!refs) return t
    return t.split(/(\[\[[^\]]*\]\]|`[^`]+`)/).map((part, i) => i % 2 ? part : part.replace(REFS, (all, url, p, n, pr) => {
      if (url) return ref(url, url)
      if (p) return refs.ticketBase && refs.prefixes.has(p) ? ref(refs.ticketBase + all, all) : all
      return refs.prs.get(pr) ? ref(refs.prs.get(pr), all) : all
    })).join('')
  }

  function inline(t, sessions, refs) {
    return linkRefs(t, refs)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[\[session:([^\]]+?)\]\]/g, (_, n) => chipFor(n.trim(), sessions))
      .replace(/\[\[doc:([^\]]+?)\]\]/g, (all, n) => docCard(n.trim()) || all)
  }

  // A document he wrote into his docs folder: one plain .md or .html file, the same rule
  // the backend applies before opening it. Anything else stays text.
  const DOC_NAME = /^(?!\.)[A-Za-z0-9._-]+\.(md|html)$/
  function docCard(name) {
    if (!DOC_NAME.test(name)) return ''
    return `<span class="bru-doc"><span class="bru-doc-name">📄 ${name}</span><button type="button" class="bru-doc-open" data-bru-doc="${name}">Open</button></span>`
  }

  // An action he proposes: `[[action:<verb>:<session name>]]`, `[[action:board:<session
  // name>:<column>]]` or `[[action:new:<category>]]`. He never runs it; the app draws a
  // button and the person clicks it, which goes through the app's own control for that
  // action, confirmation included. The session is resolved by its exact name, as a chip is.
  const ACTION = /\[\[action:([^\]\n]*)\]\]/g
  const VERBS = { archive: 'Archive', close: 'Close', pause: 'Pause', sync: 'Sync', resume: 'Resume', board: 'Move', new: 'New session' }
  function parseAction(body) {
    const parts = String(body || '').split(':')
    const verb = parts[0].trim().toLowerCase()
    const rest = parts.slice(1)
    if (verb === 'new') return { verb, name: '', arg: rest.join(':').trim() }
    // The column is the last part: a session name may hold a colon, a column id does not.
    if (verb === 'board' && rest.length > 1) return { verb, name: rest.slice(0, -1).join(':').trim(), arg: rest[rest.length - 1].trim() }
    return { verb, name: rest.join(':').trim(), arg: '' }
  }
  const keyOf = (s) => s.notesPath || s.sessionId || s.name || ''

  // What a click on that button would do, against the app as it is now: `{ ok, label }`,
  // with `why` when it cannot apply. `ctx` is { sessions, columns, placements,
  // categories, why: { <verb>(session) → '' or the reason } }.
  function resolveAction(a, ctx) {
    const c = ctx || {}
    if (!a || !Object.prototype.hasOwnProperty.call(VERBS, a.verb)) {
      return { ok: false, label: 'Unknown action', why: `"${(a && a.verb) || ''}" is not an action the app has` }
    }
    if (a.verb === 'new') {
      const label = a.arg ? `New ${a.arg} session` : 'New session'
      if (!(c.categories || []).includes(a.arg)) return { ok: false, label, why: a.arg ? `No category named "${a.arg}"` : 'No category given' }
      return { ok: true, label, category: a.arg }
    }
    // Every distinct session with that name: with two, a click would act on whichever came
    // first, so the button refuses instead.
    const named = (c.sessions || []).filter(x => (x.name || '') === a.name)
    const distinct = new Set(named.map(keyOf)).size
    const session = named[0]
    const label = `${VERBS[a.verb]} ${a.name}${a.verb === 'board' && a.arg ? ` to ${a.arg}` : ''}`
    if (!a.name || !session) return { ok: false, label, why: `No session named "${a.name}"` }
    if (distinct > 1) return { ok: false, label, why: `More than one session is named ${a.name}` }
    if (a.verb === 'board') {
      const col = (c.columns || []).find(x => x.id === a.arg) ||
        (c.columns || []).find(x => String(x.name || '').toLowerCase() === a.arg.toLowerCase())
      if (!a.arg || !col) return { ok: false, label, why: `No board column named "${a.arg}"` }
      const moved = `${VERBS.board} ${a.name} to ${col.name}`
      if (col.hidden) return { ok: false, label: moved, why: `The column "${col.name}" is hidden` }
      if (!keyOf(session)) return { ok: false, label: moved, why: 'This session cannot be placed on the board' }
      if ((c.placements || {})[keyOf(session)] === col.id) return { ok: false, label: moved, why: `Already in ${col.name}` }
      return { ok: true, label: moved, session, column: col.id }
    }
    const test = (c.why || {})[a.verb]
    const why = test ? test(session) : 'Not available here'
    return why ? { ok: false, label, why } : { ok: true, label, session }
  }

  function actionButton(a, ctx) {
    const r = resolveAction(a, ctx)
    const attrs = `data-bru-action="${esc(a.verb)}" data-bru-target="${esc(a.name)}" data-bru-arg="${esc(a.arg)}"`
    return `<button type="button" class="bru-act" ${attrs}${r.ok ? '' : ` disabled title="${esc(r.why)}"`}>${esc(r.label)}</button>`
  }

  // Markers are taken out before the text is escaped and formatted, and their buttons put
  // back last, so nothing in a session name is read as a link, bold or a chip. One inside
  // a code span or a fenced block (an unclosed fence runs to the end) stays text: that is
  // how he quotes the syntax without proposing anything.
  function extractActions(text) {
    const acts = []
    const marked = String(text || '').replace(/\u0000/g, '').split(/(```[\s\S]*?(?:```|$)|`[^`\n]+`)/)
      .map((part, i) => i % 2 ? part : part.replace(ACTION, (_, body) => { acts.push(parseAction(body)); return `\u0000${acts.length - 1}\u0000` }))
      .join('')
    return { marked, acts }
  }

  function renderAnswer(text, sessions, ticketBase, actions) {
    const refs = refsOf(sessions, ticketBase)
    const { marked, acts } = extractActions(text)
    const ctx = { sessions, ...(actions || {}) }
    const put = (html) => acts.length ? html.replace(/\u0000(\d+)\u0000/g, (_, i) => actionButton(acts[Number(i)], ctx)) : html
    return put(renderBlocks(esc(marked), sessions, refs))
  }

  function renderBlocks(escaped, sessions, refs) {
    const blocks = escaped.split(/\n\s*\n/)
    return blocks.map(b => {
      const lines = b.split('\n').filter(l => l.trim())
      if (!lines.length) return ''
      const out = []
      let list = []
      const flush = () => { if (list.length) { out.push(`<ul>${list.join('')}</ul>`); list = [] } }
      const para = []
      for (const l of lines) {
        const m = /^\s*[-*] (.*)$/.exec(l)
        if (m) { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para.length = 0 } list.push(`<li>${inline(m[1], sessions, refs)}</li>`) }
        else { flush(); para.push(inline(l, sessions, refs)) }
      }
      flush()
      if (para.length) out.push(`<p>${para.join('<br>')}</p>`)
      return out.join('')
    }).join('')
  }

  const base = (p) => String(p || '').split('/').pop()
  function sessionForNotes(path, sessions) {
    return (sessions || []).find(s => s.notesPath && s.notesPath === path)
  }

  function stepLabel(step, sessions) {
    const t = step.target || ''
    if ((step.tool === 'Edit' || step.tool === 'Write') && /\/docs\/[^/]+$/.test(t)) return `Writing ${base(t)}`
    if ((step.tool === 'Edit' || step.tool === 'Write') && base(t) === 'notes.md') {
      const s = sessionForNotes(t, sessions)
      return s ? `Editing the notes of ${s.name}` : 'Editing a session\'s notes'
    }
    if (step.tool === 'Edit' || step.tool === 'Write') return 'Writing to his memory'
    if (step.tool === 'Grep' || step.tool === 'Glob') return `Searching for "${t}"`
    if (base(t) === 'dashboard.md') return 'Reading the dashboard'
    if (base(t) === 'memory.md') return 'Reading his memory'
    const s = sessionForNotes(t, sessions)
    return s ? `Reading the notes of ${s.name}` : `Reading ${base(t)}`
  }

  function stepsLine(steps, sessions) {
    const parts = []
    let notes = 0, edited = 0
    const searched = []
    let dash = false, mem = false, other = 0
    const docs = []
    for (const st of steps || []) {
      const b = base(st.target)
      if (st.tool === 'Grep' || st.tool === 'Glob') searched.push(`searched "${st.target}"`)
      else if ((st.tool === 'Edit' || st.tool === 'Write') && /\/docs\/[^/]+$/.test(st.target || '')) { if (!docs.includes(b)) docs.push(b) }
      else if ((st.tool === 'Edit' || st.tool === 'Write') && b === 'notes.md') edited++
      else if (st.tool === 'Edit' || st.tool === 'Write') mem = true
      else if (b === 'dashboard.md') dash = true
      else if (b === 'memory.md') mem = true
      else if (b === 'notes.md') notes++
      else other++
    }
    if (dash) parts.push('Read the dashboard')
    if (notes) parts.push(`notes of ${notes} session${notes > 1 ? 's' : ''}`)
    if (other) parts.push(`${other} other file${other > 1 ? 's' : ''}`)
    parts.push(...searched)
    if (mem) parts.push('his memory')
    if (edited) parts.push(`edited ${edited === 1 ? 'one session\'s notes' : `the notes of ${edited} sessions`}`)
    parts.push(...docs.map(d => `wrote ${d}`))
    return parts.join(' · ')
  }

  function initialOf(name) {
    const c = String(name || '').trim()[0]
    return c ? c.toUpperCase() : 'B'
  }

  return { renderAnswer, stepsLine, stepLabel, initialOf, statusOf, parseAction, resolveAction }
})
