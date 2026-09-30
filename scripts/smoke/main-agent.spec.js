// The main agent (asked for on 2026-09-30: "I have Copilot AND Claude, and no way to set
// Copilot as the app's main model"): Settings chooses the agent ＋New starts with and the
// model each agent runs on.
const { test, expect } = require('@playwright/test')

const AGENTS = [
  { agent: 'claude', found: true, version: '2.1.284', supported: true, hint: '' },
  { agent: 'codex', found: true, version: 'codex-cli 0.158.0', supported: true, hint: '' },
  { agent: 'copilot', found: true, version: '1.0.89', supported: true, hint: '' },
]

async function open(page, cfg, agents = AGENTS) {
  await page.addInitScript(({ cfg, agents }) => {
    let t
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      get() { return t },
      set(v) {
        const orig = v.core.invoke
        v.core.invoke = (cmd, args) => {
          if (cmd === 'agents_available') return Promise.resolve(agents)
          if (cmd === 'get_config') return orig(cmd, args).then(c => ({ ...c, ...cfg }))
          return orig(cmd, args)
        }
        t = v
      },
    })
  }, { cfg, agents })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
}

test('Settings saves the main agent and the model of each agent', async ({ page }) => {
  await open(page, {})
  await page.evaluate(() => window.openSettingsTab('terminal'))
  await expect(page.locator('#set-main-agent')).toHaveValue('claude')
  await page.selectOption('#set-main-agent', 'copilot')
  await page.fill('#set-copilot-model', '  gpt-5.6-sol ')
  await page.fill('#set-codex-model', 'gpt-5.4')
  await page.locator('#settings-modal form').evaluate((f) => f.requestSubmit())
  await expect.poll(() => page.evaluate(() => window.__LAST_SET_CONFIG__ && window.__LAST_SET_CONFIG__.mainAgent)).toBe('copilot')
  const saved = await page.evaluate(() => window.__LAST_SET_CONFIG__)
  expect(saved.copilotModel).toBe('gpt-5.6-sol')
  expect(saved.codexModel).toBe('gpt-5.4')
})

test('Settings shows the saved main agent and models', async ({ page }) => {
  await open(page, { mainAgent: 'codex', codexModel: 'gpt-5.4', copilotModel: 'claude-opus-5' })
  await page.evaluate(() => window.openSettingsTab('terminal'))
  await expect(page.locator('#set-main-agent')).toHaveValue('codex')
  await expect(page.locator('#set-codex-model')).toHaveValue('gpt-5.4')
  await expect(page.locator('#set-copilot-model')).toHaveValue('claude-opus-5')
})

test('a model that reads as an option is refused before saving', async ({ page }) => {
  await open(page, {})
  await page.evaluate(() => window.openSettingsTab('terminal'))
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
