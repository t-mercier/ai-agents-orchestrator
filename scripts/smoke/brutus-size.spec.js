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

test('an answer does not replay the panel\'s entrance animation', async ({ page }) => {
  // Every render mounts a new panel, and each new panel slid in again: after each answer
  // the whole panel moved 24px and back, and whatever was under the pointer moved with it.
  await boot(page, 'side')
  await page.evaluate(() => window.CSMBrutusUI.refresh())
  const running = await page.locator('.bru-panel.v-C').evaluate(el => el.getAnimations().length)
  expect(running).toBe(0)
})

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

test('only the side panel draws an accent line on its resize edge', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  // Read with the resize in progress, which draws the line like a hover does and does
  // not depend on the pointer landing on a 6px grip.
  // The line fades in over .15s, so read it once the transition is done.
  const lineOn = async (sel) => {
    await page.evaluate(() => document.body.classList.add('bru-resizing'))
    await page.waitForTimeout(250)
    const on = await page.locator(sel).evaluate(el => {
      const a = getComputedStyle(el, '::after')
      return a.display !== 'none' && a.backgroundColor !== 'rgba(0, 0, 0, 0)' && a.backgroundColor !== 'transparent'
    })
    await page.evaluate(() => document.body.classList.remove('bru-resizing'))
    return on
  }
  await page.evaluate(() => window.CSMBrutusUI.setHome('bubble'))
  expect(await lineOn('.bru-panel.v-A .bru-rs.w'), 'no line on the bubble').toBe(false)
  await page.evaluate(() => window.CSMBrutusUI.setHome('side'))
  expect(await lineOn('.bru-panel.v-C .bru-rs.w'), 'the side panel keeps its line').toBe(true)
})

test('a click outside the bubble folds it; inside, it stays; the side panel stays either way', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('/index.html')
  await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
  await page.evaluate(() => window.CSMBrutusUI.setHome('bubble'))
  await page.locator('.bru-panel.v-A .bru-body').click()
  await expect(page.locator('.bru-panel.v-A')).toBeVisible()
  await page.mouse.click(300, 450)
  await expect(page.locator('.bru-panel.v-A')).toHaveCount(0)
  await expect(page.locator('.bru-fab')).toBeVisible()
  await page.evaluate(() => window.CSMBrutusUI.setHome('side'))
  await page.mouse.click(300, 450)
  await expect(page.locator('.bru-panel.v-C')).toBeVisible()
})
