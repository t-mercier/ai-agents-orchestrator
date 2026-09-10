// Where a pinned skill runs, and why. UMD, pure — no DOM, no IPC.
//
// A session can be reached two ways, and the wrong one is destructive rather than merely
// useless: writing into the pty of a session whose agent is mid-task inserts the command
// into that turn. So the state decides, never the user: an open, idle terminal gets the
// slash command typed in (visible, reviewable, in their own scrollback); no terminal means
// a headless `claude -p` run; anything in between is refused with the reason said out loud.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMSkillLaunch = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // A session id we can hand to `claude --resume`. Placeholders like "to fill" are what a
  // notes.md carries when it was never attached to a live session.
  const RESUMABLE = /^[A-Za-z0-9_-]+$/
  const resumeId = (sid) => (sid && RESUMABLE.test(sid) ? sid : null)
  const clean = (skill) => String(skill || '').trim().replace(/^\//, '')

  function decide(skill, ctx) {
    const name = clean(skill)
    if (!name) return { mode: 'empty' }
    const c = ctx || {}
    if (c.hasTerminal) {
      const st = c.status || ''
      if (st === 'busy' || st === 'waiting') {
        return {
          mode: 'blocked',
          reason: st === 'busy'
            ? 'This session is working — typing into its terminal now would land inside the turn. Run it when the session is idle.'
            : 'This session is waiting on an answer — typing into its terminal now would answer for you. Reply first.',
        }
      }
      return { mode: 'terminal', input: '/' + name + '\r' }
    }
    return { mode: 'headless', prompt: '/' + name, resume: resumeId(c.sessionId) }
  }

  function tooltip(skill, ctx) {
    const name = clean(skill)
    if (!name) return 'Pin a skill to this slot'
    const d = decide(name, ctx)
    if (d.mode === 'blocked') return d.reason
    if (d.mode === 'terminal') return `/${name} — typed into this session's terminal`
    return `/${name} — headless run${d.resume ? ', resuming this session' : ''}`
  }

  return { decide, tooltip, resumeId, clean }
})
