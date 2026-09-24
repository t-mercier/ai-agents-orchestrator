// Brutus regressions found in the 2026-09 review. Same fixture as ui.spec.js; each test
// replaces one window.api call, which brutus.js reads at call time.
const { test, expect } = require('@playwright/test')

test.beforeEach(async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.__errors = errors
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(() => { try { localStorage.removeItem('csm.brutusHome'); localStorage.removeItem('csm.brutusLog') } catch {} })
  await page.reload()
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
})

test('an unreadable memory file is not shown as nothing remembered', async ({ page }) => {
  await page.evaluate(async () => {
    window.api.brutusStatus = () => Promise.resolve({ memoryCount: null, running: false, hasConversation: false })
    await window.CSMBrutusUI.refresh()
  })
  await page.locator('.bru-fab').click()
  await expect(page.locator('.bru-panel .bru-sub')).toHaveText('Could not read his memory')
})
