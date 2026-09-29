const P = require('../renderer/lib/pets')

describe('pets', () => {
  test('there are nine companions and the blob comes first, as the config default', () => {
    expect(P.NAMES).toEqual(['blob', 'ghost', 'bunny', 'cloud', 'star', 'cat', 'crab', 'robot', 'devil'])
    for (const n of P.NAMES) expect(typeof P.LABELS[n]).toBe('string')
  })

  test('each companion draws a whole svg in the state it is given', () => {
    for (const n of P.NAMES) {
      const svg = P.svg(n, 'think')
      expect(svg.startsWith('<svg')).toBe(true)
      expect(svg.endsWith('</svg>')).toBe(true)
      expect(svg).toContain('class="pet-svg pe-think')
      expect(svg).toContain('pe-body')
    }
  })

  test('an unknown companion or state falls back instead of drawing nothing', () => {
    const norm = (s) => s.replace(/pe-g\d+/g, 'G')
    expect(norm(P.svg('dragon', 'rest'))).toBe(norm(P.svg('blob', 'rest')))
    expect(P.svg('blob', 'party')).toContain('pe-rest')
  })

  test('two drawings of one companion never share a gradient id', () => {
    const ids = (s) => [...s.matchAll(/id="(pe-g\d+)"/g)].map(m => m[1])
    expect(ids(P.svg('cat')).some(id => ids(P.svg('cat')).includes(id))).toBe(false)
  })

  test('the waiting badge shows a number, and nothing else can reach the markup', () => {
    expect(P.svg('crab', 'wait', { count: 3 })).toContain('>3<')
    expect(P.svg('crab', 'wait', { count: 120 })).toContain('>9+<')
    expect(P.svg('crab', 'wait', { count: '<img onerror=x>' })).not.toContain('<img')
  })

  // Asked for on 2026-09-29: ears and horns grow out of the head, in the body's own
  // gradient, instead of being separate shapes set on top of it.
  test('the bunny, the cat and the devil are one silhouette in one gradient', () => {
    for (const n of ['bunny', 'cat', 'devil']) {
      const svg = P.svg(n)
      expect(svg).toContain('gradientUnits="userSpaceOnUse"')
      expect(svg).not.toContain('pe-ear')
      expect(svg).not.toMatch(/<ellipse[^>]*fill="url\(#/)   // the head is no longer a bare ellipse
    }
  })

  test('a still drawing does not animate, for the avatars beside each answer', () => {
    expect(P.svg('ghost', 'rest', { still: true })).toContain('pe-still')
  })
})
