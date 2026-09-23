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

  function inline(t, sessions) {
    return t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[\[session:([^\]]+?)\]\]/g, (_, n) => chipFor(n.trim(), sessions))
  }

  function renderAnswer(text, sessions) {
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
        if (m) { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para.length = 0 } list.push(`<li>${inline(m[1], sessions)}</li>`) }
        else { flush(); para.push(inline(l, sessions)) }
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
    for (const st of steps || []) {
      const b = base(st.target)
      if (st.tool === 'Grep' || st.tool === 'Glob') searched.push(`searched "${st.target}"`)
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
    return parts.join(' · ')
  }

  function initialOf(name) {
    const c = String(name || '').trim()[0]
    return c ? c.toUpperCase() : 'B'
  }

  return { renderAnswer, stepsLine, stepLabel, initialOf, statusOf }
})
