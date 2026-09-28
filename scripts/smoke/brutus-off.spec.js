// Brutus can be turned off in Settings → Assistant (asked for on 2026-09-28: not everyone
// wants an assistant). Off means every way to reach him is gone — the bubble, the titlebar
// button and ⌘K — and turning him back on brings them back.
const { test, expect } = require('@playwright/test')

const setEnabled = (page, on) => page.evaluate((on) => {
  const c = window.CSM_CONFIG
  window.CSM_CONFIG = { ...c, assistant: { ...c.assistant, enabled: on } }
  window.CSMBrutusUI.refresh()
}, on)

test('Settings writes the switch, and off leaves no way to reach him', async ({ page }) => {
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await expect(page.locator('.bru-fab')).toHaveCount(1)

  await page.evaluate(() => window.openSettingsTab('assistant'))
  await expect(page.locator('#set-assistant-enabled')).toBeChecked()
  await page.locator('#set-assistant-enabled').uncheck()
  await page.locator('#settings-modal form').evaluate((f) => f.requestSubmit())
  await expect.poll(() => page.evaluate(() => window.__LAST_SET_CONFIG__?.assistant?.enabled)).toBe(false)
  await page.evaluate(() => document.getElementById('settings-modal').close())

  // The fixture's get_config does not echo a Save back, so apply what the backend would.
  await setEnabled(page, false)
  await expect(page.locator('.bru-fab')).toHaveCount(0)
  await expect(page.locator('#brutus-btn')).toBeHidden()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.locator('.bru-panel')).toHaveCount(0)
  await page.evaluate(() => window.CSMBrutusUI.open())
  await expect(page.locator('.bru-panel')).toHaveCount(0)

  await setEnabled(page, true)
  await expect(page.locator('.bru-fab')).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.locator('.bru-panel.v-B')).toHaveCount(1)
})
