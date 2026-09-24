// A session dragged within a category nobody has reordered yet went back to the top: the
// drop index counts every rendered card, and the stored order held only moved ones.
const { test, expect } = require('@playwright/test')

test('a card dragged to the bottom of a fresh category stays at the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1800 })   // every FEAT card on screen
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(async () => {
    try { localStorage.removeItem('csm.listorg') } catch {}
    if (viewMode !== 'list') setViewMode('list')
    // Two more FEAT sessions, so the category holds three cards.
    const base = (await window.api.getSessions()).find(s => s.category === 'FEAT')
    const extra = ['a', 'b'].map((x) => ({ ...base, sessionId: `feat-${x}`, name: `feat-${x}`,
      notesPath: base.notesPath.replace(/[^/]+\/notes\.md$/, `feat-${x}/notes.md`), status: 'idle' }))
    const orig = window.api.getSessions
    window.api.getSessions = async (...a) => [...(await orig(...a)), ...extra]
    await fetchAndRender(true)
  })
  const cat = await page.evaluate(() => {
    const bodies = [...document.querySelectorAll('[data-drop-key^="cat:"]')]
    const b = bodies.find(el => el.querySelectorAll(':scope > .list-drag-item').length >= 3)
    return b && b.dataset.dropKey
  })
  expect(cat, 'the fixture has a category with three cards').toBeTruthy()
  const items = page.locator(`[data-drop-key="${cat}"] > .list-drag-item`)
  const before = await items.evaluateAll(els => els.map(e => e.dataset.dragId))
  const src = await items.nth(0).boundingBox()
  const last = await items.nth(before.length - 1).boundingBox()
  await page.mouse.move(src.x + 60, src.y + 12)
  await page.mouse.down()
  await page.mouse.move(src.x + 60, src.y + 30, { steps: 3 })
  await page.mouse.move(last.x + 60, last.y + last.height - 3, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => items.evaluateAll(els => els.map(e => e.dataset.dragId)))
    .toEqual([...before.slice(1), before[0]])
})
