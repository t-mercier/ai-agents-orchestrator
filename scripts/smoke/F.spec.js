// Smoke tests for four renderer defects in app.js: keyboard shortcuts acting behind an
// open dialog, unescaped space names in the +New picker, a category reorder that never
// stuck, and the "already running" check depending on the List tab.
const { test, expect } = require('@playwright/test')

test.beforeEach(async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.__errors = errors
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
})

test('list shortcuts do nothing while a dialog is open', async ({ page }) => {
  await page.evaluate(() => {
    if (viewMode !== 'list') setViewMode('list')
    const first = document.querySelector('#panel-list .list-card[data-key]').dataset.key
    navSelect(first)
    window.__OPENED__ = false
    window.openSessionDefault = () => { window.__OPENED__ = true }
    window.confirmAction({ title: 'Delete?', body: 'x', confirmLabel: 'Delete' })
  })
  await expect(page.locator('#confirm-modal')).toBeVisible()
  const before = await page.evaluate(() => window._lastSelectedKey)
  await page.keyboard.press('ArrowDown')
  expect(await page.evaluate(() => window._lastSelectedKey), 'ArrowDown moved the list behind the dialog').toBe(before)
  // Enter on the focused dialog button must not also resume the list's selected session.
  await page.evaluate(() => { const b = document.getElementById('confirm-cancel') || document.querySelector('#confirm-modal button'); b.focus() })
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => window.__OPENED__), 'Enter resumed the session behind the dialog').toBe(false)
})

test('a space name with a quote survives the +New space picker', async ({ page }) => {
  const opts = await page.evaluate(() => {
    window.CSM_CONFIG.roots.push({ name: 'Side "projects" <x>', path: '/Users/dev/side' })
    window.CSM_CONFIG.categories.push({ name: 'OSS', root: 'Side "projects" <x>' })
    populateNewSessionCategories()
    return [...document.querySelectorAll('#ns-space option')].map(o => ({ value: o.value, text: o.textContent }))
  })
  expect(opts).toContainEqual({ value: 'Side "projects" <x>', text: 'Side "projects" <x>' })
})

test('dragging a category block reorders categories and writes no derived field', async ({ page }) => {
  await page.evaluate(() => { if (viewMode !== 'list') setViewMode('list'); window.__LAST_SET_CONFIG__ = null })
  const blocks = page.locator('[data-drop-key="__toplevel__"] > [data-drag-kind="category"]')
  expect(await blocks.count()).toBeGreaterThan(1)
  const ids = await blocks.evaluateAll(els => els.map(e => e.dataset.dragId))
  const src = await blocks.nth(1).locator('.category-header').boundingBox()
  const dst = await blocks.nth(0).locator('.category-header').boundingBox()
  await page.mouse.move(src.x + 40, src.y + src.height / 2)
  await page.mouse.down()
  await page.mouse.move(src.x + 40, src.y + src.height / 2 - 10, { steps: 3 })
  await page.mouse.move(dst.x + 40, dst.y + 2, { steps: 5 })
  await page.mouse.up()
  await page.waitForFunction(() => window.__LAST_SET_CONFIG__ !== null, { timeout: 5_000 })
  const sent = await page.evaluate(() => window.__LAST_SET_CONFIG__)
  const names = sent.categories.map(c => c.name)
  // The dragged block (second) now comes before the first.
  expect(names.indexOf(ids[1])).toBeLessThan(names.indexOf(ids[0]))
  for (const k of ['order', 'scanDirs', 'colorMap', 'home']) expect(sent, `derived "${k}" written back`).not.toHaveProperty(k)
  expect(sent.roots).toEqual([{ name: 'Work', path: '/Users/dev/work' }])
})

test('a running session counts as live on the Board whichever List tab was last shown', async ({ page }) => {
  const r = await page.evaluate(async () => {
    switchTab('closed')
    await fetchAndRender(true)
    setViewMode('board')
    await window.refreshBoard()
    return { live: window.isSessionLive('checkout-redesign'), stale: window.isSessionLive('legacy-export') }
  })
  expect(r.live, 'an active session must be live on the Board').toBe(true)
  expect(r.stale, 'a stale session is not live').toBe(false)
})

test('a stale board index cannot mark an exited session live in the List', async ({ page }) => {
  const r = await page.evaluate(async () => {
    setViewMode('board')
    await window.refreshBoard()
    setViewMode('list')
    switchTab('running')
    await fetchAndRender(true)
    const k = Object.keys(window._boardIndex).find(k => window._boardIndex[k].sessionId === 'legacy-export')
    window._boardIndex[k] = { ...window._boardIndex[k], state: 'active' }
    return window.isSessionLive('legacy-export')
  })
  expect(r).toBe(false)
})
