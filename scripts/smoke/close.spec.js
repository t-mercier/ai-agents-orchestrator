// A Close that ends without a fresh summary stamps its own marker. The marker is skipped
// only for a close written since this Close began, so the renderer has to say when that
// was: without it, a session closed this morning and closed again now landed Stale.
const { test, expect } = require('@playwright/test')

test('ending a wrap-up early tells close_session when the Close began', async ({ page }) => {
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  const r = await page.evaluate(async () => {
    window.api.ptyInput = () => Promise.resolve()
    window.api.notesClosedSince = async () => false
    const closes = []
    window.api.closeSession = async (...a) => { closes.push(a); return { ok: true } }
    window.openTerminalPane('S9', '/tmp', '', '', '/w/BUG/x/notes.md')
    await new Promise(r => setTimeout(r, 50))
    window._lastSessions = [...(window._lastSessions || []), { sessionId: 'S9', notesPath: '/w/BUG/x/notes.md' }]
    const before = Date.now()
    window.closeTerminalPane()          // injects /close-session, starts waiting
    await new Promise(r => setTimeout(r, 20))
    await window.closeTerminalPane()    // second click: end now, without a summary
    return { closes, before }
  })
  expect(r.closes).toHaveLength(1)
  expect(r.closes[0][0]).toBe('/w/BUG/x/notes.md')
  expect(typeof r.closes[0][1]).toBe('number')
  expect(r.closes[0][1]).toBeGreaterThanOrEqual(r.before)
})
