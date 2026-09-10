const M = require('../renderer/lib/skill-launch-model')

const live = (status) => ({ hasTerminal: true, status })
const dead = (over) => ({ hasTerminal: false, sessionId: 'abc-123', ...over })

describe('decide — where a pinned skill runs', () => {
  it('types into the terminal when the session is open and idle', () => {
    expect(M.decide('daily-ops', live('idle'))).toEqual({ mode: 'terminal', input: '/daily-ops\r' })
  })

  // A pty write lands in whatever the agent is doing — mid-task, that corrupts the turn.
  it('refuses to type into a session that is working', () => {
    const d = M.decide('daily-ops', live('busy'))
    expect(d.mode).toBe('blocked')
    expect(d.reason).toMatch(/working/i)
  })

  it('refuses just the same when the session is waiting on an answer', () => {
    expect(M.decide('daily-ops', live('waiting')).mode).toBe('blocked')
  })

  it('runs headless, resuming the session, when no terminal is open', () => {
    expect(M.decide('save-session', dead())).toEqual({ mode: 'headless', prompt: '/save-session', resume: 'abc-123' })
  })

  it('still runs headless without a resume when the session has no usable id', () => {
    expect(M.decide('sync-refs', dead({ sessionId: 'to fill' })).resume).toBe(null)
    expect(M.decide('sync-refs', dead({ sessionId: '' })).resume).toBe(null)
  })

  it('is a plain headless run when there is no session at all (a global button)', () => {
    expect(M.decide('daily-ops', {})).toEqual({ mode: 'headless', prompt: '/daily-ops', resume: null })
  })

  it('does nothing for an empty slot', () => {
    expect(M.decide('', live('idle')).mode).toBe('empty')
    expect(M.decide(null, {}).mode).toBe('empty')
  })

  it('sends the skill name as a slash command, whatever the user pinned', () => {
    expect(M.decide('/daily-ops', live('idle')).input).toBe('/daily-ops\r')
    expect(M.decide('  daily-ops  ', live('idle')).input).toBe('/daily-ops\r')
  })
})

describe('tooltip — the button says what it will do before it does it', () => {
  it('names the destination', () => {
    expect(M.tooltip('daily-ops', live('idle'))).toMatch(/terminal/i)
    expect(M.tooltip('daily-ops', dead())).toMatch(/headless/i)
  })
  it('gives the reason when it will not run', () => {
    expect(M.tooltip('daily-ops', live('busy'))).toMatch(/working/i)
  })
  it('invites a pick on an empty slot', () => {
    expect(M.tooltip('', {})).toMatch(/pin a skill/i)
  })
})
