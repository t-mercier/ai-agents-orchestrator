// Brutus can be turned off in Settings → AI Companion (asked for on 2026-09-28: not everyone
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

// "He never runs" includes the run already under way when he is turned off.
test('turning him off stops the run in progress', async ({ page }) => {
  // tauri-api.js binds invoke as the page loads, so wrap it as the fixture assigns it.
  await page.addInitScript(() => {
    let t
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      get() { return t },
      set(v) {
        const orig = v.core.invoke
        window.__CALLS__ = []
        v.core.invoke = (cmd, args) => {
          window.__CALLS__.push(cmd)
          if (cmd === 'brutus_ask') return new Promise(() => {})   // still thinking
          return orig(cmd, args)
        }
        t = v
      },
    })
  })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(() => { try { localStorage.removeItem('csm.brutusLog') } catch {} ; window.CSMBrutusUI.open() })
  await page.locator('.bru-panel input').fill('what is waiting on me?')
  await page.locator('.bru-panel input').press('Enter')
  await expect.poll(() => page.evaluate(() => window.__CALLS__.includes('brutus_ask'))).toBe(true)
  await setEnabled(page, false)
  await expect.poll(() => page.evaluate(() => window.__CALLS__.includes('brutus_cancel'))).toBe(true)
})

// A document he wrote shows as a card; Open asks the backend for that file by name.
test('a document in his answer opens from its card', async ({ page }) => {
  await page.addInitScript(() => {
    let t
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      get() { return t },
      set(v) {
        const orig = v.core.invoke
        window.__CALLS__ = []
        v.core.invoke = (cmd, args) => { window.__CALLS__.push({ cmd, args }); return orig(cmd, args) }
        t = v
      },
    })
  })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(() => {
    window.__BRUTUS_SCRIPT__ = { reads: [], text: 'Done: [[doc:perf-brief.html]]' }
    try { localStorage.removeItem('csm.brutusLog') } catch {}
    window.CSMBrutusUI.open()
  })
  await page.locator('.bru-panel input').fill('write me a brief')
  await page.locator('.bru-panel input').press('Enter')
  await page.locator('.bru-panel [data-bru-doc="perf-brief.html"]').click()
  await expect.poll(() => page.evaluate(() => (window.__CALLS__.find(c => c.cmd === 'brutus_open_doc') || {}).args?.name)).toBe('perf-brief.html')
})
