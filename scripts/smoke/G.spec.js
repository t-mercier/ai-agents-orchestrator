// Smoke tests for the detached session window, the clean-up panel, the embedded
// terminal's lifecycle and the slow session actions (Close, Sync).
//
// detail.html is served as-is (serve.py injects the fixture into index.html only), so
// its tests mock window.__TAURI__ themselves, before any page script runs.
const { test, expect } = require('@playwright/test')

// ── The detached window ──

const DETACHED = { notesPath: '/x/notes.md', sessionId: 'abc', name: 'Demo session', status: 'idle', cwd: '/x' }

async function openDetached(page, buckets) {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript((b) => {
    window.__TAURI__ = {
      core: {
        invoke: async (cmd, args) => {
          if (cmd === 'get_sessions') return b.active
          if (cmd === 'get_historical_sessions') return b[args && args.status] || []
          if (cmd === 'get_pr_status') return {}
          return null
        },
      },
      event: { listen: async () => () => {} },
      window: { getCurrentWindow: () => ({ setAlwaysOnTop: async () => true }) },
    }
  }, buckets)
  await page.goto('/detail.html?key=' + encodeURIComponent(DETACHED.notesPath))
  return errors
}

test('the detached window renders the session it was opened for', async ({ page }) => {
  // Shipped: detail.html lacked lib/search-model.js and lib/skill-launch-model.js, so
  // ui.js threw at load and the window stayed on "Loading…" for every session.
  const errors = await openDetached(page, { active: [DETACHED] })
  await expect(page.locator('#win-title')).toHaveText(DETACHED.name)
  await expect(page.locator('#detail-info-pane')).not.toContainText('Loading…')
  await expect(page.locator('#detail-info-pane')).toContainText('Resume')
  expect(errors).toEqual([])
})

test('the detached window finds a stale session', async ({ page }) => {
  // A stale session (terminal gone, not closed) is not in get_sessions; the window
  // searched active, closed and archived only, and stayed on "Loading…".
  const errors = await openDetached(page, { active: [], stale: [{ ...DETACHED, state: 'stale' }] })
  await expect(page.locator('#win-title')).toHaveText(DETACHED.name)
  await expect(page.locator('#detail-info-pane')).not.toContainText('Loading…')
  expect(errors).toEqual([])
})
