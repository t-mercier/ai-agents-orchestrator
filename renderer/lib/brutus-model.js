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
  // one known PR has that number. Chips, doc cards and code are left alone.
  const TICKET = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/g
  const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/g
  const ref = (url, label) => `<a class="bru-ref" data-bru-url="${url}">${label}</a>`
  function refsOf(sessions, ticketBase) {
    const prefixes = new Set(), prs = new Map()
    for (const s of sessions || []) {
      for (const t of [s.ticket, ...(s.tickets || [])]) { const m = /^([A-Z][A-Z0-9]*)-\d+$/.exec(String(t || '')); if (m) prefixes.add(m[1]) }
      for (const u of [s.prLink, ...(s.prLinks || [])]) {
        const m = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/.exec(String(u || ''))
        if (m) prs.set(m[1], prs.has(m[1]) && prs.get(m[1]) !== m[0] ? null : m[0])
      }
    }
    return { prefixes, prs, ticketBase: ticketBase || '' }
  }
  function linkRefs(t, refs) {
    if (!refs) return t
    return t.split(/(\[\[[^\]]*\]\]|`[^`]+`)/).map((part, i) => {
      if (i % 2) return part
      let out = part.replace(PR_URL, (u) => ref(u, u))
      if (refs.ticketBase) out = out.replace(TICKET, (k, p) => (refs.prefixes.has(p) ? ref(esc(refs.ticketBase) + k, k) : k))
      return out.replace(/(^|[^\w&;"\/])#(\d+)\b/g, (all, pre, n) => (refs.prs.get(n) ? `${pre}${ref(refs.prs.get(n), `#${n}`)}` : all))
    }).join('')
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

  function renderAnswer(text, sessions, ticketBase) {
    const refs = refsOf(sessions, ticketBase)
    const blocks = esc(String(text || '')).split(/\n\s*\n/)
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
    if (step.tool === 'Edit' || step.tool === 'Write') return 'Writing to his memory'
    if (step.tool === 'Grep' || step.tool === 'Glob') return `Searching for "${t}"`
    if (base(t) === 'dashboard.md') return 'Reading the dashboard'
    if (base(t) === 'memory.md') return 'Reading his memory'
    const s = sessionForNotes(t, sessions)
    return s ? `Reading the notes of ${s.name}` : `Reading ${base(t)}`
  }

  function stepsLine(steps, sessions) {
    const parts = []
    let notes = 0
    const searched = []
    let dash = false, mem = false, other = 0
    const docs = []
    for (const st of steps || []) {
      const b = base(st.target)
      if (st.tool === 'Grep' || st.tool === 'Glob') searched.push(`searched "${st.target}"`)
      else if ((st.tool === 'Edit' || st.tool === 'Write') && /\/docs\/[^/]+$/.test(st.target || '')) { if (!docs.includes(b)) docs.push(b) }
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
    parts.push(...docs.map(d => `wrote ${d}`))
    return parts.join(' · ')
  }

  function initialOf(name) {
    const c = String(name || '').trim()[0]
    return c ? c.toUpperCase() : 'B'
  }

  return { renderAnswer, stepsLine, stepLabel, initialOf, statusOf }
})
