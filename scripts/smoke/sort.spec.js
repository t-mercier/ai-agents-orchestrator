// Sorting inside each category: Manual (the order you drag) by default, or by last update,
// or by the primary ticket's number either way. The choice is remembered.
const { test, expect } = require('@playwright/test')

async function seed(page) {
  await page.setViewportSize({ width: 1400, height: 1800 })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(async () => {
    try { localStorage.removeItem('csm.listSort'); localStorage.removeItem('csm.listorg') } catch {}
    if (viewMode !== 'list') setViewMode('list')
    const base = (await window.api.getSessions()).find(s => s.category === 'FEAT')
    const mk = (x, ticket, ago) => ({ ...base, name: x, sessionId: x, ticket, status: 'idle',
      notesPath: `/Users/dev/work/FEAT/${x}/notes.md`,
      lastActivityAt: new Date(Date.now() - ago * 60e3).toISOString(), updatedAt: null })
    const extra = [mk('t-300', 'FEAT-300', 50), mk('t-20', 'FEAT-20', 5), mk('t-none', '', 1)]
    const orig = window.api.getSessions
    window.api.getSessions = async (...a) => [...(await orig(...a)).filter(s => s.category !== 'FEAT'), ...extra]
    await fetchAndRender(true)
  })
}
const featNames = (page) => page.locator('.category-header[data-category="FEAT"] + .category-sessions .list-card-name')
  .evaluateAll(els => els.map(e => e.getAttribute('title')))

test('Sort by ticket orders each category by its primary ticket, and is remembered', async ({ page }) => {
  await seed(page)
  await page.locator('#cat-filter-list [data-sort-open]').click()
  await page.locator('#sort-menu [data-sort="ticket-asc"]').click()
  await expect.poll(() => featNames(page)).toEqual(['t-20', 't-300', 't-none'])
  // Sorted, so there is no manual order to drop into.
  await expect(page.locator('.category-header[data-category="FEAT"] + .category-sessions')).not.toHaveAttribute('data-drop-key', /.*/)
  expect(await page.evaluate(() => localStorage.getItem('csm.listSort'))).toBe('ticket-asc')
  await page.locator('#cat-filter-list [data-sort-open]').click()
  await page.locator('#sort-menu [data-sort="updated"]').click()
  await expect.poll(() => featNames(page)).toEqual(['t-none', 't-20', 't-300'])
})

test('Manual is the default, and keeps drag and drop', async ({ page }) => {
  await seed(page)
  await expect(page.locator('#cat-filter-list [data-sort-open]')).toContainText('Sort')
  await expect(page.locator('.category-header[data-category="FEAT"] + .category-sessions')).toHaveAttribute('data-drop-key', 'cat:FEAT')
})
