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

test('Stop pressed before claude has started says it was received', async ({ page }) => {
  // Still preparing: the ask has not answered and no event has arrived.
  await page.evaluate(() => {
    window.api.brutusAsk = () => new Promise(() => {})
    window.api.brutusCancel = () => Promise.resolve(true)
  })
  await page.locator('.bru-fab').click()
  await page.locator('.bru-panel input').fill('anything')
  await page.keyboard.press('Enter')
  // Each render re-mounts the panel with its pop animation: click without waiting for it.
  await page.locator('.bru-panel [data-bru="stop"]').dispatchEvent('click')
  await expect(page.locator('.bru-panel .bru-steps').last()).toContainText('Stopping')
  await expect(page.locator('.bru-panel [data-bru="stop"]')).toBeDisabled()
})

test('a failed reset keeps the conversation and says why', async ({ page }) => {
  await page.locator('.bru-fab').click()
  await page.locator('.bru-panel input').fill("What's waiting on me?")
  await page.keyboard.press('Enter')
  await expect(page.locator('.bru-panel .bru-u')).toHaveCount(1)
  await expect(page.locator('.bru-panel input')).toBeEnabled()
  await page.evaluate(() => { window.api.brutusReset = () => Promise.resolve({ ok: false, error: 'EACCES: permission denied' }) })
  await page.locator('.bru-panel [data-bru="reset"]').dispatchEvent('click')
  await expect(page.locator('.bru-panel .bru-err')).toContainText('EACCES')
  await expect(page.locator('.bru-panel .bru-u')).toHaveCount(1)
})

test('opening his memory from the panel says so when it fails', async ({ page }) => {
  await page.evaluate(() => { window.api.brutusOpenMemory = () => Promise.resolve({ ok: false, error: 'no opener found' }) })
  await page.locator('.bru-fab').click()
  await page.locator('.bru-panel [data-bru="memory"]').dispatchEvent('click')
  await expect(page.locator('.bru-panel .bru-err')).toContainText('no opener found')
})

test('opening his memory from Settings says so when it fails', async ({ page }) => {
  await page.evaluate(() => { window.api.brutusOpenMemory = () => Promise.resolve({ ok: false, error: 'no opener found' }) })
  await page.evaluate(() => window.openSettingsTab('assistant'))
  await page.locator('#set-assistant-memory').click()
  await expect(page.locator('#set-error')).toBeVisible()
  await expect(page.locator('#set-error')).toContainText('no opener found')
})
