const F = require('../renderer/lib/formatters')

describe('truncate', () => {
  it('leaves short strings intact', () => expect(F.truncate('hi', 10)).toBe('hi'))
  it('truncates with ellipsis', () => expect(F.truncate('abcdef', 4)).toBe('abc…'))
  it('handles empty/undefined', () => { expect(F.truncate('', 5)).toBe(''); expect(F.truncate(undefined, 5)).toBe('') })
})

describe('escapeHtml', () => {
  it('escapes all five entities', () => {
    expect(F.escapeHtml(`<a href="x" id='y'>&`)).toBe('&lt;a href=&quot;x&quot; id=&#39;y&#39;&gt;&amp;')
  })
  it('neutralizes a script-injection attempt', () => {
    expect(F.escapeHtml('<img src=x onerror="alert(1)">')).not.toContain('<img')
  })
  it('handles empty', () => expect(F.escapeHtml('')).toBe(''))
})

describe('statusLabel', () => {
  it('maps known statuses', () => {
    expect(F.statusLabel('busy')).toBe('BUSY')
    expect(F.statusLabel('waiting')).toBe('WAIT')
    expect(F.statusLabel('idle')).toBe('IDLE')
    expect(F.statusLabel('shell')).toBe('SHELL')
  })
  it('uppercases an unknown status', () => expect(F.statusLabel('paused')).toBe('PAUSED'))
  it('defaults empty to IDLE', () => expect(F.statusLabel('')).toBe('IDLE'))
})

describe('sessionTime', () => {
  it('returns a numeric updatedAt as-is', () => expect(F.sessionTime({ updatedAt: 1780000000000 })).toBe(1780000000000))
  it('parses an ISO updatedAt', () => expect(F.sessionTime({ updatedAt: '2026-06-03T10:00:00.000Z' })).toBe(Date.parse('2026-06-03T10:00:00.000Z')))
  it('falls back lastActivityAt then startedAt', () => {
    expect(F.sessionTime({ lastActivityAt: 42 })).toBe(42)
    expect(F.sessionTime({ startedAt: '2026-01-01' })).toBe(Date.parse('2026-01-01'))
  })
  it('returns 0 when absent or unparseable', () => {
    expect(F.sessionTime({})).toBe(0)
    expect(F.sessionTime({ updatedAt: 'not-a-date' })).toBe(0)
  })
  it('picks the MORE RECENT of updatedAt / lastActivityAt, not a fixed priority', () => {
    // Pause kills the pty without touching notes.md — updatedAt (notes.md mtime) can be
    // days old while lastActivityAt (transcript) is from today. The fresher one must win.
    expect(F.sessionTime({ updatedAt: 1000, lastActivityAt: 5000 })).toBe(5000)
    expect(F.sessionTime({ updatedAt: 5000, lastActivityAt: 1000 })).toBe(5000)
  })
})

describe('formatTimestamp', () => {
  const now = Date.parse('2026-06-03T12:00:00.000Z')
  it('just now under a minute', () => expect(F.formatTimestamp(now - 30 * 1000, now)).toBe('just now'))
  it('minutes', () => expect(F.formatTimestamp(now - 5 * 60000, now)).toBe('5m ago'))
  it('hours', () => expect(F.formatTimestamp(now - 3 * 3600000, now)).toBe('3h ago'))
  it('empty for falsy', () => expect(F.formatTimestamp(0, now)).toBe(''))
})

describe('formatDateTime', () => {
  it('formats epoch ms', () => expect(F.formatDateTime(Date.parse('2026-06-03T14:32:00'))).toMatch(/Jun 3, 2026/))
  it('returns empty for falsy / invalid', () => {
    expect(F.formatDateTime(null)).toBe('')
    expect(F.formatDateTime('nope')).toBe('')
  })
})

describe('formatAge', () => {
  const now = Date.parse('2026-06-10T12:00:00.000Z')
  it('now under a minute', () => expect(F.formatAge(now - 30 * 1000, now)).toBe('now'))
  it('minutes', () => expect(F.formatAge(now - 5 * 60000, now)).toBe('5m'))
  it('hours', () => expect(F.formatAge(now - 3 * 3600000, now)).toBe('3h'))
  it('days', () => expect(F.formatAge(now - 3 * 86400000, now)).toBe('3d'))
  it('weeks', () => expect(F.formatAge(now - 14 * 86400000, now)).toBe('2w'))
  it('months', () => expect(F.formatAge(now - 90 * 86400000, now)).toBe('3mo'))
  it('years', () => expect(F.formatAge(now - 400 * 86400000, now)).toBe('1y'))
  it('empty for falsy', () => expect(F.formatAge(0, now)).toBe(''))
})

describe('firstNextStep — the card cue is the next ACTION', () => {
  const { firstNextStep } = require('../renderer/lib/formatters')

  it('takes the first open item', () => {
    expect(firstNextStep('- [ ] Rebase the branch on main\n- [ ] Re-push')).toBe('Rebase the branch on main')
  })

  it('skips items already done — they advertise finished work', () => {
    const s = '- [x] PR #5080 merged (2026-07-10)\n- [x] CI green\n- [ ] Ask Ruben for a second review'
    expect(firstNextStep(s)).toBe('Ask Ruben for a second review')
  })

  it('skips a parenthesised preamble, which is not a step', () => {
    const s = '(Current list. 0.14.0-alpha tagged 2026-09-08.)\n\n- [ ] Verify the release after CI'
    expect(firstNextStep(s)).toBe('Verify the release after CI')
  })

  it('treats a struck-through item as done', () => {
    expect(firstNextStep('- ~~S0 native merged~~ — see below\n- [ ] Land S2')).toBe('Land S2')
  })

  it('still works on a section written as prose, without bullets', () => {
    expect(firstNextStep('PR #35753 open; await CI + review.')).toBe('PR #35753 open; await CI + review.')
  })

  it('keeps plain bullets that carry no checkbox', () => {
    expect(firstNextStep('- Check PR #4702 CI status')).toBe('Check PR #4702 CI status')
  })

  it('returns empty when every item is done, rather than showing one', () => {
    expect(firstNextStep('- [x] All shipped\n- [x] Released')).toBe('')
  })

  it('is quiet on nothing at all', () => {
    expect(firstNextStep('')).toBe('')
    expect(firstNextStep(null)).toBe('')
    expect(firstNextStep(undefined)).toBe('')
  })
})
