// Settings → Models (asked for on 2026-09-30: "I have Copilot AND Claude, and no way to set
// Copilot as the app's main model"): the agent ＋New starts with, and the model each agent
// runs on, picked from the list the CLI itself gives, or typed.
const { test, expect } = require('@playwright/test')

const AGENTS = [
  { agent: 'claude', found: true, version: '2.1.284', supported: true, hint: '' },
  { agent: 'codex', found: true, version: 'codex-cli 0.158.0', supported: true, hint: '' },
  { agent: 'copilot', found: true, version: '1.0.89', supported: true, hint: '' },
]

const CATALOG = {
  claude: { signedIn: true, models: [] },
  codex: { signedIn: true, models: [{ id: 'gpt-6-sol', label: 'GPT-6-Sol' }, { id: 'gpt-5.4', label: 'GPT-5.4' }] },
  copilot: { signedIn: null, models: [{ id: 'claude-opus-5.5', label: 'claude-opus-5.5' }, { id: 'gpt-6-sol', label: 'gpt-6-sol' }] },
}

async function open(page, cfg, agents = AGENTS, catalog = CATALOG) {
  await page.addInitScript(({ cfg, agents, catalog }) => {
    let t
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      get() { return t },
      set(v) {
        const orig = v.core.invoke
        v.core.invoke = (cmd, args) => {
          if (cmd === 'agents_available') return Promise.resolve(agents)
          if (cmd === 'agent_catalog') return Promise.resolve(catalog)
          if (cmd === 'get_config') return orig(cmd, args).then(c => ({ ...c, ...cfg }))
          return orig(cmd, args)
        }
        t = v
      },
    })
  }, { cfg, agents, catalog })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
}

test('Settings → Models saves the main agent and a model per agent, listed or typed', async ({ page }) => {
  await open(page, {})
  await page.evaluate(() => window.openSettingsTab('models'))
  await expect(page.locator('#set-main-agent')).toHaveValue('claude')
  await page.selectOption('#set-main-agent', 'copilot')
  await expect(page.locator('#set-copilot-model-pick option[value="gpt-6-sol"]')).toHaveCount(1)
  await page.selectOption('#set-copilot-model-pick', 'gpt-6-sol')
  await page.selectOption('#set-codex-model-pick', '__other')
  await page.fill('#set-codex-model', '  gpt-9-preview ')
  await page.locator('#settings-modal form').evaluate((f) => f.requestSubmit())
  await expect.poll(() => page.evaluate(() => window.__LAST_SET_CONFIG__ && window.__LAST_SET_CONFIG__.mainAgent)).toBe('copilot')
  const saved = await page.evaluate(() => window.__LAST_SET_CONFIG__)
  expect(saved.copilotModel).toBe('gpt-6-sol')
  expect(saved.codexModel).toBe('gpt-9-preview')
})

test('a saved model shows as picked when listed, and as typed when not', async ({ page }) => {
  await open(page, { mainAgent: 'codex', codexModel: 'gpt-5.4', copilotModel: 'my-byok-model' })
  await page.evaluate(() => window.openSettingsTab('models'))
  await expect(page.locator('#set-main-agent')).toHaveValue('codex')
  await expect(page.locator('#set-codex-model-pick')).toHaveValue('gpt-5.4')
  await expect(page.locator('#set-codex-model')).toBeHidden()
  await expect(page.locator('#set-copilot-model-pick')).toHaveValue('__other')
  await expect(page.locator('#set-copilot-model')).toBeVisible()
  await expect(page.locator('#set-copilot-model')).toHaveValue('my-byok-model')
})

test('an agent that is signed out says so, and how to sign in', async ({ page }) => {
  await open(page, {}, AGENTS, { ...CATALOG, codex: { signedIn: false, models: [] } })
  await page.evaluate(() => window.openSettingsTab('models'))
  await expect(page.locator('#set-codex-status')).toContainText('Not signed in')
  await expect(page.locator('#set-codex-status')).toContainText('codex login')
  await expect(page.locator('#set-main-agent option[value="codex"]')).toContainText('not signed in')
})

test('the Claude list names Opus 5.5', async ({ page }) => {
  await open(page, {})
  await page.evaluate(() => window.openSettingsTab('models'))
  await expect(page.locator('#set-model option', { hasText: 'Opus 5.5' }).first()).toHaveCount(1)
})

test('a model that reads as an option is refused before saving', async ({ page }) => {
  await open(page, {})
  await page.evaluate(() => window.openSettingsTab('models'))
  await page.selectOption('#set-codex-model-pick', '__other')
  await page.fill('#set-codex-model', '--yolo')
  await page.locator('#settings-modal form').evaluate((f) => f.requestSubmit())
  await expect(page.locator('#set-error')).toContainText('--yolo')
  expect(await page.evaluate(() => window.__LAST_SET_CONFIG__ || null)).toBe(null)
})

test('＋New starts on the main agent', async ({ page }) => {
  await open(page, { mainAgent: 'copilot' })
  await page.locator('#new-session-btn').click()
  await expect(page.locator('#ns-agent-field')).toBeVisible()
  await expect(page.locator('#ns-agent')).toHaveValue('copilot')
})

test('a main agent that is not installed falls back to Claude Code in ＋New', async ({ page }) => {
  await open(page, { mainAgent: 'copilot' }, AGENTS.filter(a => a.agent !== 'copilot'))
  await page.locator('#new-session-btn').click()
  await expect(page.locator('#ns-agent')).toHaveValue('claude')
})
