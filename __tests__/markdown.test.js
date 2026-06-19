const M = require('../renderer/lib/markdown')

describe('applyInlineMarkdown', () => {
  it('renders strike, bold, code', () => {
    expect(M.applyInlineMarkdown('~~a~~ **b** `c`')).toBe('<s>a</s> <strong>b</strong> <code>c</code>')
  })
})

describe('doneInner — detects completed steps', () => {
  it('strikethrough + **done** + date', () => {
    const r = M.doneInner('~~Native unit tests on PR #4870~~ — **done** 2026-05-27.')
    expect(r).toContain('done-tag')
    expect(r).toContain('<s>Native unit tests on PR #4870.</s>')
    expect(r).toContain('2026-05-27')
  })
  it('plain "— done <date>" without markdown', () => {
    const r = M.doneInner('Native unit tests on PR #4870 — done 2026-05-27.')
    expect(r).toContain('<s>Native unit tests on PR #4870.</s>')
    expect(r).toContain('2026-05-27')
  })
  it('DONE: prefix, no date', () => {
    const r = M.doneInner('DONE: local native test + mutation-check (race proven fixed A+B).')
    expect(r).toContain('<s>local native test + mutation-check (race proven fixed A+B).</s>')
    expect(r).not.toContain('done-date')
  })
  it('mid-line done with UTC datetime + trailing hash', () => {
    const r = M.doneInner('PR #4870 merged on main — done 2026-05-28 17:46 UTC as 9966a363f.')
    expect(r).toContain('2026-05-28 17:46 UTC')
    expect(r).toContain('merged on main')
  })
})

describe('doneInner — leaves real TODOs alone', () => {
  it('a normal todo returns null', () => {
    expect(M.doneInner('Create dedicated bug ticket, set Implements: to it.')).toBeNull()
  })
  it('"File separate ticket" returns null', () => {
    expect(M.doneInner('File separate ticket for issue #3 (AssetFetcher double-thread crash).')).toBeNull()
  })
})

describe('renderMarkdown', () => {
  it('renders a numbered list', () => {
    const html = M.renderMarkdown('1. first\n2. second')
    expect(html).toBe('<ol><li>first</li><li>second</li></ol>')
  })
  it('renders sub-bullets as a ul', () => {
    const html = M.renderMarkdown('  - a\n  - b')
    expect(html).toBe('<ul><li>a</li><li>b</li></ul>')
  })
  it('renders plain lines as paragraphs', () => {
    expect(M.renderMarkdown('hello world')).toBe('<p>hello world</p>')
  })
  it('marks a done numbered item with step-done class', () => {
    const html = M.renderMarkdown('1. ~~ship it~~ — **done** 2026-06-01')
    expect(html).toContain('<li class="step-done">')
    expect(html).toContain('done-tag')
  })
  it('escapes HTML in content (no XSS)', () => {
    const html = M.renderMarkdown('1. <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
  it('returns empty string for empty input', () => {
    expect(M.renderMarkdown('')).toBe('')
  })
})
