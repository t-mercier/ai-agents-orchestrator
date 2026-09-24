// Moving Brutus in Settings took effect inside collect(), before validation. A Save that
// was refused had already moved him, and Cancel did not move him back.
const { test, expect } = require('@playwright/test')

test('a refused Save then Cancel leaves Brutus where he was', async ({ page }) => {
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(() => { try { localStorage.setItem('csm.brutusHome', 'bubble') } catch {} })
  await page.evaluate(() => window.openSettingsTab('assistant'))
  await page.locator('input[name="set-assistant-home"][value="side"]').check()
  // Break another tab so the Save is refused: a space with no name.
  await page.evaluate(() => {
    const name = document.querySelector('#set-space-list input')
    name.value = ''
    name.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.locator('#settings-modal form').evaluate((f) => f.requestSubmit())
  await expect(page.locator('#settings-modal')).toHaveAttribute('open', '')
  await page.evaluate(() => document.getElementById('settings-modal').close())
  expect(await page.evaluate(() => localStorage.getItem('csm.brutusHome'))).toBe('bubble')
  await expect(page.locator('body')).not.toHaveClass(/bru-docked/)
})
