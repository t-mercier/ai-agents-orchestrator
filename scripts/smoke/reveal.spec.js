// Clicking a session's panel reveals its card in the list, the way an editor reveals the
// open file: selected and scrolled into view, centred — asked for on 2026-09-29, when a
// click selected the card but left it below the fold.
const { test, expect } = require('@playwright/test')

const inView = (page, key) => page.evaluate((k) => {
  const list = document.getElementById('panel-list')
  const card = document.querySelector(`#panel-list .list-card[data-key="${CSS.escape(k)}"]`)
  if (!list || !card) return 'missing'
  const l = list.getBoundingClientRect(), c = card.getBoundingClientRect()
  if (c.top < l.top || c.bottom > l.bottom) return 'hidden'
  const offCentre = Math.abs((c.top + c.bottom) / 2 - (l.top + l.bottom) / 2)
  return offCentre < l.height / 4 ? 'centred' : 'visible'
}, key)

test('a click in the detail panel scrolls the list to its card, centred', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 520 })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  const keys = await page.evaluate(() => [...document.querySelectorAll('#panel-list .list-card[data-key]')].map(c => c.dataset.key))
  const reveal = async (key, want) => {
    await page.locator(`#panel-list .list-card[data-key="${key}"]`).click()
    await page.evaluate(() => { document.getElementById('panel-list').scrollTop = 0 })
    await page.waitForTimeout(50)
    const start = await inView(page, key)
    await page.locator('#detail-info-pane').click({ position: { x: 40, y: 40 } })
    await expect.poll(() => inView(page, key)).toBe(want)
    return start
  }
  // A card in the middle of the list comes back centred…
  const middle = keys[Math.floor(keys.length * 0.7)]
  expect(await reveal(middle, 'centred')).toBe('hidden')
  // …and the last one, which the list cannot centre, comes back into view.
  expect(await reveal(keys[keys.length - 1], 'visible')).toBe('hidden')
})

test('a card already in view is left where it is', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 520 })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  const first = await page.evaluate(() => document.querySelector('#panel-list .list-card[data-key]').dataset.key)
  await page.locator(`#panel-list .list-card[data-key="${first}"]`).click()
  const before = await page.evaluate(() => document.getElementById('panel-list').scrollTop)
  await page.locator('#detail-info-pane').click({ position: { x: 40, y: 40 } })
  await page.waitForTimeout(400)
  expect(await page.evaluate(() => document.getElementById('panel-list').scrollTop)).toBe(before)
})
