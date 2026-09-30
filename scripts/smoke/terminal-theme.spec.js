// The app's themes (asked for on 2026-09-30): Dark, Dusk, Mist and Light for the whole app,
// the embedded terminal following them, and Source Code Pro bundled as its default font.
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

test('Dusk themes the whole app and the terminal, and the window behind them', async ({ page }) => {
  await open(page)
  await page.evaluate(() => {
    window.__BG__ = []
    const orig = window.api.setWindowBg
    window.api.setWindowBg = (t) => { window.__BG__.push(t); return orig && orig(t) }
  })
  await page.evaluate(() => window.openSettingsTab('appearance'))
  await page.locator('.theme-toggle [data-theme-choice="dusk"]').click()
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dusk')
  expect(await page.evaluate(() => localStorage.getItem('csm.theme'))).toBe('dusk')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())).toBe('rgb(42, 45, 56)')
  await expect.poll(() => paneBg(page)).toBe('rgb(42, 45, 56)')
  expect(await page.evaluate(() => window.__BG__)).toContain('dusk')
})

test('Mist is a light theme: overlays and text take the dark tint', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.applyTheme('mist'))
  const v = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement)
    return { tint: s.getPropertyValue('--tint').trim(), bg: s.getPropertyValue('--bg').trim() }
  })
  expect(v).toEqual({ tint: '0, 0, 0', bg: 'rgb(228, 231, 238)' })
  await expect.poll(() => paneBg(page)).toBe('rgb(228, 231, 238)')
})

test('the terminal follows the app from dark to light', async ({ page }) => {
  await open(page, { theme: 'auto' })
  await page.evaluate(() => window.applyTheme('dark'))
  await expect.poll(() => paneBg(page)).toBe('rgb(18, 19, 25)')
  await page.evaluate(() => window.applyTheme('light'))
  await expect.poll(() => paneBg(page)).toBe('rgb(255, 255, 255)')
})

test('picking a colour by hand switches the theme to Custom', async ({ page }) => {
  await open(page, { theme: 'auto' })
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
