// The Dock icon badge is driven by the live sessions and the Settings checkbox. The Rust
// side is stubbed: these tests read what the renderer asks it to draw.
const { test, expect } = require('@playwright/test')

// Records every set_dock_status call and every get_sessions call. `dockStatus` is what
// get_config reports for the setting; `waitingFirst` makes the first live session waiting.
async function stubInvoke(page, { dockStatus = true, waitingFirst = true } = {}) {
  await page.addInitScript(({ dockStatus, waitingFirst }) => {
    let t
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      get() { return t },
      set(v) {
        const orig = v.core.invoke
        window.__CALLS__ = []
        window.__DOCK__ = []
        window.__SESSIONS_READS__ = 0
        v.core.invoke = (cmd, args) => {
          window.__CALLS__.push(cmd)
          if (cmd === 'set_dock_status') { window.__DOCK__.push(args); return Promise.resolve() }
          if (cmd === 'get_sessions') {
            window.__SESSIONS_READS__ += 1
            return orig(cmd, args).then((l) => (l || []).map((s, i) => (waitingFirst && i === 0
              ? { ...s, state: 'active', status: 'waiting' } : s)))
          }
          if (cmd === 'get_config') return orig(cmd, args).then((c) => ({ ...c, dockStatus }))
          return orig(cmd, args)
        }
        t = v
      },
    })
  }, { dockStatus, waitingFirst })
}

test('a waiting session puts the red count on the Dock icon', async ({ page }) => {
  await stubInvoke(page)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await expect.poll(() => page.evaluate(() => window.__DOCK__.length)).toBeGreaterThan(0)
  const last = await page.evaluate(() => window.__DOCK__[window.__DOCK__.length - 1])
  expect(last.kind).toBe('waiting')
  expect(last.count).toBeGreaterThanOrEqual(1)
})

test('with the setting off, the Dock icon is never badged', async ({ page }) => {
  await stubInvoke(page, { dockStatus: false })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  // Let a poll or two run, then check no badge call was made.
  await expect.poll(() => page.evaluate(() => window.__SESSIONS_READS__)).toBeGreaterThanOrEqual(1)
  expect(await page.evaluate(() => window.__DOCK__.length)).toBe(0)
})
