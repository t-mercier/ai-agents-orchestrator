// Collab sessions: ＋New offers a cross-review when two agents are installed, the card and
// detail panel show the thread with Stop, and a collab offers no terminal, Resume or Restart.
const { test, expect } = require('@playwright/test')

const THREAD = [
  '- 10:02 Claude Code (author): Added a retry with backoff.',
  '- 10:04 Codex (reviewer): Two problems.',
  '  - net.rs:12 — the backoff never resets',
  '  - net.rs:30 — no test for the give-up path',
].join('\n')

const RUNNING = {
  sessionId: '', collab: 'cross-review', collabId: 'c-1', collabAgents: 'claude,codex', collabThread: THREAD,
  name: 'retry collab', cwd: '/w/app', pid: 0, status: 'busy', state: 'active', notesPath: '/w/FEAT/retry-collab/notes.md',
  root: 'Work', category: 'FEAT', goal: 'Add a retry', lastActivity: 'Claude Code is working on the change',
  ticket: null, tickets: null, ticketStates: [], nextSteps: null, lastSummary: null, prLink: null, prLinks: null,
  gitBranch: null, worktree: null, entrypoint: '', continuedIn: null, updatedAt: null, lastActivityAt: null,
}

async function stub(page) {
  await page.addInitScript((session) => {
    let t
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      get() { return t },
      set(v) {
        const orig = v.core.invoke
        window.__CALLS__ = []
        v.core.invoke = (cmd, args) => {
          window.__CALLS__.push({ cmd, args })
          if (cmd === 'agents_available') return Promise.resolve([
            { agent: 'claude', found: true, supported: true, hint: '' },
            { agent: 'codex', found: true, supported: true, hint: '' },
          ])
          if (cmd === 'get_sessions') return orig(cmd, args).then(l => [...(l || []), session])
          if (cmd === 'collab_start') return Promise.resolve({ id: 'c-2', notesPath: '/w/FEAT/new/notes.md' })
          if (cmd === 'collab_stop') return Promise.resolve(true)
          return orig(cmd, args)
        }
        t = v
      },
    })
  }, RUNNING)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
}

test('+New starts a cross-review with two different agents in a repository', async ({ page }) => {
  await stub(page)
  await page.locator('#new-session-btn').click()
  await page.locator('#ns-agent').selectOption('collab')
  await expect(page.locator('#ns-collab-field')).toBeVisible()
  await expect(page.locator('#ns-branch-field')).toBeHidden()
  await expect(page.locator('#ns-dest-field')).toBeHidden()
  await expect(page.locator('#ns-intro')).toContainText('the author makes the change')
  await page.locator('#ns-name').fill('retry collab')

  await page.locator('#ns-collab-reviewer').selectOption('claude')
  await page.locator('#new-session-form').evaluate((f) => f.requestSubmit())
  await expect(page.locator('#ns-error')).toContainText('two different agents')

  await page.locator('#ns-collab-reviewer').selectOption('codex')
  await page.locator('#new-session-form').evaluate((f) => f.requestSubmit())
  await expect(page.locator('#ns-error')).toContainText('repository')

  await page.locator('#ns-startin').fill('/w/app')
  await page.locator('#ns-collab-task').fill('Add a retry with backoff')
  await page.locator('#new-session-form').evaluate((f) => f.requestSubmit())
  const call = await page.evaluate(() => window.__CALLS__.find(c => c.cmd === 'collab_start'))
  expect(call.args).toMatchObject({ repo: '/w/app', mode: 'cross-review', agents: ['claude', 'codex'], task: 'Add a retry with backoff' })
  expect(await page.evaluate(() => window.__CALLS__.some(c => c.cmd === 'start_session' || c.cmd === 'pty_spawn'))).toBe(false)
})

test('a running collab shows its thread and Stop, and no terminal, Resume or Restart', async ({ page }) => {
  await stub(page)
  const card = page.locator('.list-card', { hasText: 'retry collab' })
  await expect(card.locator('.agent-chip.collab')).toHaveText('Collab')
  await card.click()
  const panel = page.locator('#detail-info-pane')
  await expect(panel.locator('.collab-turn')).toHaveCount(3)
  await expect(panel.locator('.collab-findings li')).toHaveText(['net.rs:12 — the backoff never resets', 'net.rs:30 — no test for the give-up path'])
  await expect(panel.locator('.collab-now')).toContainText('Claude Code is working on the change')
  await expect(panel.locator('[data-open-resume], [data-open-restart], .terminal-toggle-btn')).toHaveCount(0)
  await panel.locator('[data-collab-stop="c-1"]').click()
  await expect.poll(() => page.evaluate(() => (window.__CALLS__.find(c => c.cmd === 'collab_stop') || {}).args?.id)).toBe('c-1')
})
