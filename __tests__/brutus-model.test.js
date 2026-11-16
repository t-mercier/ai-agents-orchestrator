const B = require('../renderer/lib/brutus-model')

const sessions = [
  { name: 'checkout-redesign', status: 'waiting', notesPath: '/w/FEAT/checkout-redesign/notes.md' },
  { name: 'legacy-export', state: 'stale', status: 'idle', notesPath: '/w/FEAT/legacy-export/notes.md' },
]

describe('renderAnswer', () => {
  test('a document he wrote becomes a card with an Open button', () => {
    const html = B.renderAnswer('Here it is: [[doc:perf-brief.html]]', sessions)
    expect(html).toContain('data-bru-doc="perf-brief.html"')
    expect(html).toContain('perf-brief.html')
  })
  test('a doc name that is not one plain file stays text', () => {
    for (const bad of ['../memory.md', 'a/b.md', 'x.sh', '.x.md']) {
      expect(B.renderAnswer(`[[doc:${bad}]]`, sessions)).not.toContain('data-bru-doc')
    }
  })
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
  test('a document he writes is named as a document, not as his memory', () => {
    const steps = [{ tool: 'Write', target: '/cfg/brutus/docs/perf-brief.html' }]
    expect(B.stepsLine(steps, sessions)).toBe('wrote perf-brief.html')
  })
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
  test('an edit of a session\'s notes is named as that, never as his memory', () => {
    expect(B.stepLabel({ tool: 'Edit', target: '/w/FEAT/legacy-export/notes.md' }, sessions)).toBe('Editing the notes of legacy-export')
    expect(B.stepLabel({ tool: 'Edit', target: '/w/FEAT/unknown/notes.md' }, sessions)).toBe("Editing a session's notes")
    const steps = [{ tool: 'Read', target: '/w/FEAT/legacy-export/notes.md' }, { tool: 'Edit', target: '/w/FEAT/legacy-export/notes.md' }]
    expect(B.stepsLine(steps, sessions)).toBe("notes of 1 session · edited one session's notes")
  })
})

test('status and initial', () => {
  expect(B.statusOf(sessions[1])).toBe('stale')
  expect(B.statusOf(sessions[0])).toBe('waiting')
  expect(B.initialOf('  élodie')).toBe('É')
  expect(B.initialOf('')).toBe('B')
})

describe('ticket and PR references', () => {
  const ss = [{ name: 'a', status: 'idle', ticket: 'PROJ-1', tickets: ['OPS-7'], prLinks: ['https://github.com/o/r/pull/12', 'https://github.com/o/s/pull/30'] },
    { name: 'b', status: 'idle', prLink: 'https://github.com/o/t/pull/30' }]
  const base = 'https://tracker.example/browse/'
  test('a key with a known prefix links to the tracker; an unknown prefix stays text', () => {
    const html = B.renderAnswer('PROJ-42 moved, see UTF-8 and OPS-7.', ss, base)
    expect(html).toContain('<a class="bru-ref" data-bru-url="https://tracker.example/browse/PROJ-42">PROJ-42</a>')
    expect(html).toContain('data-bru-url="https://tracker.example/browse/OPS-7"')
    expect(html).not.toContain('browse/UTF-8')
  })
  test('without a tracker URL no key is linked', () => {
    expect(B.renderAnswer('PROJ-42 moved.', ss, '')).not.toContain('bru-ref')
  })
  test('#N links when one known PR has that number; two make it ambiguous', () => {
    const html = B.renderAnswer('PR #12 merged, #30 closed, #99 open.', ss, base)
    expect(html).toContain('<a class="bru-ref" data-bru-url="https://github.com/o/r/pull/12">#12</a>')
    expect(html).not.toContain('>#30<')
    expect(html).not.toContain('>#99<')
  })
  test('a pasted PR URL is a link', () => {
    expect(B.renderAnswer('see https://github.com/o/r/pull/5 now', ss, base)).toContain('data-bru-url="https://github.com/o/r/pull/5">https://github.com/o/r/pull/5</a>')
  })
  test('a malformed PR link in the notes cannot add attributes to the link', () => {
    const evil = [{ name: 'x', status: 'idle', prLink: 'https://github.com/o" style="position:fixed;inset:0" x="/r/pull/12' }]
    expect(B.renderAnswer('PR #12 merged.', evil, base)).not.toContain('style=')
  })
  test('a PR URL whose repo looks like a ticket key is one link, not two nested', () => {
    const html = B.renderAnswer('see https://github.com/acme/PROJ-42/pull/5', ss, base)
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).not.toContain('browse/PROJ-42')
  })
  test('a tracker URL that is not http(s) links nothing', () => {
    expect(B.renderAnswer('PROJ-42 moved.', ss, 'javascript:alert(1)//')).not.toContain('bru-ref')
  })
  test('keys inside a chip or code, and escaped quotes, are left alone', () => {
    const named = [...ss, { name: 'PROJ-9 fix', status: 'idle' }]
    const html = B.renderAnswer("[[session:PROJ-9 fix]] and `PROJ-3` and it's #12", named, base)
    expect(html).not.toContain('browse/PROJ-9')
    expect(html).not.toContain('browse/PROJ-3')
    expect(html).toContain('data-brutus-session="PROJ-9 fix"')
    expect(html).toContain('it&#39;s')
    expect(html).toContain('>#12</a>')
  })
})

describe('proposed actions', () => {
  const columns = [{ id: 'todo', name: 'To do' }, { id: 'review', name: 'To review' }, { id: 'old', name: 'Old', hidden: true }]
  // Each verb applies to the stale session only, as the app's own rules would say.
  const why = Object.fromEntries(['archive', 'close', 'pause', 'sync', 'resume']
    .map(v => [v, (s) => s.state === 'stale' ? '' : `cannot ${v} it`]))
  const ctx = { columns, placements: { '/w/FEAT/checkout-redesign/notes.md': 'todo' }, categories: ['FEAT', 'BUG'], why }
  const render = (text) => B.renderAnswer(text, sessions, '', ctx)
  const resolve = (body) => B.resolveAction(B.parseAction(body), { sessions, ...ctx })

  test('a valid marker becomes an enabled button that names the action and the session', () => {
    const html = render('I can close it: [[action:close:legacy-export]]')
    expect(html).toContain('<button type="button" class="bru-act" data-bru-action="close" data-bru-target="legacy-export" data-bru-arg="">Close legacy-export</button>')
    expect(html).not.toContain('[[action:')
  })
  test('every session verb is resolved by the exact session name', () => {
    for (const v of ['archive', 'close', 'pause', 'sync', 'resume']) {
      const r = resolve(`${v}:legacy-export`)
      expect(r.ok).toBe(true)
      expect(r.session.name).toBe('legacy-export')
    }
    expect(resolve('close:Legacy-Export').ok).toBe(false)
  })
  test('an unknown session renders disabled, with the reason as its tooltip', () => {
    const html = render('[[action:archive:ghost]]')
    expect(html).toContain('disabled title="No session named &quot;ghost&quot;"')
    expect(html).toContain('>Archive ghost</button>')
  })
  test('an action that does not apply to the session renders disabled with the app\'s reason', () => {
    expect(render('[[action:close:checkout-redesign]]')).toContain('disabled title="cannot close it"')
  })
  test('an action with no rule in this window is disabled, never enabled by default', () => {
    expect(B.resolveAction(B.parseAction('close:legacy-export'), { sessions })).toMatchObject({ ok: false, why: 'Not available here' })
  })
  test('a bad verb renders a disabled button, not a silent no-op', () => {
    const html = render('[[action:delete:legacy-export]]')
    expect(html).toContain('data-bru-action="delete"')
    expect(html).toContain('disabled title="&quot;delete&quot; is not an action the app has"')
  })
  test('a board move names the column by id or by name, and refuses an unknown or hidden one', () => {
    expect(resolve('board:legacy-export:review')).toMatchObject({ ok: true, column: 'review', label: 'Move legacy-export to To review' })
    expect(resolve('board:legacy-export:to review')).toMatchObject({ ok: true, column: 'review' })
    expect(resolve('board:legacy-export:nowhere')).toMatchObject({ ok: false, why: 'No board column named "nowhere"' })
    expect(resolve('board:legacy-export:old')).toMatchObject({ ok: false, why: 'The column "Old" is hidden' })
    expect(resolve('board:ghost:review')).toMatchObject({ ok: false, why: 'No session named "ghost"' })
    expect(resolve('board:checkout-redesign:todo')).toMatchObject({ ok: false, why: 'Already in To do' })
    expect(resolve('board:legacy-export')).toMatchObject({ ok: false, why: 'No board column named ""' })
  })
  test('a session name with a colon still resolves, the column being the last part', () => {
    const r = B.resolveAction(B.parseAction('board:api: v2:review'), { sessions: [{ name: 'api: v2', notesPath: '/n.md' }], ...ctx })
    expect(r).toMatchObject({ ok: true, column: 'review' })
    expect(B.parseAction('close:api: v2')).toEqual({ verb: 'close', name: 'api: v2', arg: '' })
  })
  test('new opens a known category only', () => {
    expect(resolve('new:BUG')).toMatchObject({ ok: true, category: 'BUG', label: 'New BUG session' })
    expect(resolve('new:NOPE')).toMatchObject({ ok: false, why: 'No category named "NOPE"' })
    expect(render('[[action:new:BUG]]')).toContain('data-bru-action="new" data-bru-target="" data-bru-arg="BUG">New BUG session</button>')
  })
  test('a marker inside a code span stays literal text', () => {
    const html = render('Write `[[action:close:legacy-export]]` to propose it.')
    expect(html).not.toContain('<button')
    expect(html).toContain('<code>[[action:close:legacy-export]]</code>')
  })
  test('a name in a marker cannot inject markup, links or chips', () => {
    const html = render('[[action:close:<img src=x onerror=alert(1)> FEAT-1 [[session:legacy-export]]')
    expect(html).not.toContain('<img')
    const named = render('[[action:close:**x** FEAT-12]]')
    expect(named).not.toContain('<strong>')
    expect(named).toContain('data-bru-target="**x** FEAT-12"')
  })
  test('a stray placeholder byte in his text cannot pose as a button', () => {
    expect(render('a \u00000\u0000 b')).not.toContain('<button')
  })
})
