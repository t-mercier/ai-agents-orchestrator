// A release that ships a new skill (ask-other-models, 2026-09-30) must not greet an existing
// user with "the session skills aren't installed yet": only a machine with none of them
// installed gets that banner; one missing a new skill gets it through the launch sync.
const { test, expect } = require('@playwright/test')

async function open(page, status) {
  await page.addInitScript((status) => {
    let t
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      get() { return t },
      set(v) {
        const orig = v.core.invoke
        window.__CALLS__ = []
        v.core.invoke = (cmd, args) => {
          window.__CALLS__.push(cmd)
          if (cmd === 'skills_status') return Promise.resolve(status)
          if (cmd === 'sync_skills') return Promise.resolve({ skipped: false, installed: ['ask-other-models'], updated: [], restored: [] })
          return orig(cmd, args)
        }
        t = v
      },
    })
    try { localStorage.removeItem('csm.skillsBannerDismissed') } catch {}
  }, status)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
}

test('a new skill in the release is installed by the launch sync, not announced as a first install', async ({ page }) => {
  await open(page, { installed: false, present: ['close-session', 'start-session'], missing: ['ask-other-models'], differs: [], bundle_epoch: 2, installed_epoch: 1 })
  await expect.poll(() => page.evaluate(() => window.__CALLS__.includes('sync_skills'))).toBe(true)
  await expect(page.locator('#skills-banner')).not.toContainText("aren't installed yet")
})

test('a machine with none of the skills is offered the first install', async ({ page }) => {
  await open(page, { installed: false, present: [], missing: ['ask-other-models', 'start-session'], differs: [], bundle_epoch: 2, installed_epoch: null })
  await expect(page.locator('#skills-banner')).toContainText("aren't installed yet")
})
