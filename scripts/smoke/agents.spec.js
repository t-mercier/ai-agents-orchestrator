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
          if (cmd === 'pty_spawn' && window.__FAIL_SPAWN__) return Promise.reject('unknown agent: codx')
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
  await expect(page.locator('#ns-agent option')).toHaveText(['Claude Code', 'Codex', 'Collab — two agents review each other'])
  await expect(page.locator('#ns-agent-hint')).toContainText('npm i -g @github/copilot')

  await expect(page.locator('#ns-intro')).toContainText('Launches claude')
  await page.locator('#ns-agent').selectOption('codex')
  await expect(page.locator('#ns-intro')).toContainText("Starts codex in the app's terminal")
  await page.locator('#ns-name').fill('try codex')
  await page.locator('#new-session-form').evaluate((f) => f.requestSubmit())
  const call = await page.evaluate(() => window.__CALLS__.find(c => c.cmd === 'start_session'))
  expect(call.args.agent).toBe('codex')
  expect(call.args.embedded).toBe(true)
  await expect.poll(() => page.evaluate(() => window.__CALLS__.filter(c => c.cmd === 'pty_spawn').map(c => c.args.cwd))).toEqual(['/w'])
  // The agent goes with the spawn: the notes at that path may belong to another session.
  const spawn = await page.evaluate(() => window.__CALLS__.find(c => c.cmd === 'pty_spawn'))
  expect(spawn.args.agent).toBe('codex')
  // Closing it before the poll has seen it must not type /close-session into Codex.
  await page.evaluate(() => window.closeTerminalPane())
  await expect.poll(() => page.evaluate(() => window.__CALLS__.map(c => c.cmd))).toContain('close_session')
  expect(await page.evaluate(() => window.__CALLS__.some(c => c.cmd === 'pty_input' && /close-session/.test(c.args.data)))).toBe(false)
})

test('a Claude Code +New spawns as Claude Code, whatever notes sit at that path', async ({ page }) => {
  await stub(page, ALL)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.locator('#new-session-btn').click()
  await expect(page.locator('#ns-agent-field')).toBeVisible()
  await page.locator('#ns-agent').selectOption('claude')
  await page.locator('#ns-name').fill('plain claude')
  await page.locator('#new-session-form').evaluate((f) => f.requestSubmit())
  await expect.poll(() => page.evaluate(() => (window.__CALLS__.find(c => c.cmd === 'pty_spawn') || {}).args?.agent)).toBe('claude')
})

test('a terminal that cannot start says why instead of staying blank', async ({ page }) => {
  await stub(page, ALL)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(() => { window.__FAIL_SPAWN__ = true })
  await page.locator('#new-session-btn').click()
  await page.locator('#ns-agent').selectOption('codex')
  await page.locator('#ns-name').fill('broken')
  await page.locator('#new-session-form').evaluate((f) => f.requestSubmit())
  await expect(page.locator('.terminal-session-div').last()).toContainText('unknown agent: codx')
  expect(await page.evaluate(() => window.hasLiveTerminal('/w/FEAT/x/notes.md'))).toBe(false)
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

test('a Codex session cannot be opened in an external terminal, and says why', async ({ page }) => {
  await stub(page, ALL)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.locator('.list-card', { hasText: 'try codex' }).click({ button: 'right' })
  const row = page.locator('.board-menu button', { hasText: 'Open in external terminal' })
  await expect(row).toBeDisabled()
  await expect(row).toHaveAttribute('title', /app's terminal/)
})

test('a failed agent probe says so in +New instead of hiding the agents', async ({ page }) => {
  await page.addInitScript(() => {
    let t
    Object.defineProperty(window, '__TAURI__', { configurable: true, get() { return t }, set(v) {
      const orig = v.core.invoke
      v.core.invoke = (cmd, args) => cmd === 'agents_available' ? Promise.reject('could not detect the agent CLIs (timed out)') : orig(cmd, args)
      t = v
    } })
  })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.locator('#new-session-btn').click()
  await expect(page.locator('#ns-agent-hint')).toContainText('could not detect the agent CLIs')
})

test('without Claude Code, Collab pairs the two agents that are installed', async ({ page }) => {
  await stub(page, [
    { agent: 'claude', found: false, version: '', supported: false, hint: '' },
    { agent: 'codex', found: true, version: 'codex-cli 0.158.0', supported: true, hint: '' },
    { agent: 'copilot', found: true, version: '1.0.89', supported: true, hint: '' },
  ])
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.locator('#new-session-btn').click()
  await page.locator('#ns-agent').selectOption('collab')
  await expect(page.locator('#ns-collab-author option')).toHaveText(['Codex', 'Copilot'])
})

// Collabs and new Codex sessions have no session id yet; ranking by it gave them all one
// slot, so their order was whatever the list happened to be.
test('sessions without an id are still ordered by their last activity', async ({ page }) => {
  await page.addInitScript(() => {
    let t
    Object.defineProperty(window, '__TAURI__', { configurable: true, get() { return t }, set(v) {
      const orig = v.core.invoke
      const mk = (name, at) => ({ sessionId: '', agent: 'codex', name, cwd: '/w', pid: 1, status: 'idle', state: 'active',
        notesPath: `/w/FEAT/${name}/notes.md`, root: 'Work', category: 'FEAT', updatedAt: at, lastActivityAt: null,
        ticketStates: [], goal: null, nextSteps: null, lastSummary: null, prLink: null, prLinks: null, ticket: null, tickets: null })
      v.core.invoke = (cmd, args) => cmd === 'get_sessions'
        ? orig(cmd, args).then(l => [...(l || []), mk('older-codex', 1000), mk('newer-codex', 9e12)])
        : orig(cmd, args)
      t = v
    } })
  })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  const names = await page.locator('.list-card-name').allTextContents()
  expect(names.indexOf('newer-codex')).toBeLessThan(names.indexOf('older-codex'))
})

// The first probe opens a login shell per CLI. A Start pressed meanwhile must not act on an
// Agent choice that appeared (preselected) after the person pressed it.
test('Start pressed before the agent choice appears waits for the person to pick', async ({ page }) => {
  await page.addInitScript((all) => {
    let t
    Object.defineProperty(window, '__TAURI__', { configurable: true, get() { return t }, set(v) {
      const orig = v.core.invoke
      window.__CALLS__ = []
      v.core.invoke = (cmd, args) => {
        window.__CALLS__.push(cmd)
        if (cmd === 'agents_available') return new Promise(r => setTimeout(() => r(all), 600))
        if (cmd === 'start_session') return Promise.resolve({ command: '', notesPath: '' })
        return orig(cmd, args)
      }
      t = v
    } })
    try { localStorage.setItem('csm.nsAgent', 'codex') } catch {}
  }, ALL)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.locator('#new-session-btn').click()
  await page.locator('#ns-name').fill('quick')
  await page.locator('#new-session-form').evaluate((f) => f.requestSubmit())
  await expect(page.locator('#ns-agent-field')).toBeVisible()
  await expect(page.locator('#ns-error')).toContainText('Pick the agent')
  expect(await page.evaluate(() => window.__CALLS__.includes('start_session'))).toBe(false)
})
