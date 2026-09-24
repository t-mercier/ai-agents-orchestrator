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
