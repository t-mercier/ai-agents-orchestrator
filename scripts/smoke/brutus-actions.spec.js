// An action Brutus proposes is a button; a click goes through the app's own control for it,
// confirmation included, and one that cannot apply is disabled with the reason.
const { test, expect } = require('@playwright/test')

async function answer(page, text) {
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate((text) => {
    try { localStorage.removeItem('csm.brutusLog'); localStorage.removeItem('csm.kanban') } catch {}
    window.__BRUTUS_SCRIPT__ = { reads: [], text }
    window.CSMBrutusUI.setHome('bubble')
  }, text)
  await page.locator('.bru-panel.v-A textarea').fill('do it')
  await page.keyboard.press('Enter')
  await expect(page.locator('.bru-panel.v-A .bru-act').first()).toBeVisible()
}

test('a proposed close opens the same confirmation as the Close control, and Cancel does nothing', async ({ page }) => {
  await answer(page, 'I propose closing it: [[action:close:legacy-export]]')
  await page.evaluate(() => { window.__CLOSES__ = []; window.api.closeSession = async (...a) => { window.__CLOSES__.push(a); return { ok: true } }; window.api.wrapSession = async (...a) => { window.__CLOSES__.push(a); return { ok: true } } })
  await page.locator('.bru-act[data-bru-action="close"]').click()
  await expect(page.locator('#confirm-modal')).toBeVisible()
  await expect(page.locator('#confirm-title')).toHaveText('Close session')
  await page.locator('#confirm-cancel').click()
  expect(await page.evaluate(() => window.__CLOSES__.length)).toBe(0)
})

test('an unknown session, a bad verb and a session in the wrong state render disabled with the reason', async ({ page }) => {
  await answer(page, '[[action:archive:ghost]] [[action:delete:legacy-export]] [[action:archive:legacy-export]]')
  const b = page.locator('.bru-panel.v-A .bru-act')
  await expect(b).toHaveCount(3)
  await expect(b.nth(0)).toBeDisabled()
  await expect(b.nth(0)).toHaveAttribute('title', 'No session named "ghost"')
  await expect(b.nth(1)).toHaveAttribute('title', '"delete" is not an action the app has')
  await expect(b.nth(2)).toHaveAttribute('title', 'Only a closed session can be archived')
})

test('a proposed board move places the session in that column', async ({ page }) => {
  await answer(page, '[[action:board:legacy-export:review]]')
  await page.locator('.bru-act[data-bru-action="board"]').click()
  const col = await page.evaluate(() => {
    const s = window.CSMBrutusSessions().find(x => x.name === 'legacy-export')
    return window.CSMBoard.load().placements[s.notesPath || s.sessionId || s.name]
  })
  expect(col).toBe('review')
  await expect(page.locator('.bru-act[data-bru-action="board"]')).toHaveAttribute('title', 'Already in To review')
})

test('a proposed new session opens the dialog with its category chosen, and starts nothing', async ({ page }) => {
  await answer(page, '[[action:new:BUG]]')
  await page.evaluate(() => { window.__LAUNCHED__ = 0; window.api.startSession = async () => { window.__LAUNCHED__++; return { ok: true } } })
  await page.locator('.bru-act[data-bru-action="new"]').click()
  await expect(page.locator('#new-session-modal')).toBeVisible()
  await expect(page.locator('#ns-category')).toHaveValue('BUG')
  expect(await page.evaluate(() => window.__LAUNCHED__)).toBe(0)
})

// The lists his buttons are checked against are read again after the app changes a
// session: one closed after launch can be archived from his next answer without a restart.
test('a session closed after launch is archivable from his next answer', async ({ page }) => {
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(() => {
    try { localStorage.removeItem('csm.brutusLog') } catch {}
    const all = window.api.getHistoricalAll, live = window.api.getSessions
    // legacy-export is stale at launch (the fixture lists it with the live ones); from now on
    // the backend reports it closed.
    const was = window.CSMBrutusSessions().find(s => s.name === 'legacy-export')
    window.api.getSessions = async () => (await live()).filter(s => s.name !== 'legacy-export')
    window.api.getHistoricalAll = async () => {
      const h = await all()
      return { ...h, closed: [{ ...was, state: 'closed', historyStatus: 'closed' }, ...h.closed] }
    }
    window.__BRUTUS_SCRIPT__ = { reads: [], text: '[[action:archive:legacy-export]]' }
    window.refreshSessions()   // what the app does once it has closed a session
    window.CSMBrutusUI.setHome('bubble')
  })
  await page.locator('.bru-panel.v-A textarea').fill('archive it')
  await page.keyboard.press('Enter')
  await expect(page.locator('.bru-act[data-bru-action="archive"]')).toBeEnabled()
  await page.locator('.bru-act[data-bru-action="archive"]').click()
  await expect(page.locator('#confirm-title')).toHaveText('Archive session')
  await page.locator('#confirm-cancel').click()
})

// A click re-reads the sessions; when that read fails it acts on nothing and says so.
test('a failed re-read on a click does nothing and says so', async ({ page }) => {
  await answer(page, '[[action:close:legacy-export]]')
  await page.evaluate(() => { window.api.getHistoricalAll = () => Promise.reject(new Error('scan failed')) })
  await page.locator('.bru-act[data-bru-action="close"]').click()
  await expect(page.locator('.bru-panel.v-A .bru-err').last()).toHaveText('Could not read the sessions, nothing was done.')
  await expect(page.locator('#confirm-modal')).toBeHidden()
})
