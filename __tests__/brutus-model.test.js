const B = require('../renderer/lib/brutus-model')

const sessions = [
  { name: 'checkout-redesign', status: 'waiting', notesPath: '/w/FEAT/checkout-redesign/notes.md' },
  { name: 'legacy-export', state: 'stale', status: 'idle', notesPath: '/w/FEAT/legacy-export/notes.md' },
]

describe('renderAnswer', () => {
  test('escapes HTML before any formatting — model output is untrusted', () => {
    const html = B.renderAnswer('<img src=x onerror=alert(1)> **ok**', sessions)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
    expect(html).toContain('<strong>ok</strong>')
  })
  test('a known session becomes a chip with its status; an unknown one stays text', () => {
    const html = B.renderAnswer('[[session:checkout-redesign]] and [[session:nope]]', sessions)
    expect(html).toContain('data-brutus-session="checkout-redesign"')
    expect(html).toContain('bru-dot waiting')
    expect(html).not.toContain('data-brutus-session="nope"')
    expect(html).toContain('nope')
  })
  test('an attribute-breaking name cannot escape the chip', () => {
    const html = B.renderAnswer('[[session:a" onclick="x]]', [{ name: 'a" onclick="x', status: 'idle' }])
    expect(html).not.toContain('onclick="x"')
  })
  test('dash lists become a list; blank lines split paragraphs; code stays code', () => {
    const html = B.renderAnswer('Two:\n- one\n- two\n\nThen `x < y`.', sessions)
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>')
    expect(html).toContain('<code>x &lt; y</code>')
    expect((html.match(/<p>/g) || []).length).toBe(2)
  })
})

describe('stepsLine', () => {
  test('summarises what was read in plain words', () => {
    const steps = [
      { tool: 'Read', target: '/cfg/brutus/dashboard.md' },
      { tool: 'Read', target: '/w/FEAT/checkout-redesign/notes.md' },
      { tool: 'Read', target: '/w/FEAT/legacy-export/notes.md' },
      { tool: 'Grep', target: 'retry' },
      { tool: 'Read', target: '/cfg/brutus/memory.md' },
    ]
    expect(B.stepsLine(steps, sessions)).toBe('Read the dashboard · notes of 2 sessions · searched "retry" · his memory')
  })
  test('the live label names the session being read', () => {
    expect(B.stepLabel({ tool: 'Read', target: '/w/FEAT/legacy-export/notes.md' }, sessions)).toBe('Reading the notes of legacy-export')
    expect(B.stepLabel({ tool: 'Edit', target: '/cfg/brutus/memory.md' }, sessions)).toBe('Writing to his memory')
  })
})

test('status and initial', () => {
  expect(B.statusOf(sessions[1])).toBe('stale')
  expect(B.statusOf(sessions[0])).toBe('waiting')
  expect(B.initialOf('  élodie')).toBe('É')
  expect(B.initialOf('')).toBe('B')
})
