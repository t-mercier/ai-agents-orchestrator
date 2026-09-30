// Inviting other models into a live session (asked for on 2026-09-29/30): the session's
// agent consults them read-only through ao_ask.py; the app writes who is invited, types the
// invitation into the session's terminal, and shows the thread of consultations.
const { test, expect } = require('@playwright/test')

const PAY = '/Users/dev/work/REVIEW/payments-api/notes.md'
const THREAD = {
  entries: [1, 2, 3].map(n => ({ id: 'j' + n, invitee: 'gpt', state: 'done', at: '2026-09-30T14:0' + n + ':00', took: 40,
    heading: '14:0' + n + ' · GPT (Codex)', question: 'Is the retry right? #' + n, answer: 'Mostly. The backoff never resets. #' + n })),
  jobs: [{ id: 'j4', invitee: 'copilot', label: 'Copilot', state: 'running', startedAt: '2026-09-30T14:10:00', quietSecs: 12 }],
}

async function open(page, { advisors = {}, agents, terminal = true } = {}) {
  await page.addInitScript(({ advisors, agents }) => {
    let t
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      get() { return t },
      set(v) {
        const orig = v.core.invoke
        window.__CALLS__ = []
        v.core.invoke = (cmd, args) => {
          window.__CALLS__.push({ cmd, args })
          if (cmd === 'agents_available') return Promise.resolve(agents || [
            { agent: 'claude', found: true, supported: true, hint: '' },
            { agent: 'codex', found: true, supported: true, hint: '' },
            { agent: 'copilot', found: true, supported: true, hint: '' },
          ])
          if (cmd === 'get_sessions') return orig(cmd, args).then(l => (l || []).map(s => ({ ...s, advisors: advisors[s.name] || [] })))
          if (cmd === 'advisors_set') return Promise.resolve(null)
          if (cmd === 'other_models') return Promise.resolve(window.__THREAD__ || { entries: [], jobs: [] })
          if (cmd === 'advisor_stop') return Promise.resolve(null)
          return orig(cmd, args)
        }
        t = v
      },
    })
  }, { advisors, agents })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  // An embedded terminal for every session, so typing into it can be observed.
  if (terminal) await page.evaluate(() => { window.liveTerminalKeyFor = (sid, notes) => 'pty:' + notes })
}

// A session with a terminal shows the terminal, not its info pane: its menu is the way in.
async function menu(page, name, item) {
  await card(page, name).click({ button: 'right' })
  await page.locator('#session-menu .board-menu-item', { hasText: item }).click()
}

const card = (page, name) => page.locator(`#panel-list .list-card[data-key$="${name}/notes.md"]`)
const calls = (page, cmd) => page.evaluate((c) => window.__CALLS__.filter(x => x.cmd === c).map(x => x.args), cmd)

test('invite is refused while the session works or waits', async ({ page }) => {
  await open(page)
  await card(page, 'race-on-logout').click({ button: 'right' })
  const row = page.locator('#session-menu .board-menu-item', { hasText: 'Invite models…' })
  await expect(row).toBeDisabled()
  await expect(row).toHaveAttribute('title', /working/)
  await page.keyboard.press('Escape')
  await card(page, 'checkout-redesign').click({ button: 'right' })
  await expect(page.locator('#session-menu .board-menu-item', { hasText: 'Invite models…' })).toHaveAttribute('title', /waiting on an answer/)
})

test('the dialog offers the installed CLIs with a model each, and the notice', async ({ page }) => {
  await open(page, { agents: [
    { agent: 'claude', found: true, supported: true, hint: '' },
    { agent: 'codex', found: true, supported: true, hint: '' },
    { agent: 'copilot', found: true, supported: false, hint: 'Copilot 1.0 or later is needed: npm i -g @github/copilot' },
  ] })
  await menu(page, 'payments-api', 'Invite models…')
  const d = page.locator('#invite-models-modal')
  await expect(d).toHaveJSProperty('open', true)
  await expect(d.locator('[data-om-row="claude"] select')).toBeVisible()
  await expect(d.locator('[data-om-row="codex"] input[type="text"]')).toBeVisible()
  await expect(d.locator('[data-om-row="copilot"] input[type="checkbox"]')).toBeDisabled()
  await expect(d).toContainText('npm i -g @github/copilot')
  await expect(d).toContainText('sent to their provider')
})

test('Invite writes the invitees, then pastes the line and presses Enter', async ({ page }) => {
  await open(page)
  await menu(page, 'payments-api', 'Invite models…')
  const d = page.locator('#invite-models-modal')
  await d.locator('[data-om-row="codex"] input[type="checkbox"]').check()
  await d.locator('[data-om-row="copilot"] input[type="checkbox"]').check()
  await d.locator('[data-om-row="copilot"] input[type="text"]').fill('gpt-5.4')
  await d.locator('[data-om-invite]').click()
  await expect(d).toHaveJSProperty('open', false)
  const set = await calls(page, 'advisors_set')
  expect(set[0].notesPath).toBe(PAY)
  expect(set[0].advisors.map(a => [a.id, a.cli, a.model, a.label])).toEqual([['gpt', 'codex', '', 'GPT (Codex)'], ['copilot', 'copilot', 'gpt-5.4', 'Copilot · gpt-5.4']])
  await expect.poll(async () => (await calls(page, 'pty_input')).length).toBe(2)
  const [paste, enter] = await calls(page, 'pty_input')
  expect(paste.sessionId).toBe('pty:' + PAY)
  expect(paste.data.startsWith('\x1b[200~Other models are invited to this session: GPT (Codex), Copilot · gpt-5.4.')).toBe(true)
  expect(paste.data).toContain(`ao_ask.py guide --session '${PAY}'`)
  expect(enter.data).toBe('\r')
})

test('a bad model name is refused in the dialog', async ({ page }) => {
  await open(page)
  await menu(page, 'payments-api', 'Invite models…')
  const d = page.locator('#invite-models-modal')
  await d.locator('[data-om-row="copilot"] input[type="checkbox"]').check()
  await d.locator('[data-om-row="copilot"] input[type="text"]').fill('-x')
  await d.locator('[data-om-invite]').click()
  await expect(d.locator('.om-error')).toContainText('model')
  expect(await calls(page, 'advisors_set')).toEqual([])
})

test('a session with invitees shows the chip and the Other models thread; Stop stops a running one', async ({ page }) => {
  await open(page, { terminal: false, advisors: { 'payments-api': [{ id: 'gpt', cli: 'codex', model: '', label: 'GPT (Codex)' }, { id: 'copilot', cli: 'copilot', model: '', label: 'Copilot' }] } })
  await page.evaluate((t) => { window.__THREAD__ = t }, THREAD)
  await expect(card(page, 'payments-api').locator('.om-chip')).toHaveText('+ GPT, Copilot')
  await card(page, 'payments-api').click()
  const sec = page.locator('#detail-info-pane .om-section')
  await expect(sec).toContainText('Other models')
  await expect(sec.locator('.om-entry')).toHaveCount(3)
  await expect(sec.locator('.om-entry.folded')).toHaveCount(1)
  await expect(sec).toContainText('The backoff never resets. #3')
  await expect(sec.locator('.om-job')).toContainText('Copilot')
  await sec.locator('.om-job [data-om-stop]').click()
  await expect.poll(async () => (await calls(page, 'advisor_stop'))[0]).toEqual({ notesPath: PAY, id: 'j4' })
})

test('Dismiss clears the invitees and tells the terminal', async ({ page }) => {
  await open(page, { advisors: { 'payments-api': [{ id: 'gpt', cli: 'codex', model: '', label: 'GPT (Codex)' }] } })
  await menu(page, 'payments-api', 'Dismiss models')
  await expect.poll(async () => (await calls(page, 'advisors_set'))[0]).toEqual({ notesPath: PAY, advisors: [] })
  await expect.poll(async () => (await calls(page, 'pty_input')).map(c => c.data).join('')).toContain('no longer invited')
})

test('the dialog opens with the models already invited, so inviting again keeps them', async ({ page }) => {
  await open(page, { advisors: { 'payments-api': [{ id: 'gpt', cli: 'codex', model: '', label: 'GPT (Codex)' }, { id: 'copilot', cli: 'copilot', model: 'gpt-5.4', label: 'Copilot · gpt-5.4' }] } })
  await menu(page, 'payments-api', 'Invite models…')
  const d = page.locator('#invite-models-modal')
  await expect(d.locator('[data-om-row="codex"] input[type="checkbox"]')).toBeChecked()
  await expect(d.locator('[data-om-row="copilot"] input[type="checkbox"]')).toBeChecked()
  await expect(d.locator('[data-om-row="copilot"] input[type="text"]')).toHaveValue('gpt-5.4')
  await expect(d.locator('[data-om-row="claude"] input[type="checkbox"]')).not.toBeChecked()
  await d.locator('[data-om-row="claude"] input[type="checkbox"]').check()
  await d.locator('[data-om-invite]').click()
  const set = await calls(page, 'advisors_set')
  expect(set[0].advisors.map(a => a.id)).toEqual(['claude', 'gpt', 'copilot'])
})

test('a Codex session can invite models', async ({ page }) => {
  await open(page)
  await card(page, 'payments-api').click()
  // The pinned-skill refusal of non-Claude sessions does not apply to inviting.
  await page.evaluate(() => { const s = (window._lastSessions || []).find(x => x.name === 'payments-api'); if (s) s.agent = 'codex' })
  await card(page, 'payments-api').click({ button: 'right' })
  await expect(page.locator('#session-menu .board-menu-item', { hasText: 'Invite models…' })).toBeEnabled()
})
