// Installing an update restarts the app, and a restart ends every session running in an
// embedded terminal. The banner asks first when any is running.
const { test, expect } = require('@playwright/test')

// The fixture assigns window.__TAURI__ as the page loads; wrap its invoke as it lands.
async function stubInvoke(page) {
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
          if (cmd === 'app_update_check') return Promise.resolve({ version: '0.21.0', current: '0.20.4', notes: '' })
          if (cmd === 'app_update_install') return new Promise(() => {})   // a real install restarts
          return orig(cmd, args)
        }
        t = v
      },
    })
  })
}

test('with sessions running in the app, Install asks before it restarts', async ({ page }) => {
  await stubInvoke(page)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await expect(page.locator('#skills-banner .sb-install')).toBeVisible()
  await page.evaluate(() => { window.liveTerminalCount = () => 2 })

  await page.locator('#skills-banner .sb-install').click()
  await expect(page.locator('#confirm-modal')).toHaveAttribute('open', '')
  await expect(page.locator('#confirm-body')).toContainText('2 sessions')
  await page.locator('#confirm-cancel').click()
  expect(await page.evaluate(() => window.__CALLS__.includes('app_update_install'))).toBe(false)
  await expect(page.locator('#skills-banner .sb-install')).toBeEnabled()

  await page.locator('#skills-banner .sb-install').click()
  await page.locator('#confirm-ok').click()
  await expect.poll(() => page.evaluate(() => window.__CALLS__.includes('app_update_install'))).toBe(true)
})

test('with nothing running, Install goes straight ahead', async ({ page }) => {
  await stubInvoke(page)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(() => { window.liveTerminalCount = () => 0 })
  await page.locator('#skills-banner .sb-install').click()
  await expect.poll(() => page.evaluate(() => window.__CALLS__.includes('app_update_install'))).toBe(true)
})

// Checking for a new version is the one call the app makes on its own, so it can be
// turned off in Settings → General, and then nothing is asked of GitHub.
test('with update checks turned off, the app does not ask for a new version', async ({ page }) => {
  await stubInvoke(page)
  // The fixture clears localStorage as it loads; keep this one choice across that.
  await page.addInitScript(() => {
    const clear = Storage.prototype.clear
    Storage.prototype.clear = function () { clear.call(this); this.setItem('csm.updateCheck', 'off') }
    localStorage.setItem('csm.updateCheck', 'off')
  })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => window.__CALLS__.includes('app_update_check'))).toBe(false)
  await expect(page.locator('#skills-banner .sb-install')).toHaveCount(0)
})

test('Settings → General turns update checks off and on', async ({ page }) => {
  await stubInvoke(page)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(() => window.openSettingsTab('general'))
  await expect(page.locator('#set-update-check')).toBeChecked()
  await page.locator('#set-update-check').uncheck()
  await page.locator('#settings-modal form').evaluate((f) => f.requestSubmit())
  await expect.poll(() => page.evaluate(() => localStorage.getItem('csm.updateCheck'))).toBe('off')
})
