// The headless collab is gone (replaced by inviting models, 2026-09-30). The sessions
// 0.21.0 created with it stay readable in Closed: their thread, and no Restart, since they
// never had a terminal to restart in.
const { test, expect } = require('@playwright/test')

const THREAD = [
  '- 10:02 Claude Code (author): Added a retry with backoff.',
  '- 10:04 Codex (reviewer): Two problems.',
  '  - net.rs:12 — the backoff never resets',
].join('\n')

const CLOSED = {
  sessionId: '', collab: 'cross-review', collabThread: THREAD, historyStatus: 'closed',
  name: 'retry collab', cwd: '/w/app', status: 'idle', state: 'closed', notesPath: '/w/FEAT/retry-collab/notes.md',
  root: 'Work', category: 'FEAT', goal: 'Add a retry', ticket: null, tickets: null, ticketStates: [], nextSteps: null,
  lastSummary: 'Claude Code changed nothing.', prLink: null, prLinks: null, gitBranch: null, entrypoint: '',
  updatedAt: Date.now() - 3600_000, lastActivityAt: Date.now() - 3600_000, resumable: false,
}

async function stub(page) {
  await page.addInitScript((session) => {
    let t
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      get() { return t },
      set(v) {
        const orig = v.core.invoke
        v.core.invoke = (cmd, args) => {
          if (cmd === 'agents_available') return Promise.resolve([
            { agent: 'claude', found: true, supported: true, hint: '' },
            { agent: 'codex', found: true, supported: true, hint: '' },
          ])
          if (cmd === 'get_historical_sessions' && args.status === 'closed') return orig(cmd, args).then(l => [...(l || []), session])
          if (cmd === 'get_historical_sessions_all') return orig(cmd, args).then(b => ({ ...b, closed: [...((b && b.closed) || []), session] }))
          return orig(cmd, args)
        }
        t = v
      },
    })
  }, CLOSED)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
}

test('＋New no longer offers the headless collab', async ({ page }) => {
  await stub(page)
  await page.locator('#new-session-btn').click()
  await expect(page.locator('#ns-agent option')).toHaveText(['Claude Code', 'Codex'])
  await expect(page.locator('#ns-collab-field')).toHaveCount(0)
})

test('a legacy collab session keeps its thread and no restart', async ({ page }) => {
  await stub(page)
  await page.locator('.tab-btn[data-tab="closed"]').click()
  const card = page.locator('#panel-list .list-card[data-key$="retry-collab/notes.md"]')
  await card.click()
  const detail = page.locator('#detail-info-pane')
  await expect(detail).toContainText('Collab thread')
  await expect(detail).toContainText('the backoff never resets')
  await expect(detail.locator('[data-collab-stop]')).toHaveCount(0)
  await card.click({ button: 'right' })
  const restart = page.locator('#session-menu .board-menu-item', { hasText: /Restart|Resume/ }).first()
  await expect(restart).toBeDisabled()
})
