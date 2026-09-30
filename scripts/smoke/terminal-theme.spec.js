// The embedded terminal's themes (asked for on 2026-09-30): Night, Dusk, Mist and Day in the
// app's colours, Auto following the app, and Source Code Pro bundled as the default font.
const { test, expect } = require('@playwright/test')

async function open(page, stored) {
  await page.addInitScript((s) => {
    try {
      if (s) localStorage.setItem('csm.terminal', JSON.stringify(s))
      else localStorage.removeItem('csm.terminal')
    } catch {}
  }, stored || null)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
}

const paneBg = (page) => page.evaluate(() => document.getElementById('detail-terminal-pane').style.background)

test('choosing Dusk in Settings saves it and paints the terminal pane', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.openSettingsTab('terminal'))
  await page.selectOption('#set-term-theme', 'dusk')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('csm.terminal')))
  expect(saved.theme).toBe('dusk')
  expect(await paneBg(page)).toBe('rgb(42, 45, 56)')
})

test('Auto follows the app from dark to light', async ({ page }) => {
  await open(page, { theme: 'auto' })
  await page.evaluate(() => window.applyTheme('dark'))
  await expect.poll(() => paneBg(page)).toBe('rgb(18, 19, 25)')
  await page.evaluate(() => window.applyTheme('light'))
  await expect.poll(() => paneBg(page)).toBe('rgb(255, 255, 255)')
})

test('picking a colour by hand switches the theme to Custom', async ({ page }) => {
  await open(page, { theme: 'mist' })
  await page.evaluate(() => window.openSettingsTab('terminal'))
  await page.locator('#set-term-bg').evaluate((el) => { el.value = '#002b36'; el.dispatchEvent(new Event('change')) })
  await expect(page.locator('#set-term-theme')).toHaveValue('custom')
  expect(await paneBg(page)).toBe('rgb(0, 43, 54)')
})

test('a new install starts on Source Code Pro, and the font file is served', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.openSettingsTab('terminal'))
  await expect(page.locator('#set-term-font')).toHaveValue('sourcecode')
  const loaded = await page.evaluate(async () => {
    await document.fonts.load("13px 'Source Code Pro'")
    return document.fonts.check("13px 'Source Code Pro'")
  })
  expect(loaded).toBe(true)
})
