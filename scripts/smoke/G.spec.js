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

// ── The main window ──

async function boot(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  return errors
}

test('clean-up counts a failed archive as failed, and names it', async ({ page }) => {
  // archiveSession resolves {ok:false} instead of rejecting, so a try/catch counted
  // every failure as done: "Applied 1 of 1" and no failure list.
  await boot(page)
  await page.evaluate(() => {
    const old = new Date(Date.now() - 100 * 86400e3).toISOString()
    const s = { name: 'ancient', notesPath: '/Users/dev/work/CHORE/ancient/notes.md', state: 'closed',
      historyStatus: 'closed', updatedAt: old, lastActivityAt: old }
    window.api.getHistoricalAll = async () => ({ stale: [], closed: [s], archived: [] })
    window.api.archiveSession = async () => ({ ok: false, error: 'boom' })
    window.confirmAction = async () => 'confirm'
  })
  await page.evaluate(() => window.openClean())
  const box = page.locator('#clean-list input[type=checkbox]').first()
  await box.check()
  await page.locator('#clean-apply').click()
  await expect(page.locator('#clean-summary')).toContainText('Applied 0 of 1')
  await expect(page.locator('#clean-list')).toContainText('1 could not be applied')
  await expect(page.locator('#clean-list')).toContainText('boom')
})

test('a terminal whose claude exited while on screen is gone once hidden', async ({ page }) => {
  // The visible branch of pty-exit only wrote a banner, so the dead entry stayed in the
  // map for good: Resume re-showed the dead buffer and Close waited 75 s for a wrap-up
  // that no process could write.
  await boot(page)
  const r = await page.evaluate(async () => {
    const inputs = []
    window.api.ptyInput = (sid, data) => { inputs.push([sid, data]); return Promise.resolve() }
    const exit = (sid) => (window.__PTY_HANDLERS__['pty-exit'] || []).forEach(cb => cb({ payload: { sessionId: sid } }))
    window.openTerminalPane('S1', '/tmp', '', '', '/n/notes.md')
    await new Promise(r => setTimeout(r, 50))
    exit('S1')
    const liveWhileShown = window.hasLiveTerminal('S1')
    window.hideTerminalPane()
    const afterHide = { live: window.hasLiveTerminal('S1'), key: window.terminalKeyForNotes('/n/notes.md') }

    window.openTerminalPane('S2', '/tmp', '', '', '/m/notes.md')
    await new Promise(r => setTimeout(r, 50))
    exit('S2')
    window.closeTerminalPane()
    const afterClose = window.hasLiveTerminal('S2')
    const shown = window.getTerminalVisible()

    // Reopened while the dead pane is still on screen: a fresh claude, not the old buffer.
    const spawns = []
    window.api.ptySpawn = (sid) => { spawns.push(sid); return Promise.resolve() }
    window.openTerminalPane('S3', '/tmp', '', '', '/k/notes.md')
    await new Promise(r => setTimeout(r, 50))
    exit('S3')
    window.openTerminalPane('S3', '/tmp')
    await new Promise(r => setTimeout(r, 50))
    return { liveWhileShown, afterHide, afterClose, shown,
      inputs, spawns, reopenedLive: window.hasLiveTerminal('S3') }
  })
  expect(r.liveWhileShown).toBe(false)
  expect(r.afterHide).toEqual({ live: false, key: null })
  expect(r.afterClose).toBe(false)
  expect(r.shown).toBe(false)
  expect(r.inputs).toEqual([])
  expect(r.spawns).toEqual(['S3', 'S3'])
  expect(r.reopenedLive).toBe(true)
})

test('a pinned skill on a session with a terminal keyed by notes.md is typed into it', async ({ page }) => {
  // +New keys the terminal by notesPath; pinCtxFor looked it up by sessionId only, so the
  // skill ran as a second headless `claude --resume` of the same conversation.
  await boot(page)
  const r = await page.evaluate(async () => {
    const s = window._lastSessions.find(x => x.name === 'legacy-export')
    const calls = []
    window.api.ptyInput = (sid, data) => { calls.push(['pty', sid, data]); return Promise.resolve() }
    window.api.runSkill = async (...a) => { calls.push(['headless', ...a]); return { summary: 'ok' } }
    window.openTerminalPane(s.notesPath, s.cwd, '', '', s.notesPath)
    await new Promise(r => setTimeout(r, 50))
    window.hideTerminalPane()
    window._lastSelectedKey = sessionKey(s)
    const ctx = pinCtxFor(s)
    const btn = document.createElement('button')
    btn.dataset.pinRun = 'session'; btn.dataset.pinSkill = 'review'; btn.dataset.pinIndex = '0'
    await runPinnedSkill(btn)
    return { hasTerminal: ctx.hasTerminal, calls, key: s.notesPath }
  })
  expect(r.hasTerminal).toBe(true)
  expect(r.calls).toEqual([['pty', r.key, '/review\r']])
})

test('Close picked from the menu cannot be started twice', async ({ page }) => {
  // The menu row is detached by the time the confirm resolves, so the busy state landed
  // on a removed element and the card's own Close button stayed live.
  await boot(page)
  await page.evaluate(() => {
    window.__wraps = 0
    window.confirmAction = async () => 'confirm'
    window.api.wrapSession = () => { window.__wraps++; return new Promise(() => {}) }
  })
  await page.locator('.tab-btn[data-tab="running"]').click()
  const card = page.locator('#panel-list .list-card[data-key*="legacy-export"]')
  await card.click({ button: 'right' })
  await page.locator('#session-menu .board-menu-item', { hasText: 'Close session' }).click()
  await expect.poll(() => page.evaluate(() => window.__wraps)).toBe(1)
  const btn = card.locator('[data-close-notes]').first()
  await expect(btn).toBeDisabled()
  await btn.evaluate((b) => { b.disabled = false; b.click() })   // even a forced second click
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => window.__wraps)).toBe(1)
})

test('Sync picked from the menu cannot be started twice', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => {
    window.__syncs = 0
    window.api.syncRefs = () => { window.__syncs++; return new Promise(() => {}) }
  })
  await page.locator('.tab-btn[data-tab="running"]').click()
  const card = page.locator('#panel-list .list-card[data-key*="legacy-export"]')
  await card.click({ button: 'right' })
  await page.locator('#session-menu .board-menu-item', { hasText: 'Sync tickets' }).click()
  await expect.poll(() => page.evaluate(() => window.__syncs)).toBe(1)
  await card.click()
  const btn = page.locator('#panel-detail [data-sync-prs]').first()
  await btn.evaluate((b) => { b.disabled = false; b.click() })
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => window.__syncs)).toBe(1)
})
