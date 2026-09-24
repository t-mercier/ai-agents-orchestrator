// Enter in Brutus's input sends the question. Sending re-renders his panel, which removes
// the focused input before the keydown reaches the app's shortcuts; seeing no input
// focused, they took Enter as "open the selected session" and warned it was running.
// The ⌘K palette re-focuses its input, which is why only the bubble and the side panel did it.
const { test, expect } = require('@playwright/test')

for (const home of ['side', 'bubble']) {
  test(`Enter in the ${home} sends, and does not open the selected session`, async ({ page }) => {
    await page.goto('/index.html')
    await page.waitForFunction(() => window.__SHOT_READY__ === true, { timeout: 15_000 })
    // The fixture's list scene leaves checkout-redesign selected, and running.
    await page.evaluate((h) => { try { localStorage.removeItem('csm.brutusLog') } catch {} ; window.CSMBrutusUI.setHome(h) }, home)
    const input = page.locator(`.bru-panel.${home === 'side' ? 'v-C' : 'v-A'} input`)
    await input.fill("What's waiting on me?")
    await input.press('Enter')
    await expect(page.locator('.bru-panel .bru-u').last()).toHaveText("What's waiting on me?")
    await page.waitForTimeout(200)
    expect(await page.evaluate(() => [...document.querySelectorAll('dialog[open]')].map(d => d.id))).toEqual([])
  })
}
