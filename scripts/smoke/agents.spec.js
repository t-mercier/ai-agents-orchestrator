// Codex and Copilot sessions beside Claude Code: +New offers the agent only when another
// CLI is installed, their cards carry a chip (Claude Code cards do not), and actions that
// need a Claude Code skill say so instead of failing.
const { test, expect } = require('@playwright/test')

const CODEX_SESSION = {
  sessionId: '01a0e9da-76d9-7c12-882e-57b7554edd81', agent: 'codex', name: 'try codex',
  cwd: '/Users/dev/work', pid: 4242, status: 'busy', state: 'active', notesPath: '/Users/dev/work/FEAT/try-codex/notes.md',
  root: 'Work', category: 'FEAT', ticket: null, tickets: null, ticketStates: [], goal: 'See if Codex fits', nextSteps: null,
  gitBranch: null, worktree: null, lastActivity: 'reading the notes', lastActivityAt: null, lastSummary: null,
  prLink: null, prLinks: null, continuedIn: null, entrypoint: '', updatedAt: null,
}

async function stub(page, agents) {
  await page.addInitScript(({ session, agents }) => {
    let t
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      get() { return t },
      set(v) {
        const orig = v.core.invoke
        window.__CALLS__ = []
        v.core.invoke = (cmd, args) => {
          window.__CALLS__.push({ cmd, args })
          if (cmd === 'agents_available') return Promise.resolve(agents)
          if (cmd === 'get_sessions') return orig(cmd, args).then(list => [...(list || []), session])
          if (cmd === 'get_historical_sessions' && args.status === 'stale') {
            return orig(cmd, args).then(list => [...(list || []), { ...session, sessionId: '01a0e9da-0000-7c12-882e-57b7554edd81',
              name: 'paused codex', state: 'stale', historyStatus: 'stale', status: undefined, resumable: true,
              notesPath: '/Users/dev/work/FEAT/paused-codex/notes.md' }])
          }
          if (cmd === 'start_session') return Promise.resolve({ command: "cd '/w' && codex 'hi'", notesPath: '/w/FEAT/x/notes.md', cwd: '/w', agent: args.agent || undefined })
          return orig(cmd, args)
        }
        t = v
      },
    })
  }, { session: CODEX_SESSION, agents })
}

const ALL = [
  { agent: 'claude', found: true, version: '2.1.284', supported: true, hint: '' },
  { agent: 'codex', found: true, version: 'codex-cli 0.158.0', supported: true, hint: '' },
  { agent: 'copilot', found: true, version: '0.0.369', supported: false, hint: 'Copilot CLI 0.0.369 is too old for the app (it needs 1.0 or later). Update it with: npm i -g @github/copilot' },
]

test('a Codex card carries its chip; Claude Code cards stay as they were', async ({ page }) => {
  await stub(page, ALL)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  const card = page.locator('.list-card', { hasText: 'try codex' })
  await expect(card.locator('.agent-chip.codex')).toHaveText('Codex')
  await expect(page.locator('.list-card', { hasText: 'checkout-redesign' }).locator('.agent-chip')).toHaveCount(0)
})

test('+New offers the installed agents and says why Copilot is not one of them', async ({ page }) => {
  await stub(page, ALL)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.locator('#new-session-btn').click()
  await expect(page.locator('#ns-agent-field')).toBeVisible()
  await expect(page.locator('#ns-agent option')).toHaveText(['Claude Code', 'Codex'])
  await expect(page.locator('#ns-agent-hint')).toContainText('npm i -g @github/copilot')

  await page.locator('#ns-agent').selectOption('codex')
  await page.locator('#ns-name').fill('try codex')
  await page.locator('#new-session-form').evaluate((f) => f.requestSubmit())
  const call = await page.evaluate(() => window.__CALLS__.find(c => c.cmd === 'start_session'))
  expect(call.args.agent).toBe('codex')
  expect(call.args.embedded).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__CALLS__.filter(c => c.cmd === 'pty_spawn').map(c => c.args.cwd))).toEqual(['/w'])
})

test('with Claude Code alone, +New looks exactly as before', async ({ page }) => {
  await stub(page, [ALL[0], { agent: 'codex', found: false, version: '', supported: false, hint: '' }, { agent: 'copilot', found: false, version: '', supported: false, hint: '' }])
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.locator('#new-session-btn').click()
  await expect(page.locator('#ns-name')).toBeVisible()
  await expect(page.locator('#ns-agent-field')).toBeHidden()
})

test('Close on a Codex session says it closes without a summary', async ({ page }) => {
  await stub(page, ALL)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  const card = page.locator('.list-card', { hasText: 'paused codex' })
  await card.hover()
  await card.locator('.close-btn').click()
  await expect(page.locator('#confirm-body')).toContainText('Codex sessions close without a summary for now')
  await page.locator('#confirm-ok').click()
  await expect.poll(() => page.evaluate(() => window.__CALLS__.map(c => c.cmd))).toContain('close_session')
  expect(await page.evaluate(() => window.__CALLS__.some(c => c.cmd === 'wrap_session'))).toBe(false)
})
