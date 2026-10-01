// ⌥⌘P measures how smoothly the app scrolls, in the real app, and says it in one line.
const { test, expect } = require('@playwright/test')

test('⌥⌘P records frames, then shows and copies one line', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(() => { const r = window.CSMFrameProbe.record; window.CSMFrameProbe.record = () => r(300) })
  await page.keyboard.press('Meta+Alt+KeyP')
  await expect(page.locator('.shortcut-note')).toContainText('scroll now')
  const note = page.locator('.frame-probe-result')
  await expect(note).toContainText(/Scroll: \d+ fps · p50 \d+ ms/)
  // Nothing claims a copy before the click (WKWebView refuses it without a gesture).
  await expect(note).not.toContainText('copied')
  await page.waitForTimeout(4000)
  await expect(note).toBeVisible()
  await note.locator('[data-a=copy]').click()
  await expect(note.locator('[data-a=copy]')).toHaveText('Copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^Scroll: \d+ fps/)
  await note.locator('[data-a=close]').click()
  await expect(note).toHaveCount(0)
})

test('⌥⌘P cannot be taken by a custom shortcut', async ({ page }) => {
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  expect(await page.evaluate(() => window.CSMKeymap.check('Mod+Alt+P', {}, 'newSession').ok)).toBe(false)
})
