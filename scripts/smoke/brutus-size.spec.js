// Brutus's chat wraps instead of scrolling sideways, and both his homes can be enlarged:
// the side panel from its left edge, the bubble from its corner — never past half the
// window's width. The bubble's header also offers the side panel, as the side panel's
// offers the bubble.
const { test, expect } = require('@playwright/test')

async function boot(page, home) {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate((h) => {
    try { ['csm.brutusSideW', 'csm.brutusBubble', 'csm.brutusLog'].forEach(k => localStorage.removeItem(k)) } catch {}
    // A long unbroken answer: a path and a URL with no space to break at.
    window.__BRUTUS_SCRIPT__ = { reads: [], text: 'See /Users/dev/work/FEAT/checkout-redesign/src/checkout/steps/AddressStepWithInlineValidationAndExpressPay.tsx and https://github.com/acme/web/pull/1842/files#diff-0123456789abcdef0123456789abcdef' }
    window.CSMBrutusUI.setHome(h)
  }, home)
  const input = page.locator(`.bru-panel.${home === 'side' ? 'v-C' : 'v-A'} input`)
  await input.fill('Where is the address step?')
  await input.press('Enter')
  await expect(page.locator('.bru-panel .bru-bt').last()).toContainText('AddressStep')
}
const noSideScroll = (page) => page.locator('.bru-panel:not(.v-B) .bru-body')
  .evaluate(b => b.scrollWidth <= b.clientWidth + 1)

test('the side panel wraps long lines and widens from its edge, to half the window', async ({ page }) => {
  await boot(page, 'side')
  expect(await noSideScroll(page), 'no horizontal scroll in the side panel').toBe(true)
  const panel = page.locator('.bru-panel.v-C')
  const edge = await panel.locator('.bru-rs.w').boundingBox()
  await page.mouse.move(edge.x + 2, edge.y + 200)
  await page.mouse.down()
  await page.mouse.move(edge.x - 150, edge.y + 200, { steps: 6 })
  await page.mouse.up()
  const w = (await panel.boundingBox()).width
  expect(w).toBeGreaterThan(520)
  await expect.poll(() => page.locator('.layout').evaluate(el => parseFloat(getComputedStyle(el).marginRight))).toBeCloseTo(w, 0)
  // Past half the window it stops.
  const e2 = await panel.locator('.bru-rs.w').boundingBox()
  await page.mouse.move(e2.x + 2, e2.y + 200); await page.mouse.down()
  await page.mouse.move(40, e2.y + 200, { steps: 8 }); await page.mouse.up()
  expect((await panel.boundingBox()).width).toBeLessThanOrEqual(700 + 1)
  // Remembered.
  expect(Number(await page.evaluate(() => localStorage.getItem('csm.brutusSideW')))).toBeGreaterThan(520)
})

test('the bubble wraps long lines, grows from its corner, and offers the side panel', async ({ page }) => {
  await boot(page, 'bubble')
  expect(await noSideScroll(page), 'no horizontal scroll in the bubble').toBe(true)
  const panel = page.locator('.bru-panel.v-A')
  const before = await panel.boundingBox()
  const corner = await panel.locator('.bru-rs.nw').boundingBox()
  await page.mouse.move(corner.x + 3, corner.y + 3)
  await page.mouse.down()
  await page.mouse.move(corner.x - 200, corner.y - 100, { steps: 8 })
  await page.mouse.up()
  const after = await panel.boundingBox()
  expect(after.width).toBeGreaterThan(before.width + 150)
  expect(after.height).toBeGreaterThan(before.height + 50)
  await page.mouse.move(after.x + 3, after.y + 3); await page.mouse.down()
  await page.mouse.move(10, after.y + 3, { steps: 8 }); await page.mouse.up()
  expect((await panel.boundingBox()).width).toBeLessThanOrEqual(700 + 1)
  await panel.locator('[data-bru="to-side"]').click()
  await expect(page.locator('.bru-panel.v-C')).toBeVisible()
  await expect(page.locator('body')).toHaveClass(/bru-docked/)
})
