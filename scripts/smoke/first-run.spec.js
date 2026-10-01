// A fresh install, as a friend met it on 2026-10-01: the wizard installed the skills, and a
// banner said they were not installed once the wizard closed; with the banner up, scrolling
// moved the whole window, title bar included.
const { test, expect } = require('@playwright/test')

const NONE = { installed: false, present: [], missing: ['start-session'], differs: [], bundle_epoch: 2, installed_epoch: null }
const ALL = { installed: true, present: ['start-session'], missing: [], differs: [], bundle_epoch: 2, installed_epoch: 2 }

async function open(page, { onboarding }) {
  await page.addInitScript(({ NONE, ALL, onboarding }) => {
    let t
    window.__INSTALLED = false
    const skillsAnswered = new Promise(r => { window.__skillsAnswered = r })
    Object.defineProperty(window, '__TAURI__', {
      configurable: true,
      get() { return t },
      set(v) {
        const orig = v.core.invoke
        v.core.invoke = (cmd, args) => {
          if (cmd === 'skills_status') { const r = Promise.resolve(window.__INSTALLED ? ALL : NONE); window.__skillsAnswered && window.__skillsAnswered(); return r }
          if (cmd === 'install_skills') { window.__INSTALLED = true; return Promise.resolve({ installed: ['start-session'], skipped: [], config_seeded: false }) }
          // The wizard's own question is answered after the skills check (no timer: the
          // fixture clears every timer once the scene is set).
          if (cmd === 'needs_onboarding') return skillsAnswered.then(() => Promise.resolve()).then(() => onboarding && !window.__FINISHED)
          if (cmd === 'finish_onboarding') { window.__FINISHED = true; return Promise.resolve(null) }
          return orig(cmd, args)
        }
        t = v
      },
    })
    try { localStorage.removeItem('csm.skillsBannerDismissed') } catch {}
  }, { NONE, ALL, onboarding })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
}

test('skills installed by the wizard leave no "not installed" banner behind', async ({ page }) => {
  await open(page, { onboarding: true })
  await expect(page.locator('#onb-modal')).toHaveJSProperty('open', true)
  await page.evaluate(() => window.api.installSkills(false))   // the wizard's Install, as the friend clicked it
  await page.locator('#onb-skip').click()
  await expect(page.locator('#onb-modal')).toHaveJSProperty('open', false)
  await page.waitForTimeout(300)
  await expect(page.locator('#skills-banner')).toBeHidden()
})

test('a wizard closed without installing leaves the banner offering it', async ({ page }) => {
  await open(page, { onboarding: true })
  await page.locator('#onb-skip').click()
  await expect(page.locator('#skills-banner')).toContainText("aren't installed yet")
})

test('with a banner up, the window does not scroll and the title bar stays on top', async ({ page }) => {
  await open(page, { onboarding: false })
  await expect(page.locator('#skills-banner')).toBeVisible()
  const r = await page.evaluate(() => {
    const se = document.scrollingElement
    se.scrollTop = 500; window.scrollTo(0, 500)
    return { extra: se.scrollHeight - window.innerHeight, top: document.querySelector('.titlebar').getBoundingClientRect().top,
             layoutBottom: document.querySelector('.layout').getBoundingClientRect().bottom, h: window.innerHeight }
  })
  expect(r.extra).toBeLessThanOrEqual(0)
  expect(r.top).toBe(0)
  expect(r.layoutBottom).toBeLessThanOrEqual(r.h)
})
