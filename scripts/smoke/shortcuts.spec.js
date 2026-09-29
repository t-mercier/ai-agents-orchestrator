// Your own shortcut on any of the app's actions (asked for on 2026-09-29): recorded in
// Settings → Shortcuts, refused when the system or another action has it, fired from the
// main window — and, for the actions of one session, on the one selected.
const { test, expect } = require('@playwright/test')

async function open(page) {
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
    try { localStorage.removeItem('csm.shortcuts') } catch {}
  })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
}

const row = (page, id) => page.locator(`#set-shortcuts [data-shortcut="${id}"]`)

async function record(page, id, combo) {
  await row(page, id).locator('.key-cap').click()
  await page.keyboard.press(combo)
}

test('a shortcut recorded for New session opens it', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.openSettingsTab('shortcuts'))
  await record(page, 'newSession', 'Meta+Shift+N')
  await expect(row(page, 'newSession').locator('.key-cap')).toHaveText('⌘⇧N')
  await page.keyboard.press('Escape')
  await page.evaluate(() => document.getElementById('settings-modal').close())
  await page.keyboard.press('Meta+Shift+N')
  await expect(page.locator('#new-session-modal')).toHaveJSProperty('open', true)
})

test('a session action runs on the selected session, through the same path as its menu', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.openSettingsTab('shortcuts'))
  await record(page, 'revealCode', 'Meta+Alt+R')
  await page.evaluate(() => document.getElementById('settings-modal').close())
  // The fixture starts with checkout-redesign selected; a click on another card moves it.
  await page.locator('#panel-list .list-card[data-key$="search-suggest/notes.md"]').click()
  await page.keyboard.press('Meta+Alt+R')
  await expect.poll(() => page.evaluate(() => (window.__CALLS__.find(c => c.cmd === 'open_path') || {}).args))
    .toEqual({ path: '/Users/dev/work/FEAT/search-suggest' })
})

test('a session action says why when it cannot run', async ({ page }) => {
  await open(page)
  await page.evaluate(() => localStorage.setItem('csm.shortcuts', JSON.stringify({ close: 'Mod+Alt+X', archive: 'Mod+Alt+A' })))
  // checkout-redesign is selected and still running: the menu greys Close out, and so does the key.
  await page.keyboard.press('Meta+Alt+X')
  await expect(page.locator('.shortcut-note')).toContainText('Close session: Still running')
  await page.locator('#panel-list .list-card[data-key$="checkout-redesign/notes.md"]').click()   // deselect
  await page.keyboard.press('Meta+Alt+A')
  await expect(page.locator('.shortcut-note')).toContainText('select a session first')
})

test('a combo the system or another action owns is refused, and says by whom', async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.openSettingsTab('shortcuts'))
  await record(page, 'syncAll', 'Meta+Q')
  await expect(page.locator('#set-shortcuts-why')).toContainText('quits the app')
  await expect(row(page, 'syncAll').locator('.key-cap')).toHaveText('—')
  await record(page, 'newSession', 'Meta+Shift+N')
  await record(page, 'syncAll', 'Meta+Shift+N')
  await expect(page.locator('#set-shortcuts-why')).toContainText('New session')
  await expect(row(page, 'syncAll').locator('.key-cap')).toHaveText('—')
  // Clearing one gives the combo back.
  await row(page, 'newSession').locator('[data-clear]').click()
  await expect(row(page, 'newSession').locator('.key-cap')).toHaveText('—')
  await record(page, 'syncAll', 'Meta+Shift+N')
  await expect(row(page, 'syncAll').locator('.key-cap')).toHaveText('⌘⇧N')
})

test('a shortcut does nothing while a dialog is open', async ({ page }) => {
  await open(page)
  await page.evaluate(() => localStorage.setItem('csm.shortcuts', JSON.stringify({ newSession: 'Mod+Shift+N' })))
  await page.evaluate(() => window.openSettingsTab('general'))
  await page.keyboard.press('Meta+Shift+N')
  await page.waitForTimeout(200)
  await expect(page.locator('#new-session-modal')).toHaveJSProperty('open', false)
})
