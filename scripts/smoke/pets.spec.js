// Brutus shows as the companion the user picked (asked for on 2026-09-29), in the state he
// is in: thinking while an answer runs, happy when it lands, at rest otherwise.
const { test, expect } = require('@playwright/test')

async function open(page, pet) {
  await page.addInitScript((pet) => {
    let t
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      get() { return t },
      set(v) {
        const orig = v.core.invoke
        window.__CALLS__ = []
        v.core.invoke = (cmd, args) => {
          window.__CALLS__.push({ cmd, args })
          if (cmd === 'get_config' && pet) return orig(cmd, args).then(c => ({ ...c, assistant: { ...(c.assistant || {}), name: 'Brutus', style: 'concise', enabled: true, pet } }))
          if (cmd === 'brutus_ask' && window.__HOLD__) return new Promise(() => {})
          return orig(cmd, args)
        }
        t = v
      },
    })
  }, pet)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
}

test('the bubble is the chosen companion, not a letter', async ({ page }) => {
  await open(page, 'crab')
  const fab = page.locator('.bru-fab')
  await expect(fab.locator('svg.pet-svg .pe-claw')).toHaveCount(2)
  await expect(fab).not.toContainText('B')
})

test('he thinks while an answer runs, then is happy', async ({ page }) => {
  await open(page, 'ghost')
  await page.evaluate(() => { try { localStorage.removeItem('csm.brutusLog') } catch {} ; window.CSMBrutusUI.open() })
  // The fixture has two sessions waiting on the user: he says so, with a badge.
  await expect(page.locator('.bru-fab svg.pet-svg')).toHaveClass(/pe-wait/)
  await expect(page.locator('.bru-fab svg .pe-alert text')).toHaveText('2')
  // …once: the panel's own face does not repeat the badge.
  await expect(page.locator('.bru-panel .bru-head svg .pe-alert')).toHaveCount(0)
  await page.evaluate(() => { window.__HOLD__ = true })
  await page.locator('.bru-panel input').fill('what is waiting?')
  await page.locator('.bru-panel input').press('Enter')
  await expect(page.locator('.bru-panel .bru-head svg.pet-svg')).toHaveClass(/pe-think/)
  // The scripted run of the fixture answers: he is happy for a moment.
  await page.evaluate(() => { window.__HOLD__ = false })
  await page.evaluate(() => (window.__PTY_HANDLERS__['brutus-event'] || []).forEach(cb => cb({ payload: { kind: 'text', text: 'Two need you.' } })))
  await page.evaluate(() => (window.__PTY_HANDLERS__['brutus-event'] || []).forEach(cb => cb({ payload: { kind: 'done', is_error: false, result: '' } })))
  await expect(page.locator('.bru-panel .bru-head svg.pet-svg')).toHaveClass(/pe-happy/)
})

test('Settings → Assistant saves the companion picked', async ({ page }) => {
  await open(page, null)
  await page.evaluate(() => window.openSettingsTab('assistant'))
  const picker = page.locator('#set-assistant-pets')
  await expect(picker.locator('button[data-pet]')).toHaveCount(9)
  await expect(picker.locator('button[data-pet="blob"]')).toHaveAttribute('aria-checked', 'true')
  await picker.locator('button[data-pet="star"]').click()
  await expect(page.locator('#set-assistant-sample svg.pet-svg')).toBeVisible()
  await page.locator('#settings-modal form').evaluate((f) => f.requestSubmit())
  await expect.poll(() => page.evaluate(() => (window.__CALLS__.find(c => c.cmd === 'set_config') || {}).args?.cfg?.assistant?.pet)).toBe('star')
})
