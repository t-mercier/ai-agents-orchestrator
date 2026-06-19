// Markdown rendering for the "Next steps" / notes sections, including uniform
// "done" detection across the conventions used in notes.md files.
// UMD: window.CSMMarkdown in the renderer, require() in jest. Pure, no DOM.
// Depends on CSMFormatters.escapeHtml (loaded first in the renderer; required here).
(function (root, factory) {
  const F = (typeof module !== 'undefined' && module.exports)
    ? require('./formatters')
    : root.CSMFormatters
  const api = factory(F)
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMMarkdown = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function (F) {
  const escapeHtml = F.escapeHtml
  const DATE_RE = /\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?(?:\s*UTC)?/

  function applyInlineMarkdown(text) {
    return text
      .replace(/~~(.*?)~~/g, '<s>$1</s>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
  }

  // Uniform "done" rendering for a step written as `~~text~~ — **done** 2026-05-27`,
  // `Text — done <date>`, `DONE: text`, or `**done**`. Returns inner HTML, or null
  // if the content is not a completed step.
  function doneInner(content) {
    const isDone =
      /^\s*DONE\b[:.\-–—\s]/i.test(content) ||
      /~~.+?~~/.test(content) ||
      /[—–-]\s*\*{0,2}done\b/i.test(content) ||
      /\*\*done\*\*/i.test(content)
    if (!isDone) return null

    let rest = content.replace(/^\s*DONE\b[:.\-–—\s]+/i, '')
    const dateM = rest.match(DATE_RE)
    const date = dateM ? dateM[0].trim() : null
    if (dateM) rest = rest.replace(dateM[0], '')
    rest = rest
      .replace(/[—–-]?\s*\*{0,2}done\*{0,2}/i, '')
      .replace(/~~/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;])/g, '$1')
      .replace(/^[\s—–-]+|[\s—–-]+$/g, '')
      .trim()

    return `<span class="done-tag">✓ done</span> <s>${applyInlineMarkdown(escapeHtml(rest))}</s>` +
      (date ? ` <span class="done-date">${escapeHtml(date)}</span>` : '')
  }

  // { cls, html } for a list item / paragraph, done-aware.
  function renderItemContent(content) {
    const done = doneInner(content)
    return done !== null
      ? { cls: ' class="step-done"', html: done }
      : { cls: '', html: applyInlineMarkdown(escapeHtml(content)) }
  }

  function renderMarkdown(raw) {
    if (!raw) return ''
    const lines = raw.split('\n')
    const out = []
    let inOl = false
    let inUl = false
    const closeUl = () => { if (inUl) { out.push('</ul>'); inUl = false } }
    const closeOl = () => { if (inOl) { out.push('</ol>'); inOl = false } }

    for (const line of lines) {
      const numberedMatch = line.match(/^(\d+)\. (.*)/)
      const subBulletMatch = line.match(/^ {2,}- (.*)/)
      if (numberedMatch) {
        closeUl()
        if (!inOl) { out.push('<ol>'); inOl = true }
        const { cls, html } = renderItemContent(numberedMatch[2])
        out.push(`<li${cls}>${html}</li>`)
      } else if (subBulletMatch) {
        if (!inUl) { out.push('<ul>'); inUl = true }
        const { cls, html } = renderItemContent(subBulletMatch[1])
        out.push(`<li${cls}>${html}</li>`)
      } else {
        closeUl()
        closeOl()
        if (line.trim()) {
          const { cls, html } = renderItemContent(line)
          out.push(`<p${cls}>${html}</p>`)
        }
      }
    }
    closeUl()
    closeOl()
    return out.join('')
  }

  return { applyInlineMarkdown, doneInner, renderItemContent, renderMarkdown, DATE_RE }
})
