// Smoke tests for board, onboarding, settings and CSS defects fixed in the H review pass.
// Each one reproduces what a user saw in the window; the pure-data halves are in jest.
const { test, expect } = require('@playwright/test')

test.beforeEach(async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.__errors = errors
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
})

const P = (n) => `/Users/dev/work/${n}/notes.md`
const H1 = P('BUG/race-on-logout'), H2 = P('TEST/flaky-checkout-e2e')
const A = P('CHORE/bump-deps'), B = P('PERSO/blog-engine'), X = P('FEAT/search-suggest')

async function openBoard(page) {
  await page.evaluate(() => window.setViewMode('board'))
  await page.waitForSelector('#board-view .kb-col')
}

test.describe('board', () => {
  test('a drop between cards lands there while a filter hides other cards', async ({ page }) => {
    await openBoard(page)
    await page.evaluate(({ H1, H2, A, B, X }) => {
      let s = CSMBoard.emptyState()
      const col = s.columns[0].id
      for (const k of [H1, H2, A, B, X]) s = CSMBoard.placeSession(s, k, col)
      s.order[col] = [H1, H2, A, B, X]
      window.__col = col
      // Stands in for a search that matches every card but H1 and H2.
      const hidden = new Set([H1, H2].map(k => window._boardIndex[k]))
      window.passesSearch = (sess) => !hidden.has(sess)
      window.applyBoard(s)
    }, { H1, H2, A, B, X })
    const col = await page.evaluate(() => window.__col)
    const body = page.locator(`[data-col-drop="${col}"]`)
    await expect(body.locator(':scope > .kb-card')).toHaveCount(3)
    const x = body.locator(`.kb-card[data-id="${X}"] .kb-card-top`)
    const b = await body.locator(`.kb-card[data-id="${B}"]`).boundingBox()
    const xb = await x.boundingBox()
    await page.mouse.move(xb.x + 10, xb.y + 5)
    await page.mouse.down()
    await page.mouse.move(xb.x + 20, xb.y - 20, { steps: 4 })
    await page.mouse.move(b.x + 20, b.y + 3, { steps: 6 })
    await page.mouse.up()
    const order = await page.evaluate((c) => CSMBoard.orderedIds(CSMBoard.load(), c), col)
    expect(order.filter(k => ![H1, H2].includes(k))).toEqual([A, X, B])
  })

  test('"+ note" during a search edits the new note, not an existing one', async ({ page }) => {
    await openBoard(page)
    await page.fill('#board-search', 'design sign-off')   // matches only note n-2, in "waiting"
    const col = 'waiting'
    await page.locator(`[data-add-note="${col}"]`).click()
    const input = page.locator('.kb-note-input')
    await expect(input).toBeVisible()
    expect(await input.inputValue()).toBe('')
    const st = await page.evaluate(() => CSMBoard.load().notes.map(n => ({ id: n.id, text: n.text })))
    expect(st.find(n => n.id === 'n-2').text).toBe('Blocked on design sign-off for the summary column.')
  })
})

test.describe('settings', () => {
  test('saving Settings keeps the chosen terminal app', async ({ page }) => {
    await page.evaluate(() => { window.CSM_CONFIG.terminalApp = 'iterm' })
    await page.locator('#settings-btn').click()
    await expect(page.locator('#set-terminal')).toHaveValue('iterm')
    await page.locator('#settings-modal form').evaluate((f) => f.requestSubmit())
    await expect.poll(() => page.evaluate(() => window.__LAST_SET_CONFIG__ && window.__LAST_SET_CONFIG__.terminalApp))
      .toBe('iterm')
  })

  test('closing Settings mid-remap does not swallow the next key', async ({ page }) => {
    await page.locator('#settings-btn').click()
    await page.locator('[data-settings-tab="shortcuts"]').click()
    const cap = page.locator('#set-keys .key-cap').first()
    const action = await cap.getAttribute('data-key-action')
    const before = await page.evaluate((a) => window.getKeys()[a], action)
    await cap.click()
    // <dialog> fires 'close' as a queued task, after close() returns; a user's next key
    // always comes later than that, so wait for it rather than race it.
    await page.evaluate(() => {
      const m = document.getElementById('settings-modal')
      window.__settingsClosed = new Promise(r => m.addEventListener('close', r, { once: true }))
    })
    await page.locator('#set-cancel').click()
    await page.evaluate(() => window.__settingsClosed)
    await page.keyboard.press('q')
    expect(await page.evaluate((a) => window.getKeys()[a], action)).toBe(before)
  })
})

test.describe('first-run setup', () => {
  // A blank install: the wizard seeds one space ("Work") and one category ("FEAT").
  async function openWizard(page) {
    await page.evaluate(() => {
      window.__imports = []
      window.__setConfigs = []
      const sessions = ['s1', 's2', 's3'].map((id, i) => ({ sessionId: id, title: id, cwd: '/x/' + id, mtime: 100 - i }))
      Object.assign(window.api, {
        discoverSessionsPage: async () => ({ ok: true, sessions, total: sessions.length, scanned: 3 }),
        pathsExist: async (paths) => paths.map(() => true),
        setConfig: async (cfg) => { window.__setConfigs.push(cfg); return { ok: true } },
        importSessionHeadless: async (sessionId) => { window.__imports.push(sessionId); return { ok: true } },
        skillsStatus: async () => ({ present: [], missing: [] }),
        advisorModel: async () => '',
        hooksStatus: async () => [],
        finishOnboarding: async () => null,
      })
      window.reloadConfig = async () => {}
      window.CSM_CONFIG.roots = []
      window.CSM_CONFIG.categories = []
      window.openOnboarding()
    })
    await expect(page.locator('#onb-modal')).toBeVisible()
    await expect(page.locator('#onb-cats select')).toHaveCount(1)
  }

  test('renaming a space carries its categories with it', async ({ page }) => {
    await openWizard(page)
    await page.locator('#onb-spaces .onb-edit-row input[type=text]').first().fill('Job')
    await expect(page.locator('#onb-cats select').first()).toHaveValue('Job')
    await page.locator('#onb-spaces .onb-grow').first().fill('/x')
    await page.locator('#onb-next').click()
    await expect.poll(() => page.evaluate(() => window.__setConfigs.length)).toBe(1)
    const cfg = await page.evaluate(() => window.__setConfigs[0])
    expect(cfg.roots.map(r => r.name)).toEqual(['Job'])
    expect(cfg.categories.map(c => c.root)).toEqual(['Job'])
  })

  test('"+ Add a space" and "+ Add a category" add an editable row', async ({ page }) => {
    await openWizard(page)
    await page.locator('#onb-add-space').click()
    await expect(page.locator('#onb-spaces .onb-space-block')).toHaveCount(2)
    await expect(page.locator('#onb-spaces .onb-space-block').last().locator('input[type=text]').first()).toBeFocused()
    await page.locator('#onb-add-cat').click()
    await expect(page.locator('#onb-cats .onb-edit-row')).toHaveCount(2)
    await expect(page.locator('#onb-cats .onb-edit-row').last().locator('input[type=text]')).toBeFocused()
  })

  test('Back, tick another session, Import: the new one is imported too', async ({ page }) => {
    await openWizard(page)
    await page.locator('#onb-spaces .onb-grow').first().fill('/x')
    await page.locator('#onb-next').click()                                   // → sessions
    await expect(page.locator('#onb-sessions .onb-row')).toHaveCount(3)
    const boxes = page.locator('#onb-sessions .onb-row input[type=checkbox]')
    for (let i = 0; i < 3; i++) await boxes.nth(i).setChecked(i === 0)
    await page.locator('#onb-next').click()                                   // → import
    await expect(page.locator('#onb-next')).toHaveText('Import')
    await page.locator('#onb-next').click()
    await expect.poll(() => page.evaluate(() => window.__imports)).toEqual(['s1'])
    await expect(page.locator('#onb-next')).toHaveText('Next')
    await page.locator('#onb-back').click()                                   // → sessions
    await boxes.nth(1).setChecked(true)
    await page.locator('#onb-next').click()                                   // → import
    await expect(page.locator('#onb-next')).toHaveText('Import')
    await page.locator('#onb-next').click()
    await expect.poll(() => page.evaluate(() => window.__imports)).toEqual(['s1', 's2'])
    await expect(page.locator('#onb-step-3')).toBeVisible()
  })
})

test.describe('styles', () => {
  test('the docked Brutus panel rule parses (no selector-less block swallows it)', async ({ page }) => {
    const found = await page.evaluate(() => {
      for (const sh of document.styleSheets) {
        let rules; try { rules = sh.cssRules } catch { continue }
        for (const r of rules) if (r.selectorText === '.v-C.docked') return r.style.boxShadow
      }
      return null
    })
    expect(found).toBe('none')
  })

  test('a keyboard-focused dialog button shows a focus indicator', async ({ page }) => {
    await page.evaluate(() => { window.confirmAction({ title: 'Delete', body: 'Sure?', confirmLabel: 'Delete' }) })
    await expect(page.locator('dialog[open] .modal-btn').first()).toBeVisible()
    await page.keyboard.press('Tab')
    const f = await page.evaluate(() => {
      const b = document.activeElement
      const ring = (el) => { const c = getComputedStyle(el); return c.boxShadow + '|' + c.outlineStyle }
      const other = [...b.closest('dialog').querySelectorAll('.modal-btn')].find(x => x !== b && x.offsetParent)
      return { isBtn: b.classList.contains('modal-btn'), fv: b.matches(':focus-visible'), ring: ring(b), otherRing: other ? ring(other) : null }
    })
    expect(f.isBtn && f.fv).toBe(true)
    expect(f.otherRing).not.toBeNull()
    expect(f.ring, 'the focused button must differ from its unfocused sibling').not.toBe(f.otherRing)
  })

  test('in board mode the session drawer ends above the usage bar', async ({ page }) => {
    await openBoard(page)
    await page.evaluate(() => {
      document.documentElement.classList.add('has-usage')
      document.getElementById('usage-bar').hidden = false
      window.openBoardDetail(Object.keys(window._boardIndex)[0])
    })
    const m = await page.evaluate(() => {
      const d = document.querySelector('.panel-detail').getBoundingClientRect()
      const u = document.getElementById('usage-bar').getBoundingClientRect()
      return { drawerBottom: d.bottom, barTop: u.top, hit: document.elementFromPoint(d.right - 20, d.bottom - 5)?.closest('.panel-detail') != null }
    })
    expect(m.drawerBottom).toBeLessThanOrEqual(m.barTop + 0.5)
    expect(m.hit).toBe(true)
  })
})

test.describe('platform labels', () => {
  const labels = (page) => page.evaluate(() => ({
    btnTitle: document.getElementById('brutus-btn').title,
    kbd: document.querySelector('#brutus-btn .bru-kbd').textContent,
    hint: [...document.querySelectorAll('kbd')].map(k => k.textContent).find(t => /K$/.test(t)),
  }))

  test('off macOS the Brutus shortcut reads Ctrl+K', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Linux x86_64' }))
    await page.goto('/index.html')
    await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
    const l = await labels(page)
    expect(l.btnTitle).toContain('Ctrl+K')
    expect(l.kbd).toBe('Ctrl+K')
    expect(l.hint).toBe('Ctrl+K')
  })

  test('on macOS it stays ⌘K', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' }))
    await page.goto('/index.html')
    await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
    const l = await labels(page)
    expect(l.btnTitle).toContain('⌘K')
    expect(l.kbd).toBe('⌘K')
    expect(l.hint).toBe('⌘K')
  })
})
