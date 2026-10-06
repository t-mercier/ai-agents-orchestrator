// Pins: a ninth pin says why it is refused, and a session that leaves Running gives its pin
// back. "Needs you" stays in view while the rest of the list scrolls.
const { test, expect } = require('@playwright/test')

async function seed(page, { viewport = { width: 1400, height: 1800 }, waiting = 0, count = 9 } = {}) {
  await page.setViewportSize(viewport)
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(async ({ waiting, count }) => {
    try { localStorage.removeItem('csm.pinnedKeys'); localStorage.removeItem('csm.listorg') } catch {}
    if (viewMode !== 'list') setViewMode('list')
    const base = (await window.api.getSessions())[0]
    const mk = (i) => ({ ...base, name: `p-${i}`, sessionId: `p-${i}`, category: 'FEAT', ticket: '',
      status: i < waiting ? 'waiting' : 'idle', state: 'active', notesPath: `/Users/dev/work/FEAT/p-${i}/notes.md` })
    window.__seeded = Array.from({ length: count }, (_, i) => mk(i))
    window.api.getSessions = async () => window.__seeded
    window.api.getHistoricalSessions = async () => []
    await fetchAndRender(true)
  }, { waiting, count })
}

test('a ninth pin is refused with a message', async ({ page }) => {
  await seed(page)
  await page.evaluate(() => { for (let i = 0; i < 8; i++) window.togglePin(`/Users/dev/work/FEAT/p-${i}/notes.md`) })
  await page.locator('.pin-btn[data-pin-key="/Users/dev/work/FEAT/p-8/notes.md"]').click()
  await expect(page.locator('.shortcut-note')).toContainText('Max pinned sessions reached')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('csm.pinnedKeys')).length)).toBe(8)
})

test('a session that leaves Running is unpinned', async ({ page }) => {
  await seed(page)
  const gone = '/Users/dev/work/FEAT/p-0/notes.md'
  await page.evaluate((k) => window.togglePin(k), gone)
  await page.evaluate(async () => { window.__seeded = window.__seeded.slice(1); await fetchAndRender(true) })
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('csm.pinnedKeys')))).toEqual([])
})

test('a closed session shows no pin control and does not float as pinned', async ({ page }) => {
  await seed(page)
  await page.evaluate(async () => {
    window.togglePin('/Users/dev/work/FEAT/p-0/notes.md')
    window.__seeded[0] = { ...window.__seeded[0], state: 'closed' }
    renderAll(window.__seeded, null, 'closed', true)
  })
  await expect(page.locator('.pin-btn[data-pin-key="/Users/dev/work/FEAT/p-0/notes.md"]')).toHaveCount(0)
  await expect(page.locator('.list-pinned')).toHaveCount(0)
})

test('"Needs you" stays at the top while the list scrolls', async ({ page }) => {
  await seed(page, { viewport: { width: 1400, height: 600 }, waiting: 1, count: 40 })
  const list = page.locator('#panel-list')
  await list.evaluate(el => { el.scrollTop = el.scrollHeight })
  const header = page.locator('.category-header[data-category="⚡ Needs you"]')
  await expect(header).toBeInViewport()
  const [h, l] = [await header.boundingBox(), await list.boundingBox()]
  expect(Math.abs(h.y - l.y)).toBeLessThan(4)
})
